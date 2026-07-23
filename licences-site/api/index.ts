import { randomUUID, timingSafeEqual } from 'node:crypto'

interface Env {
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_D1_DATABASE_ID: string
  CLOUDFLARE_D1_API_TOKEN: string
  ADMIN_API_KEY: string
  CORS_ALLOWED_ORIGINS?: string
}

interface D1RawResult {
  success?: boolean
  results?: {
    columns?: string[]
    rows?: unknown[][]
  }
  meta?: {
    changes?: number
  }
}

interface D1Response {
  success: boolean
  result?: D1RawResult[]
  errors?: Array<{ code: number; message: string }>
}

interface LicenseRow {
  id: string
  target: string
  plan: string
  duration: string
  issued_at: string
  expires_at: string | null
  revoked_at: string | null
}

interface LicenseInput {
  target?: unknown
  plan?: unknown
  duration?: unknown
  issuedAt?: unknown
  expiresAt?: unknown
  revoked?: unknown
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
} as const

function getEnv(): Env {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_D1_DATABASE_ID: process.env.CLOUDFLARE_D1_DATABASE_ID,
    CLOUDFLARE_D1_API_TOKEN: process.env.CLOUDFLARE_D1_API_TOKEN,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
  }

  for (const [name, value] of Object.entries(env)) {
    if (name !== 'CORS_ALLOWED_ORIGINS' && !value) {
      throw new Error(`Missing required environment variable: ${name}`)
    }
  }

  return env as Env
}

function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(data, {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('origin')
  if (!origin) return null

  const allowed = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

  return allowed.has(origin) ? origin : null
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = allowedOrigin(request, env)
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' }
}

function normalizeTarget(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.length > 253) return null

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }

    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
    const parts = hostname.split('.')
    const isIpv4 =
      parts.length === 4 &&
      parts.every(
        (part) => /^\d{1,3}$/.test(part) && Number(part) <= 255,
      )
    const isIpv6 = hostname.includes(':') && /^[0-9a-f:]+$/i.test(hostname)
    const isDomain =
      hostname.includes('.') &&
      parts.every((part) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part),
      )

    return isIpv4 || isIpv6 || isDomain ? hostname : null
  } catch {
    return null
  }
}

function text(value: unknown, name: string, maxLength = 64): string {
  if (typeof value !== 'string') throw new ClientError(`${name} must be a string`)
  const normalized = value.trim()
  if (normalized.length < 2 || normalized.length > maxLength) {
    throw new ClientError(`${name} has an invalid length`)
  }
  return normalized
}

function date(value: unknown, name: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string') throw new ClientError(`${name} must be an ISO date`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new ClientError(`${name} must be an ISO date`)
  return new Date(timestamp).toISOString()
}

class ClientError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

class D1Client {
  private readonly endpoint: string

  constructor(private readonly env: Env) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database/${encodeURIComponent(env.CLOUDFLARE_D1_DATABASE_ID)}/raw`
  }

  async query(sql: string, params: Array<string | null> = []): Promise<D1RawResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.CLOUDFLARE_D1_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(8_000),
    })

    const payload = (await response.json()) as D1Response
    const result = payload.result?.[0]
    if (!response.ok || !payload.success || !result?.success) {
      const detail = payload.errors?.map((error) => error.message).join('; ')
      throw new Error(`D1 query failed${detail ? `: ${detail}` : ''}`)
    }
    return result
  }

  async first<T extends object>(sql: string, params: Array<string | null>): Promise<T | null> {
    const result = await this.query(sql, params)
    const columns = result.results?.columns ?? []
    const row = result.results?.rows?.[0]
    if (!row) return null

    return Object.fromEntries(columns.map((column, index) => [column, row[index]])) as T
  }

  async all<T extends object>(sql: string, params: Array<string | null>): Promise<T[]> {
    const result = await this.query(sql, params)
    const columns = result.results?.columns ?? []
    return (result.results?.rows ?? []).map(
      (row) =>
        Object.fromEntries(
          columns.map((column, index) => [column, row[index]]),
        ) as T,
    )
  }
}

function authorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false

  const supplied = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(secret)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function queryLicense(request: Request, url: URL, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env)
  const target = normalizeTarget(url.searchParams.get('target') ?? '')
  if (!target) {
    return json(
      { error: 'A valid panel domain or IP is required.' },
      400,
      { ...cors, 'Cache-Control': 'no-store' },
    )
  }

  const db = new D1Client(env)
  const license = await db.first<LicenseRow>(
    `SELECT id, target, plan, duration, issued_at, expires_at, revoked_at
     FROM licenses
     WHERE target = ? COLLATE NOCASE
     LIMIT 1`,
    [target],
  )

  if (!license) {
    return json(
      { error: 'License not found.' },
      404,
      { ...cors, 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    )
  }

  const now = Date.now()
  const expiresAt = license.expires_at
  const active =
    license.revoked_at === null &&
    (expiresAt === null || Date.parse(expiresAt) > now)

  return json(
    {
      active,
      plan: license.plan,
      duration: license.duration,
      expiresAt,
      target: license.target,
    },
    200,
    {
      ...cors,
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
    },
  )
}

async function createLicense(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as LicenseInput
  const target = normalizeTarget(String(body.target ?? ''))
  if (!target) throw new ClientError('target must be a valid panel domain or IP')

  const id = randomUUID()
  const plan = text(body.plan, 'plan')
  const duration = text(body.duration, 'duration')
  const issuedAt = date(body.issuedAt ?? new Date().toISOString(), 'issuedAt') as string
  const expiresAt = date(body.expiresAt, 'expiresAt', true)

  try {
    await new D1Client(env).query(
      `INSERT INTO licenses (id, target, plan, duration, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, target, plan, duration, issuedAt, expiresAt],
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new ClientError('A license already exists for this target', 409)
    }
    throw error
  }

  return json({ id, target, plan, duration, issuedAt, expiresAt }, 201, {
    'Cache-Control': 'no-store',
  })
}

async function listLicenses(url: URL, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50
  const rows = await new D1Client(env).all<LicenseRow>(
    `SELECT id, target, plan, duration, issued_at, expires_at, revoked_at
     FROM licenses
     ORDER BY created_at DESC
     LIMIT ?`,
    [String(limit)],
  )

  return json({ licenses: rows, limit }, 200, { 'Cache-Control': 'no-store' })
}

async function updateLicense(request: Request, id: string, env: Env): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ClientError('Invalid license id')
  const body = (await request.json()) as LicenseInput
  const updates: string[] = []
  const params: Array<string | null> = []

  if (body.target !== undefined) {
    const target = normalizeTarget(String(body.target))
    if (!target) throw new ClientError('target must be a valid panel domain or IP')
    updates.push('target = ?')
    params.push(target)
  }
  if (body.plan !== undefined) {
    updates.push('plan = ?')
    params.push(text(body.plan, 'plan'))
  }
  if (body.duration !== undefined) {
    updates.push('duration = ?')
    params.push(text(body.duration, 'duration'))
  }
  if (body.issuedAt !== undefined) {
    updates.push('issued_at = ?')
    params.push(date(body.issuedAt, 'issuedAt'))
  }
  if (body.expiresAt !== undefined) {
    updates.push('expires_at = ?')
    params.push(date(body.expiresAt, 'expiresAt', true))
  }
  if (body.revoked !== undefined) {
    if (typeof body.revoked !== 'boolean') throw new ClientError('revoked must be a boolean')
    updates.push('revoked_at = ?')
    params.push(body.revoked ? new Date().toISOString() : null)
  }
  if (updates.length === 0) throw new ClientError('No supported fields were provided')

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
  params.push(id)
  const result = await new D1Client(env).query(
    `UPDATE licenses SET ${updates.join(', ')} WHERE id = ?`,
    params,
  )
  if ((result.meta?.changes ?? 0) === 0) throw new ClientError('License not found', 404)

  return json({ updated: true, id }, 200, { 'Cache-Control': 'no-store' })
}

async function deleteLicense(id: string, env: Env): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ClientError('Invalid license id')
  const result = await new D1Client(env).query('DELETE FROM licenses WHERE id = ?', [id])
  if ((result.meta?.changes ?? 0) === 0) throw new ClientError('License not found', 404)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

async function handle(request: Request): Promise<Response> {
  let env: Env
  try {
    env = getEnv()
  } catch (error) {
    console.error(error)
    return json({ error: 'Service is not configured.' }, 503, { 'Cache-Control': 'no-store' })
  }

  const url = new URL(request.url)
  const route = url.searchParams.get('route') ?? 'root'

  if (request.method === 'OPTIONS' && route === 'query') {
    const cors = corsHeaders(request, env)
    if (!allowedOrigin(request, env)) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: cors })
  }

  try {
    if (route === 'root' && request.method === 'GET') {
      return json({ service: 'Falixer Licences API', status: 'ok' }, 200, {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      })
    }
    if (route === 'health' && request.method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString() }, 200, {
        'Cache-Control': 'no-store',
      })
    }
    if (route === 'query' && request.method === 'GET') {
      return await queryLicense(request, url, env)
    }
    if (route === 'admin') {
      if (!authorized(request, env.ADMIN_API_KEY)) {
        return json({ error: 'Unauthorized.' }, 401, {
          'Cache-Control': 'no-store',
          'WWW-Authenticate': 'Bearer',
        })
      }

      const id = url.searchParams.get('id')
      if (request.method === 'GET' && !id) return await listLicenses(url, env)
      if (request.method === 'POST' && !id) return await createLicense(request, env)
      if (request.method === 'PATCH' && id) return await updateLicense(request, id, env)
      if (request.method === 'DELETE' && id) return await deleteLicense(id, env)
    }

    return json({ error: 'Not found.' }, 404, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof ClientError) {
      return json({ error: error.message }, error.status, { 'Cache-Control': 'no-store' })
    }
    if (error instanceof SyntaxError) {
      return json({ error: 'Invalid JSON body.' }, 400, { 'Cache-Control': 'no-store' })
    }
    console.error(error)
    return json({ error: 'Internal service error.' }, 500, { 'Cache-Control': 'no-store' })
  }
}

export default {
  fetch: handle,
}

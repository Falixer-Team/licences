import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

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
  user_email: string | null
  plan: string
  duration: string
  issued_at: string
  expires_at: string | null
  revoked_at: string | null
}

interface LicenseInput {
  target?: unknown
  userEmail?: unknown
  plan?: unknown
  duration?: unknown
  issuedAt?: unknown
  expiresAt?: unknown
  revoked?: unknown
}

interface CodeRow {
  id: string
  code_prefix: string
  plan: string
  duration: string
  duration_days: number | null
  expires_at: string | null
  redeemed_at: string | null
  redeemed_target: string | null
  redeemed_email: string | null
  revoked_at: string | null
  created_at: string
}

interface CodeInput {
  plan?: unknown
  duration?: unknown
  durationDays?: unknown
  quantity?: unknown
  expiresAt?: unknown
}

interface RedeemInput {
  code?: unknown
  target?: unknown
  userEmail?: unknown
}

interface UnbindInput extends RedeemInput {}

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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function email(value: unknown, name = 'userEmail'): string {
  if (typeof value !== 'string') {
    throw new ClientError(`${name} must be a valid email address`)
  }

  const normalized = value.trim()
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    /[\s\u0000-\u001f\u007f]/.test(normalized) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(normalized)
  ) {
    throw new ClientError(`${name} must be a valid email address`)
  }

  const separator = normalized.lastIndexOf('@')
  const local = normalized.slice(0, separator)
  const domain = normalized.slice(separator + 1).toLowerCase()
  if (
    local.length > 64 ||
    domain.length > 253 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !domain.split('.').every((part) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part),
    )
  ) {
    throw new ClientError(`${name} must be a valid email address`)
  }

  return `${local}@${domain}`
}

function date(value: unknown, name: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string') throw new ClientError(`${name} must be an ISO date`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new ClientError(`${name} must be an ISO date`)
  return new Date(timestamp).toISOString()
}

function codeHash(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

function generateCode(): string {
  const value = randomBytes(15).toString('hex').toUpperCase()
  return `FLX-${value.match(/.{1,6}/g)?.join('-')}`
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
    const results = await this.request({ sql, params })
    return results[0] as D1RawResult
  }

  async batch(
    statements: Array<{ sql: string; params: Array<string | null> }>,
  ): Promise<D1RawResult[]> {
    return this.request({ batch: statements })
  }

  private async request(body: unknown): Promise<D1RawResult[]> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.CLOUDFLARE_D1_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    })

    const payload = (await response.json()) as D1Response
    const results = payload.result
    if (
      !response.ok ||
      !payload.success ||
      !results?.length ||
      results.some((result) => !result.success)
    ) {
      const detail = payload.errors?.map((error) => error.message).join('; ')
      throw new Error(`D1 query failed${detail ? `: ${detail}` : ''}`)
    }
    return results
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

function resultRows<T extends object>(result: D1RawResult): T[] {
  const columns = result.results?.columns ?? []
  return (result.results?.rows ?? []).map(
    (row) =>
      Object.fromEntries(
        columns.map((column, index) => [column, row[index]]),
      ) as T,
  )
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
  const userEmail = email(body.userEmail)
  const plan = text(body.plan, 'plan')
  const duration = text(body.duration, 'duration')
  const issuedAt = date(body.issuedAt ?? new Date().toISOString(), 'issuedAt') as string
  const expiresAt = date(body.expiresAt, 'expiresAt', true)

  try {
    await new D1Client(env).query(
      `INSERT INTO licenses
       (id, target, user_email, plan, duration, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, target, userEmail, plan, duration, issuedAt, expiresAt],
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new ClientError('A license already exists for this target', 409)
    }
    throw error
  }

  return json({ id, target, userEmail, plan, duration, issuedAt, expiresAt }, 201, {
    'Cache-Control': 'no-store',
  })
}

async function redeemCode(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env)
  const body = (await request.json()) as RedeemInput
  const target = normalizeTarget(String(body.target ?? ''))
  if (!target) throw new ClientError('target must be a valid panel domain or IP')
  const userEmail = email(body.userEmail)
  if (typeof body.code !== 'string' || !/^FLX-(?:[0-9A-F]{6}-){4}[0-9A-F]{6}$/i.test(body.code.trim())) {
    throw new ClientError('code must be a valid authorization code')
  }

  const hash = codeHash(body.code)
  const db = new D1Client(env)
  const existing = await db.first<{ redeemed_at: string | null; revoked_at: string | null; expires_at: string | null }>(
    `SELECT redeemed_at, revoked_at, expires_at FROM authorization_codes WHERE code_hash = ? LIMIT 1`,
    [hash],
  )
  if (!existing) throw new ClientError('Authorization code not found', 404)
  if (existing.redeemed_at) throw new ClientError('Authorization code has already been redeemed', 409)
  if (existing.revoked_at) throw new ClientError('Authorization code has been revoked', 410)
  if (existing.expires_at && Date.parse(existing.expires_at) <= Date.now()) {
    throw new ClientError('Authorization code has expired', 410)
  }

  const licenseId = randomUUID()
  const now = new Date().toISOString()
  let results: D1RawResult[]
  try {
    results = await db.batch([
      {
          sql: `INSERT INTO licenses
            (id, target, user_email, plan, duration, issued_at, expires_at)
            SELECT ?, ?, ?, plan, duration, ?,
                CASE WHEN duration_days IS NULL THEN NULL
                     ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || duration_days || ' days') END
              FROM authorization_codes
              WHERE code_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > ?)`,
        params: [licenseId, target, userEmail, now, now, hash, now],
      },
      {
        sql: `UPDATE authorization_codes
              SET redeemed_at = ?, redeemed_target = ?, redeemed_email = ?,
                  redeemed_license_id = ?
              WHERE code_hash = ? AND redeemed_at IS NULL
                AND EXISTS (SELECT 1 FROM licenses WHERE id = ?)`,
        params: [now, target, userEmail, licenseId, hash, licenseId],
      },
      {
        sql: `SELECT id, target, plan, duration, issued_at, expires_at
              FROM licenses WHERE id = ? LIMIT 1`,
        params: [licenseId],
      },
      {
        sql: `INSERT INTO license_binding_audit
              (id, license_id, code_id, action, target, user_email)
              SELECT ?, ?, id, 'redeemed', ?, ?
              FROM authorization_codes WHERE code_hash = ? LIMIT 1`,
        params: [randomUUID(), licenseId, target, userEmail, hash],
      },
    ])
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw new ClientError('A license already exists for this target', 409)
    }
    throw error
  }

  const license = resultRows<
    Omit<LicenseRow, 'revoked_at' | 'user_email'>
  >(results[2] as D1RawResult)[0]
  if (!license) {
    throw new ClientError('Authorization code is no longer available', 409)
  }
  return json(
    {
      redeemed: true,
      license: {
        id: license.id,
        target: license.target,
        plan: license.plan,
        duration: license.duration,
        issuedAt: license.issued_at,
        expiresAt: license.expires_at,
      },
    },
    201,
    { ...cors, 'Cache-Control': 'no-store' },
  )
}

async function unbindLicense(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env)
  const body = (await request.json()) as UnbindInput
  const target = normalizeTarget(String(body.target ?? ''))
  if (!target) throw new ClientError('target must be a valid panel domain or IP')
  const userEmail = email(body.userEmail)
  if (
    typeof body.code !== 'string' ||
    !/^FLX-(?:[0-9A-F]{6}-){4}[0-9A-F]{6}$/i.test(body.code.trim())
  ) {
    throw new ClientError('code must be a valid authorization code')
  }

  const hash = codeHash(body.code)
  const db = new D1Client(env)
  const binding = await db.first<{
    code_id: string
    license_id: string
  }>(
    `SELECT ac.id AS code_id, l.id AS license_id
     FROM authorization_codes ac
     JOIN licenses l ON l.id = ac.redeemed_license_id
     WHERE ac.code_hash = ?
       AND ac.redeemed_at IS NOT NULL
       AND ac.redeemed_target = ? COLLATE NOCASE
       AND ac.redeemed_email = ? COLLATE NOCASE
       AND l.target = ? COLLATE NOCASE
       AND l.user_email = ? COLLATE NOCASE
     LIMIT 1`,
    [hash, target, userEmail, target, userEmail],
  )
  if (!binding) {
    throw new ClientError('The code, email, and current binding do not match', 404)
  }

  const now = new Date().toISOString()
  const results = await db.batch([
    {
      sql: `INSERT INTO license_binding_audit
            (id, license_id, code_id, action, target, user_email, created_at)
            VALUES (?, ?, ?, 'unbound', ?, ?, ?)`,
      params: [randomUUID(), binding.license_id, binding.code_id, target, userEmail, now],
    },
    {
      sql: `UPDATE authorization_codes
            SET redeemed_at = NULL, redeemed_target = NULL,
                redeemed_email = NULL, redeemed_license_id = NULL
            WHERE id = ? AND redeemed_license_id = ?`,
      params: [binding.code_id, binding.license_id],
    },
    {
      sql: `DELETE FROM licenses WHERE id = ?`,
      params: [binding.license_id],
    },
  ])

  if ((results[1]?.meta?.changes ?? 0) !== 1 || (results[2]?.meta?.changes ?? 0) !== 1) {
    throw new ClientError('The binding changed before it could be removed', 409)
  }

  return json(
    { unbound: true, target },
    200,
    { ...cors, 'Cache-Control': 'no-store' },
  )
}

async function createCodes(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as CodeInput
  const plan = text(body.plan, 'plan')
  const duration = text(body.duration, 'duration')
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new ClientError('quantity must be an integer between 1 and 100')
  }
  let durationDays: number | null = null
  if (body.durationDays !== undefined && body.durationDays !== null) {
    durationDays = Number(body.durationDays)
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 36500) {
      throw new ClientError('durationDays must be an integer between 1 and 36500')
    }
  }
  const expiresAt = date(body.expiresAt, 'expiresAt', true)
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new ClientError('expiresAt must be in the future')
  }

  const codes = Array.from({ length: quantity }, () => ({
    id: randomUUID(),
    code: generateCode(),
  }))
  await new D1Client(env).batch(
    codes.map(({ id, code }) => ({
      sql: `INSERT INTO authorization_codes
            (id, code_hash, code_prefix, plan, duration, duration_days, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, codeHash(code), code.slice(0, 11), plan, duration, durationDays === null ? null : String(durationDays), expiresAt],
    })),
  )

  return json({ plan, duration, durationDays, expiresAt, codes }, 201, {
    'Cache-Control': 'no-store',
  })
}

async function listCodes(url: URL, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50
  const codes = await new D1Client(env).all<CodeRow>(
    `SELECT id, code_prefix, plan, duration, duration_days, expires_at,
          redeemed_at, redeemed_target, redeemed_email, revoked_at,
          created_at
     FROM authorization_codes ORDER BY created_at DESC LIMIT ?`,
    [String(limit)],
  )
  return json({ codes, limit }, 200, { 'Cache-Control': 'no-store' })
}

async function listLicenses(url: URL, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50
  const rows = await new D1Client(env).all<LicenseRow>(
    `SELECT id, target, user_email, plan, duration, issued_at, expires_at,
            revoked_at
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
  if (body.userEmail !== undefined) {
    updates.push('user_email = ?')
    params.push(email(body.userEmail))
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

  if (
    request.method === 'OPTIONS' &&
    (route === 'query' || route === 'redeem' || route === 'unbind')
  ) {
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
    if (route === 'redeem' && request.method === 'POST') {
      return await redeemCode(request, env)
    }
    if (route === 'unbind' && request.method === 'POST') {
      return await unbindLicense(request, env)
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
    if (route === 'admin-codes') {
      if (!authorized(request, env.ADMIN_API_KEY)) {
        return json({ error: 'Unauthorized.' }, 401, {
          'Cache-Control': 'no-store',
          'WWW-Authenticate': 'Bearer',
        })
      }
      if (request.method === 'GET') return await listCodes(url, env)
      if (request.method === 'POST') return await createCodes(request, env)
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

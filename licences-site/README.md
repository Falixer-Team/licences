# Falixer Licences API

无 UI 的 Falixer 授权服务，直接部署到 Vercel。数据保存在 Cloudflare D1，Vercel Function 通过 Cloudflare 官方 REST API 访问数据库，不使用 Cloudflare Workers，域名也不需要托管或迁移到 Cloudflare。

## API

### 公开查询

```text
GET /query?target=panel.example.com
```

成功响应：

```json
{
  "active": true,
  "plan": "个人免费版",
  "duration": "永久",
  "expiresAt": null,
  "target": "panel.example.com"
}
```

未找到返回 `404`。失效或已撤销的授权仍返回 `200`，但 `active` 为 `false`。

### 健康检查

```text
GET /health
```

### 管理接口

所有管理请求必须包含：

```text
Authorization: Bearer <ADMIN_API_KEY>
```

- `GET /admin/licenses?limit=50`：列出最近授权，最多 100 条。
- `POST /admin/licenses`：创建授权。
- `PATCH /admin/licenses/:id`：更新、续期或撤销授权。
- `DELETE /admin/licenses/:id`：永久删除授权。

创建个人免费版：

```json
{
  "target": "panel.example.com",
  "plan": "个人免费版",
  "duration": "永久",
  "expiresAt": null
}
```

创建一年商业版：

```json
{
  "target": "panel.example.com",
  "plan": "年付授权",
  "duration": "1 年",
  "issuedAt": "2026-07-23T00:00:00.000Z",
  "expiresAt": "2027-07-23T00:00:00.000Z"
}
```

更新或撤销：

```json
{
  "expiresAt": "2028-07-23T00:00:00.000Z",
  "revoked": false
}
```

将 `revoked` 设置为 `true` 可撤销，设置为 `false` 可恢复。

## 创建 Cloudflare D1 数据库

1. 注册或登录 Cloudflare。域名不需要添加到 Cloudflare。
2. 在 Cloudflare Dashboard 中打开 **Storage & databases → D1 SQL database**。
3. 创建数据库，例如 `falixer-licences`。
4. 记录数据库 UUID 和 Cloudflare Account ID。
5. 在 D1 控制台执行 `schema.sql` 的全部内容。
6. 在 **My Profile → API Tokens** 创建 API Token，只授予目标账户的 **D1 Edit** 权限。

D1 免费版目前适合此类小型授权数据：数据库上限 500 MB；授权表每条数据很小，足够存储大量授权记录。

## 部署到 Vercel

### 单独导入当前仓库

1. 在 Vercel 创建新项目并导入此 Git 仓库。
2. 将 **Root Directory** 设置为 `licences-site`。
3. Framework Preset 选择 **Other**。
4. Build Command 使用 `pnpm build`。
5. 添加以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 数据库 UUID |
| `CLOUDFLARE_D1_API_TOKEN` | 仅服务端可见的 D1 API Token |
| `ADMIN_API_KEY` | 管理 API 的长随机密钥，建议至少 32 字节 |
| `CORS_ALLOWED_ORIGINS` | 允许调用公开查询接口的网站来源，逗号分隔 |

6. 部署后，将 `licences.falixer.dev` 添加为 Vercel 项目自定义域名。
7. 按 Vercel 显示的记录在当前 DNS 服务商处添加 CNAME/A 记录。域名无需在 Cloudflare。

不要把 `CLOUDFLARE_D1_API_TOKEN` 或 `ADMIN_API_KEY` 放入前端项目、公开仓库或浏览器请求。

## 主站配置

Falixer-Web 使用：

```text
NUXT_PUBLIC_LICENSE_API_BASE=https://licences.falixer.dev
```

浏览器最终请求：

```text
https://licences.falixer.dev/query?target=panel.example.com
```

生产环境的 `CORS_ALLOWED_ORIGINS` 应包含主站实际来源，例如：

```text
https://falixer.dev,https://www.falixer.dev
```

## 性能设计

- 单个原生 TypeScript Vercel Function，不使用 Express 等框架，减少冷启动和依赖体积。
- 查询使用 D1 `/raw` API，返回数组而非对象，降低响应解析开销。
- `target` 使用唯一索引，查询为单行精确匹配。
- 公开成功结果在 Vercel CDN 缓存 30 秒，并允许 120 秒 stale-while-revalidate。
- 未找到结果缓存 30 秒，降低重复扫描和恶意探测成本。
- D1 请求设置 8 秒超时，避免函数长期占用。
- SQL 全部使用参数绑定，管理鉴权使用常量时间比较。

### 架构限制

D1 的原生高性能访问方式是 Workers Binding，但本项目明确不使用 Workers，因此使用 Cloudflare REST API。每次缓存未命中的查询都会产生一次 Vercel 到 Cloudflare API 的网络往返，延迟会高于 Workers 直连 D1。对授权查询这种低频、可短期缓存的接口通常可接受。

如未来请求量显著增长但仍不使用 Workers，可考虑 Vercel Postgres/Neon/Supabase 的免费层，以获得更标准的数据面连接与更低的跨平台控制面开销。

## 本地检查

安装依赖并执行类型检查：

```text
pnpm install
pnpm build
```

完整本地调用建议使用 Vercel CLI，并将 `.env.example` 复制为 `.env` 后填写真实配置。不要提交 `.env`。

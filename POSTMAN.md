# 使用 Postman 管理 Falixer 授权服务

本文说明如何使用 Postman 完成服务检查、生成兑换码、兑换授权、查询授权、解绑、创建授权、修改授权、撤销授权和删除授权。

## 1. 前置条件

开始前请确认：

1. Cloudflare D1 已执行 `cloudflare-d1-console.sql`。
2. 授权服务已部署到 Vercel。
3. Vercel 已配置以下环境变量：
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_D1_DATABASE_ID`
   - `CLOUDFLARE_D1_API_TOKEN`
   - `ADMIN_API_KEY`
   - `CORS_ALLOWED_ORIGINS`
4. 部署地址可以正常访问，例如 `https://licences.falixer.dev`。

`CLOUDFLARE_D1_API_TOKEN` 只配置在 Vercel 中，不需要也不应该填入 Postman。Postman 管理请求只使用 `ADMIN_API_KEY`。

## 2. 创建 Postman 环境

在 Postman 中打开 **Environments → Create environment**，创建环境 `Falixer Licences`，添加以下变量：

| Variable | Initial value | Current value | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `https://licences.falixer.dev` | 同左 | 授权服务地址，末尾不要加 `/` |
| `adminApiKey` | 留空 | 填写 Vercel 中的 `ADMIN_API_KEY` | 管理密钥，不要分享或提交到仓库 |
| `licenseId` | 留空 | 留空 | 创建或查询授权后保存 UUID |
| `redeemCode` | 留空 | 留空 | 生成后保存完整兑换码 |
| `target` | `panel.example.com` | 同左 | 测试面板域名或 IP |
| `userEmail` | `owner@example.com` | 同左 | 授权使用者邮箱 |

选择刚创建的 `Falixer Licences` 环境。

> 建议只在 **Current value** 中保存真实管理密钥。导出环境前必须删除密钥和真实邮箱。

## 3. 创建 Collection

创建 Collection：`Falixer Licences API`。

在 Collection 的 **Authorization** 中设置：

- Type：`Bearer Token`
- Token：`{{adminApiKey}}`

公开请求 `/health`、`/query`、`/redeem`、`/unbind` 不需要管理密钥。可在这些请求的 Authorization 中选择 `No Auth`。

所有发送 JSON 的请求均设置：

- Body：`raw`
- 格式：`JSON`
- Header：`Content-Type: application/json`

## 4. 推荐的完整操作流程

### 4.1 检查服务状态

请求：

```text
GET {{baseUrl}}/health
```

Authorization：`No Auth`

预期响应：

```json
{
  "status": "ok",
  "timestamp": "2026-07-23T00:00:00.000Z"
}
```

如果返回 `503 Service is not configured`，说明 Vercel 环境变量缺失。修改环境变量后必须重新部署。

### 4.2 生成兑换码

请求：

```text
POST {{baseUrl}}/admin/codes
```

Authorization：继承 Collection 的 Bearer Token。

Body：

```json
{
  "plan": "年付授权",
  "duration": "1 年",
  "durationDays": 365,
  "quantity": 1,
  "expiresAt": null
}
```

永久授权可以使用：

```json
{
  "plan": "永久授权",
  "duration": "永久",
  "durationDays": null,
  "quantity": 1,
  "expiresAt": null
}
```

成功状态码：`201 Created`。

明文兑换码只返回一次。响应示例：

```json
{
  "plan": "年付授权",
  "duration": "1 年",
  "durationDays": 365,
  "expiresAt": null,
  "codes": [
    {
      "id": "兑换码记录 UUID",
      "code": "FLX-ABCDEF-123456-ABCDEF-123456-ABCDEF"
    }
  ]
}
```

可以在该请求的 **Scripts → Post-response** 中添加：

```javascript
const body = pm.response.json();
if (body.codes?.[0]?.code) {
  pm.environment.set('redeemCode', body.codes[0].code);
}
```

脚本会把第一个完整兑换码保存到 `{{redeemCode}}`。

### 4.3 查看兑换码列表

请求：

```text
GET {{baseUrl}}/admin/codes?limit=50
```

Authorization：继承 Collection。

列表最多返回 100 条，只返回兑换码前缀和状态，不会恢复完整兑换码。主要字段：

- `redeemed_at`：非空表示已兑换。
- `redeemed_target`：绑定目标。
- `redeemed_email`：绑定邮箱，仅管理接口可见。
- `revoked_at`：非空表示兑换码已撤销。
- `expires_at`：兑换码自身的兑换截止时间。

### 4.4 使用兑换码绑定授权

请求：

```text
POST {{baseUrl}}/redeem
```

Authorization：`No Auth`

Body：

```json
{
  "code": "{{redeemCode}}",
  "target": "{{target}}",
  "userEmail": "{{userEmail}}"
}
```

成功状态码：`201 Created`。响应不会返回邮箱：

```json
{
  "redeemed": true,
  "license": {
    "id": "授权 UUID",
    "target": "panel.example.com",
    "plan": "年付授权",
    "duration": "1 年",
    "issuedAt": "2026-07-23T00:00:00.000Z",
    "expiresAt": "2027-07-23T00:00:00.000Z"
  }
}
```

可添加 Post-response 脚本保存授权 ID：

```javascript
const body = pm.response.json();
if (body.license?.id) {
  pm.environment.set('licenseId', body.license.id);
}
```

### 4.5 公开查询授权

请求：

```text
GET {{baseUrl}}/query?target={{target}}
```

Authorization：`No Auth`

成功状态码：`200 OK`：

```json
{
  "active": true,
  "plan": "年付授权",
  "duration": "1 年",
  "expiresAt": "2027-07-23T00:00:00.000Z",
  "target": "panel.example.com"
}
```

该接口不会返回邮箱、授权 UUID 或兑换码信息。

### 4.6 查看授权管理列表

请求：

```text
GET {{baseUrl}}/admin/licenses?limit=50
```

Authorization：继承 Collection。

该接口会返回 `user_email`，仅限管理员使用。找到目标授权后，将其 `id` 保存到 Postman 环境变量 `licenseId`。

### 4.7 修改、续期或撤销授权

请求：

```text
PATCH {{baseUrl}}/admin/licenses/{{licenseId}}
```

Authorization：继承 Collection。

修改邮箱：

```json
{
  "userEmail": "new-owner@example.com"
}
```

修改套餐和有效期：

```json
{
  "plan": "商业授权",
  "duration": "2 年",
  "expiresAt": "2028-07-23T00:00:00.000Z"
}
```

撤销授权：

```json
{
  "revoked": true
}
```

恢复授权：

```json
{
  "revoked": false
}
```

成功响应：

```json
{
  "updated": true,
  "id": "授权 UUID"
}
```

撤销不会删除记录，公开查询仍返回授权信息，但 `active` 为 `false`。

### 4.8 用户自助解绑

请求：

```text
POST {{baseUrl}}/unbind
```

Authorization：`No Auth`

Body：

```json
{
  "code": "{{redeemCode}}",
  "target": "{{target}}",
  "userEmail": "{{userEmail}}"
}
```

兑换码、邮箱和当前绑定目标必须全部匹配。成功响应：

```json
{
  "unbound": true,
  "target": "panel.example.com"
}
```

解绑后：

- 当前授权记录被删除。
- 兑换码恢复为可兑换状态。
- `license_binding_audit` 保留兑换和解绑历史。
- 可以修改 `target` 后再次调用 `/redeem` 绑定新目标。

### 4.9 管理员直接创建授权

不经过兑换码直接创建授权：

```text
POST {{baseUrl}}/admin/licenses
```

Authorization：继承 Collection。

永久授权：

```json
{
  "target": "direct.example.com",
  "userEmail": "owner@example.com",
  "plan": "永久授权",
  "duration": "永久",
  "expiresAt": null
}
```

限时授权：

```json
{
  "target": "direct.example.com",
  "userEmail": "owner@example.com",
  "plan": "商业授权",
  "duration": "1 年",
  "issuedAt": "2026-07-23T00:00:00.000Z",
  "expiresAt": "2027-07-23T00:00:00.000Z"
}
```

成功状态码：`201 Created`。保存响应中的 `id`，用于后续 PATCH 或 DELETE。

### 4.10 管理员永久删除授权

请求：

```text
DELETE {{baseUrl}}/admin/licenses/{{licenseId}}
```

Authorization：继承 Collection。

成功状态码：`204 No Content`，响应体为空。

这是永久删除操作。兑换码生成的授权应优先使用 `/unbind`，否则兑换码可能仍显示为已兑换。

## 5. Postman 自动测试脚本

可在 Collection 的 **Scripts → Post-response** 中添加通用检查：

```javascript
pm.test('响应时间小于 10 秒', function () {
  pm.expect(pm.response.responseTime).to.be.below(10000);
});

pm.test('响应包含安全响应头', function () {
  pm.expect(pm.response.headers.get('X-Content-Type-Options')).to.eql('nosniff');
});
```

在 `/query` 请求中添加隐私检查：

```javascript
pm.test('公开查询不泄露邮箱', function () {
  const body = pm.response.json();
  pm.expect(body).to.not.have.property('userEmail');
  pm.expect(body).to.not.have.property('user_email');
  pm.expect(JSON.stringify(body)).to.not.include('@');
});
```

## 6. 常见错误

### `401 Unauthorized`

- `Authorization` 必须为 `Bearer {{adminApiKey}}`。
- `adminApiKey` 必须与 Vercel 的 `ADMIN_API_KEY` 完全一致。
- 修改 Vercel 环境变量后需要重新部署。

### `404 License not found`

- 当前目标没有授权。
- `target` 只能填写域名或 IP，不要携带路径。
- 示例：填写 `panel.example.com`，不要填写 `https://panel.example.com/admin`。

### `404 Authorization code not found`

- 兑换码输入错误。
- 数据库只保存哈希，无法从后台恢复完整兑换码。

### `409 Authorization code has already been redeemed`

兑换码已经绑定。若要换绑，应使用原兑换码、原邮箱和原目标调用 `/unbind`，成功后再兑换。

### `409 A license already exists for this target`

同一域名或 IP 已有授权。先查询或解绑现有授权，不要重复创建。

### `410 Authorization code has expired`

兑换码自身已过期。它与授权兑换后的 `expiresAt` 是两个不同概念。

### `503 Service is not configured`

Vercel 环境变量缺失。检查四个必填变量并重新部署。

### `500 Internal service error`

常见原因：

- D1 尚未执行 `cloudflare-d1-console.sql`。
- Cloudflare Token 没有 D1 Edit 权限。
- Account ID 或 D1 Database ID 配置错误。
- Cloudflare Token 已失效或被轮换。

查看 Vercel 项目的 **Logs** 获取具体 D1 错误，但不要把 Token 或管理密钥复制到公开日志、截图或聊天中。

## 7. 安全要求

- 不要把 `ADMIN_API_KEY`、Cloudflare Token 或完整兑换码提交到 Git。
- 不要将包含真实密钥的 Postman 环境导出后公开分享。
- 管理接口只通过 HTTPS 调用。
- 明文兑换码生成后应立即保存到受控位置。
- 公开查询不会返回邮箱；管理列表中的邮箱属于个人信息。
- 如果密钥曾出现在截图、聊天、日志或 Git 历史中，立即轮换。

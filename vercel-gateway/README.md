# CampusOS Vercel gateway

Vercel 只做入口，CampusOS 的后端、D1、Agent、地图和模型调用继续运行在 Cloudflare Worker 上。

## Why

`campusos.zhiyuapp.site` 需要更稳定的国内访问入口。这个网关把浏览器请求转发到
`https://gdufs.ccwu.cc`，并处理两件 Cloudflare Worker 不直接支持的事情：

1. Vercel 保留了 `/_next/*`，所以上游的 Next 静态资源改写到 `/upstream/_next/*`。
2. 同源请求的 `Origin` 桥接为上游 Origin，避免账号接口的 CSRF 校验拒绝 Vercel 域名。

这不是把后端迁到 Vercel；D1、Workers AI、Vectorize、cron 和所有业务逻辑仍在 Cloudflare。

## Configuration

Vercel Project Environment:

```text
CAMPUSOS_UPSTREAM=https://gdufs.ccwu.cc
```

`CAMPUSOS_UPSTREAM` 必须是 Worker 的 `ACCOUNT_ALLOWED_ORIGINS` 已包含的域名，否则登录等写接口会返回
`FORBIDDEN`。

## Deploy

```bash
cd vercel-gateway
vercel link --yes --project campusos-gateway
vercel deploy --prod --yes
```

## Custom domain

Add `campusos.zhiyuapp.site` to the Vercel project, then create in Cloudflare:

```text
Type:    CNAME
Name:    campusos
Target:  f3b69826a4c4d637.vercel-dns-017.com
Proxy:   DNS only (grey cloud)
TTL:     Auto
```

Use the target printed by `vercel domains verify campusos.zhiyuapp.site`; it can change per project.

## Limitations

- This gateway forwards `x-forwarded-for`; Cloudflare rate limits should use a trusted client IP
  header rather than the Vercel function IP.
- Streaming SSE is passed through unchanged.
- `/_next/*` paths inside HTML, CSS, JS and RSC payloads are rewritten. If a future Next build
  starts using a different internal asset prefix, update `rewriteNextAssetPaths`.

# Workers AI 文生图工作室

Cloudflare Workers + Workers AI 的文生图页面，支持 10 个模型统一调用、
KV 出图缓存、每日 Neuron 额度估算与历史记录。

## 本地开发

    npm ci
    npm run dev        # http://localhost:8787

## 部署

推送到 main 分支由 Workers Builds 自动部署，
或手动执行 `npm run deploy`。

## 必需的前置资源

- KV 命名空间 `CACHE`
- Durable Object 类 `Quota`（SQLite 后端）
- Workers AI 绑定 `AI`

## 注意

免费额度 10,000 neurons/天（00:00 UTC 重置）。
FLUX.2 [dev] 单张约 3,750 neurons，建议日常用 FLUX.2 klein 4B（约 104/张）。

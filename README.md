# Model Price Show Hub

基于 Cloudflare Workers、D1、R2 和 React 的模型价格管理与公开展示平台。

## 本地运行（无需 Cloudflare 账号）

项目可以使用 Wrangler 的本地模拟 D1/R2，在没有 Cloudflare 账号的电脑上运行和测试。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev:local
```

Windows PowerShell：

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev:local
```

命令会自动应用本地数据库迁移、构建管理后台并启动 Worker。启动后访问 http://localhost:8787；默认管理员账号来自 `.dev.vars`，首次登录后需要修改密码。

需要同时查看公开站点时，另开终端执行：

```bash
npm run dev:public
```

然后访问 Vite 输出的地址（通常是 http://localhost:5173）。开发环境的公开站点会请求本地 Worker。

本地运行不会连接远程 Cloudflare 资源，也不需要 `wrangler login`。部署到 Cloudflare 需要账号并参阅 [Cloudflare 部署手册](docs/cloudflare-deployment.md)。更多脚本说明见 [scripts/README.md](scripts/README.md)，项目文档索引见 [docs/README.md](docs/README.md)。

## 验证

```bash
npm test
```

该命令执行类型检查、契约冒烟测试和隔离的本地 HTTP 集成测试。

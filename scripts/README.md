# 一键部署脚本

所有部署脚本从仓库根目录执行，要求已经安装依赖并完成 `npx wrangler login`。远程 D1 名称和 Pages/Worker 名称读取当前仓库配置，不需要重复填写。

## 本地启动（无需 Cloudflare 账号）

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

该命令会自动应用本地 D1 迁移、构建 Admin，并启动 `http://localhost:8787`。本地数据保存在 Wrangler 模拟存储中，不会读取或修改远程 Cloudflare 数据。公开端可另开终端运行 `npm run dev:public`。

## 常用命令

```bash
# 仅应用本地迁移
npm run deploy:db:local

# 应用远程 D1 迁移并显示迁移状态
npm run deploy:db

# 构建并部署 Admin Worker（包含 dry-run）
npm run deploy:admin

# 构建并部署 Public Pages（自动从 apps/public 部署，包含 Functions）
npm run deploy:public

# 完整上线：远程迁移 -> Admin -> Public
npm run deploy:all
```

默认部署到 Pages 的 `master` 分支（当前项目的 Production 分支）。若项目实际使用其他 Production 分支，可在 PowerShell 中设置：

```powershell
$env:CF_PAGES_BRANCH = "production"
npm run deploy:public
```

请确认 `model-price-public` 项目绑定的自定义域名就是 `models.tokenixs.com`，并在 Pages 控制台打开 Production 部署记录核对最新提交；不要把 Preview URL 或其他 Pages 项目绑定到主域名。

## 发布顺序

推荐执行 `npm run deploy:all`。脚本会先执行未应用的 D1 migration（包括 `0004_product_public_breakdown.sql`），然后构建并部署 Admin Worker，最后构建并从 `apps/public` 部署 Public Pages。

Public 使用 Pages Functions 的同源 `/backend` 代理，因此脚本不会设置 `VITE_PUBLIC_API_BASE`。脚本会从 `apps/public` 部署并带 `--commit-dirty`，同时上传 Functions 和最新静态资源；从错误目录部署可能导致 Functions 未上传，静态 JS 被 SPA 回退返回为 `text/html`，最终白屏。

Admin 由 Worker 的 `ASSETS` 直接托管，不存在 Pages 分支选择问题；`deploy-admin.mjs` 每次都会重新构建并部署 Worker。Admin 也配置了入口不缓存、静态资源长期缓存和独立 404 页面，若切换版本后仍加载旧 hash，请硬刷新一次。

发布后如果浏览器仍提示 JS 的 MIME 类型为 `text/html`，先执行硬刷新（Windows/Linux：`Ctrl+F5`，macOS：`Cmd+Shift+R`），或在 DevTools 的 Application 中清除该站点缓存后重新打开。确认旧资源 URL 返回 `200` 且 `Content-Type: application/javascript`。

仓库还包含 `apps/public/public/404.html`，用于防止不存在的静态资源被 Pages SPA 回退返回 `index.html`。如果持续出现旧 hash 资源错误，说明浏览器或边缘缓存仍持有旧入口文件，清除站点缓存后再访问即可。

Public 入口 JS 使用稳定路径 `/assets/app.js`，后续发布不会因为入口 hash 变化而引用不存在的旧文件；其他异步资源仍使用 hash 并由 Pages 正常缓存。

## 仅前端改动

只修改 Public 或 Admin 的样式、文案和组件时，不需要执行 D1 migration：

```bash
npm run deploy:admin   # Admin 有改动时执行
npm run deploy:public  # Public 有改动时执行
```

如果修改了 Worker SQL、产品字段或 migration，必须先执行 `npm run deploy:db`，再部署 Admin 和 Public。

## 发布前检查

```bash
npm run check
npm run build
npm run deploy:db:local
```

远程部署后可检查：

```bash
npx wrangler d1 migrations list model-price-db-production --remote
curl "https://example.com/backend/public/products?page=1&pageSize=20"
curl -I https://admin.example.com/health
```

脚本不会创建、删除或清空 Cloudflare 资源；`deploy:db` 只应用仓库中尚未执行的迁移。

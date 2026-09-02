# Cloudflare 部署手册

本文对应当前代码：主域名使用 Pages 公开站点，管理子域名使用 Worker 同源托管后台/API；D1 保存数据，R2 保存 PDF。命令使用 Wrangler 4。本文只提供操作步骤，不会自动替你修改 Cloudflare 账号。

## 1. 部署前准备

- 域名已添加到 Cloudflare，DNS 使用 Cloudflare 托管。
- 本地安装 Node.js LTS、npm，项目依赖已安装。
- 已准备 staging 和 production 两套资源；不要让测试数据写入生产。
- 准备首个超管用户名和至少 8 位密码，不要提交到 Git。

推荐命名：Pages `model-price-public`、Worker `model-price-admin`、D1 `model-price-db`、R2 `model-price-pdfs`；公开域名 `example.com`，后台域名 `admin.example.com`。

## 2. 登录和检查工具

```bash
npm install
npx wrangler login
npx wrangler whoami
npx wrangler --version
```

首次使用或配置修改后，先做本地检查：

```bash
npm run types
npm run check
npm run build
npx wrangler deploy --dry-run --env staging
npx wrangler check startup
npm test
```

`npm test` 现在包含两层验证：无 Cloudflare 凭据即可执行的契约检查，以及自动启动隔离本地 D1/R2 的 HTTP 集成测试。集成测试覆盖首次改密、登录失败审计、超管/运营权限、单用户 `allow/deny` 覆盖、产品发布、服务商停用联动、公开字段隔离、PDF 上传/恢复/撤下、报价资料和日志清理。

`wrangler.jsonc` 中的 `database_id` 必须替换为真实 D1 ID 后，才能执行远程迁移或部署。

当前仓库只提交资源名称和配置结构，不包含真实 D1 ID、Secret、域名或生产数据。完成 Cloudflare 账号准备后，先替换 staging/production 的占位 ID，再按本文顺序执行。

## 3. 创建 D1 数据库

分别创建 staging 和 production 数据库（建议名称带环境后缀）：

```bash
npx wrangler d1 create model-price-db-staging
npx wrangler d1 create model-price-db-production
```

把输出的 `database_id` 写入 `wrangler.jsonc` 对应环境的 `d1_databases` 配置。当前仓库的顶层配置仍包含占位值，正式部署前必须替换。

本地迁移：

```bash
npx wrangler d1 migrations apply model-price-db --local
```

迁移目录当前包含 `0001_initial.sql`（业务表）和 `0002_permissions.sql`（细粒度权限预留）。新环境必须按顺序执行全部迁移。

远程迁移（明确目标环境）：

```bash
npx wrangler d1 migrations apply model-price-db-staging --remote
npx wrangler d1 migrations apply model-price-db-production --remote
```

验证表结构：

```bash
npx wrangler d1 execute model-price-db-production --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
npx wrangler d1 migrations list model-price-db-production --remote
```

## 4. 创建 R2

```bash
npx wrangler r2 bucket create model-price-pdfs-staging
npx wrangler r2 bucket create model-price-pdfs-production
```

如果使用两个 Bucket，请同步修改 `wrangler.jsonc` 的 `bucket_name`。R2 不直接公开，PDF 必须通过 Worker `/api/public/products/:id/pdf` 路由访问。对象键格式为 `products/{productId}/pdf/{versionId}.pdf`。公开 API 会根据当前版本的 `show_download_button` 返回下载入口元数据；隐藏下载按钮只是界面约束，不能阻止浏览器保存已公开的 PDF 内容。

## 5. 配置 Worker

Worker 需要以下绑定：

- `DB`：D1 数据库。
- `PDF_BUCKET`：R2 Bucket。
- `ASSETS`：`apps/admin/dist` 管理端静态资源。

生产构建和预检：

```bash
npm run build:admin
npx wrangler deploy --dry-run --env staging
```

本地开发：

```bash
npx wrangler d1 migrations apply model-price-db --local
npx wrangler dev --local
```

只运行本地集成测试：

```bash
npm run test:integration
```

测试脚本使用临时 `--persist-to` 目录，不会读取或修改仓库现有 `.wrangler/state`；脚本结束后会尝试清理临时目录。若 Windows 正在占用 SQLite 文件，残留目录位于系统临时目录中，可在确认没有 Wrangler 进程后手动删除。

## 6. 初始化首个超管

使用 Wrangler 交互式 Secret，不要在命令行参数中写密码：

```bash
npx wrangler secret put INITIAL_ADMIN_USERNAME --env staging
npx wrangler secret put INITIAL_ADMIN_PASSWORD --env staging
npx wrangler secret put INITIAL_ADMIN_USERNAME --env production
npx wrangler secret put INITIAL_ADMIN_PASSWORD --env production
```

Worker 只有在 D1 中不存在任何超管时才创建首个超管，并把账号标记为首次登录必须改密。登录成功、完成改密并确认账号可用后，删除初始化 Secret：

```bash
npx wrangler secret delete INITIAL_ADMIN_USERNAME --env production
npx wrangler secret delete INITIAL_ADMIN_PASSWORD --env production
```

staging 同理处理。当前代码使用 Web Crypto PBKDF2 和随机会话令牌，不需要额外 `SESSION_SECRET` 才能运行；以后引入签名 Cookie 时再增加独立 Secret。

## 7. 部署管理 Worker

先部署 staging：

```bash
npx wrangler deploy --env staging
```

完成登录、产品、服务商、用户、日志和 PDF 冒烟测试后，再部署生产：

```bash
npx wrangler deploy --env production
```

管理 Worker 同时托管后台静态页面和 API，因此管理域名下的 `/api/*` 与页面同源，不需要跨域 Cookie。生产必须使用 HTTPS。

## 8. 部署公开 Pages

公开端必须在构建时指定 Worker 的公开 API 地址。PowerShell：

```powershell
$env:VITE_PUBLIC_API_BASE = "https://admin.example.com"
npm run build:public
npx wrangler pages project create model-price-public
npx wrangler pages deploy apps/public/dist --project-name model-price-public
```

Linux/macOS：

```bash
VITE_PUBLIC_API_BASE=https://admin.example.com npm run build:public
npx wrangler pages deploy apps/public/dist --project-name model-price-public
```

修改 API 域名后必须重新构建 Pages。Pages 构建产物中不能放 D1、R2、管理 Cookie、成本价或内部参考价。

## 9. 绑定自定义域名

在 Cloudflare Dashboard：

1. Pages 项目 `model-price-public` → Custom domains → 添加主域名，例如 `example.com`。
2. Worker `model-price-admin` → Settings → Domains & Routes → 添加 Custom Domain，例如 `admin.example.com`。
3. 确认 DNS 记录、SSL/TLS 和 HTTPS 均已生效。

检查响应：

```bash
curl -I https://example.com/
curl -I https://admin.example.com/health
```

公开响应应包含 `X-Robots-Tag: noindex, nofollow, noarchive`；管理域名不能继续使用 Worker 临时域名作为长期入口。

## 10. 生产发布顺序

1. 创建 production D1 和 R2，并填写真实 binding ID/名称。
2. 应用 D1 远程迁移，确认所有表存在。
3. 设置 production 初始化 Secret。
4. 部署 Worker，登录并完成首个超管改密。
5. 删除初始化 Secret。
6. 配置 `VITE_PUBLIC_API_BASE` 并部署 Pages。
7. 绑定主域名和管理子域名。
8. 用访客、运营人员、超管三种身份执行验收。

## 11. 上线验收清单

### 认证与权限

- [ ] 首个超管只初始化一次，首次登录强制改密。
- [ ] 停用账号立即失效，用户名不可修改或复用。
- [ ] 最后一个有效超管不能停用。
- [ ] 普通运营不能访问用户管理、完整日志和日志清理接口。
- [ ] 超管可读取/设置单用户权限覆盖；设置 `deny` 后对应接口立即返回 403，恢复 `allow` 后恢复访问。
- [ ] 用户、服务商、字典列表分页切换后总数和数据正确；产品列表搜索后分页会回到第 1 页。
- [ ] 登录、登出、改密、用户变更均有审计记录。

### 数据与公开隔离

- [ ] 草稿和停用产品不会出现在公开搜索、比价或 PDF 路由。
- [ ] 公开 API 不返回成本价、内部参考价、服务商、内部资源和运营备注。
- [ ] 对外展示价不能清空，已发布产品修改立即公开。
- [ ] 不同币种/计价单位不会跨组比较。
- [ ] 匿名比价先选择模型，产品列表和日志分页总数正确。

### PDF

- [ ] 只接受 PDF，单文件不超过 50 MB，并校验 `%PDF` 文件头。
- [ ] 上传必须经过公开安全确认，元数据和哈希写入 D1。
- [ ] 已发布产品上传或恢复版本后立即切换当前公开 PDF。
- [ ] 产品停用或 PDF 撤下后，旧公开 URL 返回 404。
- [ ] R2 Bucket 没有直接公开 URL。

### 运维

- [ ] `npm run check`、`npm run build` 和 `wrangler deploy --dry-run` 通过。
- [ ] `npm test`（含本地 HTTP 集成测试）通过；必要时单独运行 `npm run test:integration`。
- [ ] 生产 Secret 不在 Git、构建产物或日志中。
- [ ] 已配置 DNS、HTTPS、Worker 观测日志和基础告警。
- [ ] 已知日志清理不可恢复，且清理动作会留摘要日志。

## 12. 当前实现与上线前人工项

- 已实现：登录/改密、产品草稿与发布、三层价格校验、服务商停用联动、超管用户管理、PDF 版本历史、公开搜索/比价/参考报价单。
- 已实现：公开响应 `X-Robots-Tag`、R2 私有存储、公开 PDF 经过 Worker 路由、staging/production 配置分离；日志筛选/清理、服务商编辑、字典改名和列表分页。
- 已接入：`permissions` / `user_permissions` 表、权限种子和基础权限检查；上线初期普通运营仍拥有当前完整业务权限，后续可通过覆盖记录逐项收紧。
- 已接入：仅超管可调用的 `/api/admin/users/:id/permissions` 权限覆盖 API；第一期管理端暂不提供可视化权限矩阵。
- 已接入：管理端权限矩阵弹窗、用户/服务商/字典分页接口与分页控件；产品管理列表仍按页展示，报价单使用独立全量选择接口。
- 已接入：`/api/admin/products/options` 全量报价方案选择接口，运营报价单不再依赖当前产品分页；超管日志页提供 R2 孤立对象巡检（默认只读，二次确认后删除）。
- 上线前人工项：创建并填写真实 D1/R2 资源 ID，设置初始化 Secret，绑定主域名和 `admin` 子域名，完成首个超管改密并删除初始化 Secret。
- 上线前人工项：逐份确认运营上传 PDF 可公开，核对价格/币种/单位，执行访客、运营、超管三种身份验收；不要把 `.dev.vars` 纳入提交。

## 13. 已知限制与后续增强

- 当前未实现基于 IP 的应用层限流；上线前建议在 Cloudflare WAF/Rate Limiting 为登录和公开查询配置规则，并持续观察 Workers 日志。
- R2 上传与 D1 元数据写入目前是串行流程，异常时可能留下孤立 R2 对象；后续可增加补偿任务或定期一致性巡检。
- 已提供超管 R2 孤立对象巡检接口和管理端按钮；建议每周执行只读巡检，确认后再删除，并保留审计日志。
- 公开产品/比价接口使用 30 秒 `Cache-Control`，字典接口使用 5 分钟缓存；尚未接入按产品/版本主动失效的缓存键，变更后短窗口内可能仍看到旧缓存。
- 集成测试使用本地模拟 D1/R2，不能替代 staging 真实绑定、域名、HTTPS、WAF 和权限验收。

## 14. 常用运维命令

```bash
npx wrangler tail model-price-admin --env production
npx wrangler d1 info model-price-db-production
npx wrangler r2 bucket info model-price-pdfs-production
npx wrangler versions list --env production
npx wrangler rollback --env production
```

真实环境执行回滚、日志清理和远程 SQL 前，请先核对目标环境，避免误操作生产数据。

## 15. 备份、告警与限流 Runbook

建议至少每周执行一次 D1 备份并将文件保存到受控的加密存储（不要提交到 Git）：

```bash
npx wrangler d1 export model-price-db-production --remote --output backups/model-price-db-production-YYYYMMDD.sql
npx wrangler r2 object list model-price-pdfs-production
```

将 `YYYYMMDD` 替换为当天日期；PowerShell 可使用 `Get-Date -Format yyyyMMdd` 生成日期字符串。

恢复前必须先在 staging 验证备份文件，并安排维护窗口；不要直接覆盖生产数据库。R2 备份/生命周期规则目前需要在 Cloudflare Dashboard 或 R2 S3 API 中配置，建议保留至少 30 天版本并定期演练恢复。

在 Cloudflare Dashboard 为 Worker 配置以下告警：5xx 比例、D1/R2 异常、登录失败突增、CPU/请求量异常。为 `/api/auth/login`、`/api/public/products`、`/api/public/compare` 配置 Rate Limiting；当前 Worker 未内置 IP 计数器，WAF 规则是上线前必须项。

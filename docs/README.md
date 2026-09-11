# Model Price Show Hub 文档

本目录保存管理后台的需求、技术架构和 Cloudflare 部署说明。当前文档对应第一版已经确认的业务范围，后续实现或需求变更应同步更新。

## 文档索引

- [需求规格说明](./requirements.md)：已确认的业务规则、角色权限、页面功能和非目标范围。
- [技术架构与数据模型](./architecture.md)：部署拓扑、数据表、状态流转、接口边界和安全设计。
- [Cloudflare 部署手册](./cloudflare-deployment.md)：Pages、Workers、D1、R2、自定义域名和初始化流程。

## 无 Cloudflare 账号的本地启动

共享项目的人不需要 Cloudflare 账号即可在本地运行完整的 Worker、D1 和 R2 模拟环境。准备 Node.js LTS 后，在项目根目录执行：

```bash
npm install
```

首次运行时复制本地变量模板（不要提交 `.dev.vars`）：

```bash
cp .dev.vars.example .dev.vars
npm run dev:local
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run dev:local
```

`dev:local` 会自动应用本地 D1 迁移、构建管理后台并启动 Wrangler 本地 Worker。浏览器访问 `http://localhost:8787`，使用 `.dev.vars` 中的管理员账号登录；首次登录后系统会要求修改密码。公开站点需要另开终端执行 `npm run dev:public`，然后访问 Vite 显示的地址（通常为 `http://localhost:5173`），它会在开发环境请求本地 Worker。

本地启动不会连接远程 Cloudflare 资源，也不需要执行 `wrangler login`。远程部署命令（如 `npm run deploy:all`）仍然需要 Cloudflare 账号。

## 当前状态

- 参考页面：`temp/服务商管理台.html`
- 正式业务数据：不导入参考页面中的演示数据，首版通过后台手工录入。
- 应用代码：已完成 Worker API、D1 迁移、公开端服务端搜索/来源与产品线筛选/模型选择式匿名比价/参考报价单，以及管理端产品、服务商、内部比价、用户、报价资料代改、日志筛选和 PDF 版本操作界面。
- 数据库迁移 `0002_permissions.sql` 已预留按用户覆盖的细粒度权限键；第一期仍按角色统一授权。
- 本地验证：`npm test` 会执行 TypeScript 检查、契约冒烟测试和隔离本地 D1/R2 的 HTTP 集成测试；设置 `TEST_BASE_URL` 后契约脚本还会追加指定 Worker 的健康检查和公开分页接口检查。
- 细粒度权限：已提供仅超管可调用的 `/api/admin/users/:id/permissions` 覆盖 API，第一期不提供可视化权限矩阵。
- 当前仍需上线前人工确认：唯一远程 D1/R2 ID、域名绑定、初始化 Secret、PDF 内容合规和线上验收；暂不导入参考 HTML 演示数据。
- 远程部署不区分 staging/production，仅维护一套 Worker、D1 和 R2；本地测试使用 Wrangler 模拟存储。
- 部署目标：主域名使用 Pages 公开站点，管理子域名使用 Worker 同源托管后台和 API。

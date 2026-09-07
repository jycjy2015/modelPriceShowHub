# Model Price Show Hub 文档

本目录保存管理后台的需求、技术架构和 Cloudflare 部署说明。当前文档对应第一版已经确认的业务范围，后续实现或需求变更应同步更新。

## 文档索引

- [需求规格说明](./requirements.md)：已确认的业务规则、角色权限、页面功能和非目标范围。
- [技术架构与数据模型](./architecture.md)：部署拓扑、数据表、状态流转、接口边界和安全设计。
- [Cloudflare 部署手册](./cloudflare-deployment.md)：Pages、Workers、D1、R2、自定义域名和初始化流程。

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

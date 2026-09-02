# 技术架构与数据模型

## 1. 总体拓扑

```text
访客浏览器
    |
    v
主域名 Pages（公开 React 前端）
    | 公开查询/比价/PDF 请求
    v
管理 Worker（公开 API + 管理 API + 后台静态资源）
    |                 |
    v                 v
   D1                R2
（业务数据/会话/日志） （PDF 文件）

运营浏览器
    |
    v
admin 子域名 Worker（后台 React 前端和同源管理 API）
```

主域名和管理子域名使用不同入口。管理 Worker 可以同时处理公开 API 和管理 API，但必须按请求身份、Host 和路由进行字段级权限控制。公开端只拿到公开 DTO，不能通过前端隐藏来代替服务端授权。

## 2. 前端与代码组织建议

- `apps/public`：公开站点，部署到 Pages。
- `apps/admin`：管理端 React 应用，构建后由管理 Worker 的静态资源能力托管。
- `packages/shared`：TypeScript 类型、价格校验、字典常量和 API 客户端。
- `worker`：Worker 路由、认证中间件、D1/R2 服务和公开 DTO 转换。
- `db/migrations`：D1 SQL 迁移脚本。

前端使用 React + TypeScript + Vite。管理端与 API 同源，公开端通过 HTTPS 调用 Worker 的公开接口；若公开端和 API 使用不同子域名，需要显式 CORS 白名单、禁止凭据跨域，并避免把管理 Cookie 发送到公开域名。

## 3. 核心数据表

以下是第一版建议的逻辑结构，实际字段类型和索引在建表迁移时确定。

### `users`

- `id`、`username`（唯一且不可修改）、`display_name`。
- `role`：`super_admin` / `operator`。
- `password_hash`、`must_change_password`、`status`、`created_at`、`updated_at`、`last_login_at`。
- 不物理删除；停用用户的关联数据和日志继续保留。

### `sessions`

- `id`、`user_id`、`token_hash`、`expires_at`、`created_at`、`revoked_at`。
- 只保存会话令牌哈希，Cookie 中保存不可读的随机令牌。

### `providers`

- `id`、`name`、`alias`、`status`、`created_at`、`updated_at`、`updated_by`。
- 只能停用，不能永久删除；停用触发关联产品停止公开。

### `dictionaries`

- `id`、`type`（model/brand/origin/product_line）、`name`、`status`、`created_at`、`updated_at`、`updated_by`。
- `type + name` 唯一；已引用项只能停用。

### `products`

- 关联：`provider_id`、`model_id`、`brand_id`、`origin_id`、`product_line_id`。
- 内部：`internal_resource`、`tier`、`internal_note`、`reference_tpm`、`service_note`。
- 公开：`public_name`、`public_description`。
- 状态：`draft` / `published` / `disabled`。
- 三层价格分别保存 `cost_min/cost_max`、`internal_min/internal_max`、`public_min/public_max`，以及 `currency`、`unit`。
- 发布相关：`published_at`、`published_by`、`updated_at`、`updated_by`。
- 对外展示价不能为空；发布时内部参考价不能为空。

### `product_pdf_versions`

- `id`、`product_id`、`version_no`、`r2_object_key`、`original_filename`、`public_filename`、`file_size`、`sha256`。
- `show_download_button`、`public_status`、`uploaded_by`、`uploaded_at`、`withdrawn_at`。
- 产品通过 `current_pdf_version_id` 指向当前公开版本；历史版本不删除。

### `user_quote_profiles`

- `user_id`（唯一）、`company_name`、`brand_name`、`contact_name`、`phone`、`email`、`updated_at`、`updated_by`。
- 用于运营报价单的默认供方信息；本次临时改动不持久化。

### `audit_logs`

- `id`、`actor_user_id`、`actor_username_snapshot`、`role`。
- `action`、`target_type`、`target_id`、`before_json`、`after_json`、`summary`。
- `result`、`request_id`、`ip`、`user_agent`、`created_at`。
- 对密码、令牌、PDF 正文和报价客户信息做字段过滤或摘要化。

### `permissions` / `user_permissions`

- `permissions` 维护可拆分的权限键（如 `product.write`、`product.publish`、`audit.purge`）。
- `user_permissions` 允许对单个用户设置 `allow`/`deny` 覆盖；当前已接入权限检查，普通运营默认拥有业务权限，超管默认全部放行。
- `GET/PATCH /api/admin/users/:id/permissions` 仅超管可调用，用于读取或设置覆盖规则；第一期管理端不提供可视化权限矩阵，但接口和数据表已为后续收紧权限预留。

## 4. 状态与关键规则

### 产品发布

1. 新增产品写入 `draft`。
2. 发布时校验对外展示价和内部参考价完整，价格区间合法。
3. 发布成功后更新 `published_at/published_by`，公开 API 立即可见。
4. 已发布产品的公开字段、对外价格、参考 TPM、质保说明和当前 PDF 更新后立即生效。
5. 停用后公开 API 过滤，重新启用不会自动发布。

### PDF 发布

1. Worker 校验上传者角色、文件大小、Content-Type 和 PDF 文件头。
2. 上传者必须提交公开合规确认。
3. 文件先写 R2，再写 D1 元数据；任一步失败都不能切换当前公开指针。
4. 已发布产品上传成功后更新 `current_pdf_version_id`。
5. 恢复历史版本只切换指针并记日志，不复制或删除 R2 对象。

### 超管保护

- 创建/停用超管前检查有效超管数量，禁止使其变为零。
- 日志清理只能由超管执行，记录截止时间、执行人和删除条数摘要。
- 密码重置、账号停用和角色变更应撤销目标用户全部会话。

## 5. API 边界建议

公开 API（无需登录）：

- `GET /api/public/products`
- `GET /api/public/compare`
- `GET /api/public/dictionaries`（仅返回 active 的模型、品牌、来源、产品线）
- `GET /api/public/products/:id/pdf`

管理 API（必须登录并做权限检查）：

- `POST/GET/PATCH /api/admin/products`
- `GET /api/admin/compare?model=...&productLine=...`（登录运营人员可见，返回三层价格与服务商）
- `GET /api/admin/products/options?status=published|all`（运营报价单全量选择，返回公开报价字段，不受产品分页限制）
- `POST/GET/PATCH /api/admin/providers`
- `POST/GET/PATCH /api/admin/dictionaries`
- `POST /api/admin/products/:id/pdf`
- `POST /api/admin/products/:id/pdf/:versionId/restore`
- `POST /api/admin/products/:id/pdf/:versionId/withdraw`
- `GET/POST/PATCH /api/admin/dictionaries`
- `GET/POST/PATCH /api/admin/users`
- `GET /api/admin/audit-logs`、`POST /api/admin/audit-logs/purge`
- `POST /api/admin/maintenance/r2-audit`（仅超管；默认巡检，`confirm=true` 时删除未被 D1 引用的孤立对象）
- `GET/PATCH /api/admin/users/:id/permissions`（仅超管，维护单用户 `allow/deny` 覆盖）
- `GET/PATCH /api/me/quote-profile`
- `POST /api/me/quote-generated`（仅记录运营报价单生成事件，不保存报价正文）

认证 API：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/auth/me`

公开接口返回专门的公开 DTO，不应直接序列化 `products` 数据库行。管理接口也应按权限过滤字段，以便未来收紧成本价和发布权限。

当前已落地的 Worker 路由包括登录/登出、当前用户、公开产品列表、公开 PDF、产品 CRUD/发布/停用、服务商 CRUD、字典 CRUD、PDF 版本上传/恢复/撤下、超管用户管理和审计日志查询/清理。管理端已接入产品新增/编辑、三层价格、服务商启停、用户创建/角色状态/密码重置、PDF 历史版本和公开确认流程；公开端已接入搜索、匿名比价和只使用对外价的参考报价单。
公开端产品搜索和来源/产品线筛选均由 Worker 服务端执行，筛选项从公开字典接口加载；匿名比价要求先选择模型，后端按币种/计价单位分组返回。管理端支持按模型/产品线查看内部比价（服务商、成本价、内部参考价和对外价）。运营报价单生成只记录事件摘要，不保存报价正文。管理端日志支持时间、操作者、动作、对象类型和结果筛选、分页及二次确认清理。产品和公开目录接口均返回真实总数用于分页。

## 6. 缓存与安全

- 公开搜索和比价当前使用短时客户端/CDN缓存头；产品、服务商或 PDF 状态变更后的主动缓存键失效仍待接入统一缓存层。
- 公开响应添加 `X-Robots-Tag: noindex, nofollow, noarchive`；提供 `robots.txt`。
- PDF 通过 Worker 路由访问，不直接暴露 R2 对象地址；路由校验产品已发布、版本未撤下且存在当前指针。
- 管理 API 使用 CSRF 防护（同源校验 + CSRF Token 或等效方案）、输入校验和统一错误格式。
- 公共接口按 IP 限流；登录接口预留后续加入 Turnstile/更强限流的入口。
- PDF 上传在 D1 元数据写入失败时会尝试删除已写入的 R2 对象，避免孤立文件；生产仍建议通过定期巡检补偿极端故障。

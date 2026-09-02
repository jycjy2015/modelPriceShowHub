-- 预留细粒度权限：第一期仍由角色统一放行，后续可按用户覆盖。
CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('product.read', '查看产品与内部字段'),
  ('product.write', '新增和修改产品'),
  ('product.publish', '发布或停用产品'),
  ('provider.write', '维护服务商'),
  ('dictionary.write', '维护字典'),
  ('pdf.write', '上传和管理 PDF'),
  ('quote.write', '维护个人报价资料并生成报价单'),
  ('user.manage', '管理用户与角色'),
  ('audit.read', '查看操作日志'),
  ('audit.purge', '清理操作日志');

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id),
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, permission_key)
);

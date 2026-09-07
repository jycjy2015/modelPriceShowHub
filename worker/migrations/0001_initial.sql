PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'operator')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dictionaries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('model', 'brand', 'origin', 'product_line')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id),
  UNIQUE(type, name)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  model_id TEXT NOT NULL REFERENCES dictionaries(id),
  brand_id TEXT NOT NULL REFERENCES dictionaries(id),
  origin_id TEXT NOT NULL REFERENCES dictionaries(id),
  product_line_id TEXT NOT NULL REFERENCES dictionaries(id),
  internal_resource TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  public_name TEXT NOT NULL,
  public_description TEXT NOT NULL DEFAULT '',
  reference_tpm TEXT,
  service_note TEXT NOT NULL DEFAULT '',
  cost_min REAL,
  cost_max REAL,
  internal_min REAL,
  internal_max REAL,
  public_min REAL NOT NULL,
  public_max REAL NOT NULL,
  currency TEXT NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
  current_pdf_version_id TEXT,
  published_at TEXT,
  published_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id),
  CHECK (public_min <= public_max),
  CHECK (cost_min IS NULL OR cost_max IS NULL OR cost_min <= cost_max),
  CHECK (internal_min IS NULL OR internal_max IS NULL OR internal_min <= internal_max)
);
CREATE INDEX IF NOT EXISTS idx_products_status_updated ON products(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS product_pdf_versions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  version_no INTEGER NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  public_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  show_download_button INTEGER NOT NULL DEFAULT 1,
  public_status TEXT NOT NULL DEFAULT 'private' CHECK (public_status IN ('private', 'public', 'withdrawn')),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  UNIQUE(product_id, version_no)
);

CREATE TABLE IF NOT EXISTS user_quote_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_name TEXT NOT NULL DEFAULT '',
  brand_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  actor_username_snapshot TEXT NOT NULL DEFAULT 'anonymous',
  role TEXT NOT NULL DEFAULT 'anonymous',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  summary TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success',
  request_id TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);

import {
  StrictMode,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type SessionUser = {
  id: string;
  username: string;
  display_name?: string;
  displayName?: string;
  role: "super_admin" | "operator";
  must_change_password?: number;
  mustChangePassword?: boolean;
};
type Product = {
  id: string;
  status: string;
  publicName: string;
  publicDescription?: string;
  model: string;
  providerName: string;
  providerId: string;
  modelId: string;
  brandId: string;
  originId: string;
  productLineId: string;
  productLine?: string;
  origin?: string;
  publicMin: number;
  publicMax: number;
  internalMin: number | null;
  internalMax: number | null;
  costMin: number | null;
  costMax: number | null;
  currency: string;
  unit: string;
  internalResource?: string;
  tier?: string;
  internalNote?: string;
  referenceTpm?: string | null;
  officialInputMin?: string | number | null;
  officialOutputMin?: string | number | null;
  cacheHitPercent?: string | null;
  officialCacheHitPrice?: string | null;
  updatedAt: string;
};
type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt?: string;
};
type LogRow = {
  id: string;
  actorUsername: string;
  action: string;
  targetType: string;
  summary: string;
  createdAt: string;
  result: string;
};
type LogFilters = {
  after: string;
  before: string;
  actor: string;
  action: string;
  targetType: string;
  result: string;
};
type Provider = { id: string; name: string; alias: string; status: string };
type Dictionary = {
  id: string;
  type: "model" | "brand" | "origin" | "product_line";
  name: string;
  status: string;
};
type PdfVersion = {
  id: string;
  versionNo: number;
  originalFilename: string;
  fileSize: number;
  showDownloadButton: number;
  publicStatus: string;
  uploadedAt: string;
};
type PageMeta = { page: number; pageSize: number; total: number };
type PermissionRow = { key: string; description: string; effect: "allow" | "deny" | null };

function Pagination({ meta, onPage, onPageSize }: { meta: PageMeta; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  return (
    <div className="pagination">
      <span>共 {meta.total} 条，第 {meta.page} / {pages} 页</span>
      <span>
        <select value={meta.pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label="每页数量">
          <option value={20}>20 条/页</option><option value={50}>50 条/页</option><option value={100}>100 条/页</option>
        </select>
        <button disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>上一页</button>
        <button disabled={meta.page >= pages} onClick={() => onPage(meta.page + 1)}>下一页</button>
      </span>
    </div>
  );
}

function formatInternalPrice(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string,
  _unit?: string,
) {
  if (min == null && max == null) return "—";
  const low = min ?? max;
  const high = max ?? min;
  const range = low === high ? String(low) : `${low} – ${high}`;
  return `${range} 折`;
}
function formatSinglePrice(value: number | null | undefined, currency: string) {
  return value == null ? "—" : `${value} 折`;
}

function OperatorQuote({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [profile, setProfile] = useState({
    companyName: "",
    brandName: "",
    contactName: "",
    phone: "",
    email: "",
  });
  const [prices, setPrices] = useState<
    Record<string, { min: string; max: string }>
  >({});
  const [saved, setSaved] = useState("");
  const [quoteError, setQuoteError] = useState("");
  useEffect(() => {
    void requestJson<{ data: typeof profile }>("/api/me/quote-profile")
      .then((r) => setProfile(r.data))
      .catch(() => undefined);
  }, []);
  const chosen = products.filter((item) => selected.includes(item.id));
  const toggle = (item: Product) => {
    setSelected((current) =>
      current.includes(item.id)
        ? current.filter((id) => id !== item.id)
        : [...current, item.id],
    );
    setPrices((current) => ({
      ...current,
      [item.id]: current[item.id] ?? {
        min: String(item.publicMin),
        max: String(item.publicMax),
      },
    }));
  };
  const saveProfile = async () => {
    await requestJson("/api/me/quote-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setSaved("报价资料已保存");
  };
  const printQuote = async () => {
    const invalid = chosen.find((item) => {
      const value = prices[item.id] ?? {
        min: String(item.publicMin),
        max: String(item.publicMax),
      };
      const min = Number(value.min);
      const max = Number(value.max);
      const decimals = (raw: string) => raw.split(".")[1]?.length ?? 0;
      return (
        !value.min.trim() ||
        !value.max.trim() ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max < 0 ||
        min > max ||
        decimals(value.min) > 4 ||
        decimals(value.max) > 4
      );
    });
    if (invalid) {
      setQuoteError("请检查临时报价：必须为非负数字，最低价不得高于最高价，且最多 4 位小数。");
      return;
    }
    setQuoteError("");
    try {
      await requestJson("/api/me/quote-generated", { method: "POST" });
    } catch {
      // Printing remains available if audit logging is temporarily unavailable.
    }
    window.print();
  };
  return (
    <div className="quote-workspace">
      <div className="quote-workspace-grid">
        <div className="table-card">
          <div className="table-head">
            <div>
              <span className="section-kicker">OPERATOR QUOTE</span>
              <h2>选择公开方案</h2>
            </div>
            <span className="muted">临时报价不会修改产品</span>
          </div>
          <div className="product-table">
            {products
              .filter((item) => item.status === "published")
              .map((item) => (
                <label className="quote-select-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggle(item)}
                  />
                  <span>
                    <b>
                      {item.model} · {item.publicName}
                    </b>
                    <small>
                      {item.providerName} · {item.currency} / {item.unit}
                    </small>
                  </span>
                  <strong>
                    {item.publicMin} 折
                  </strong>
                </label>
              ))}
          </div>
        </div>
        <div className="table-card quote-profile-card">
          <div>
            <span className="section-kicker">QUOTE PROFILE</span>
            <h2>报价资料</h2>
          </div>
          {(
            [
              "companyName",
              "brandName",
              "contactName",
              "phone",
              "email",
            ] as const
          ).map((key) => (
            <label className="form-field" key={key}>
              {
                {
                  companyName: "公司名称",
                  brandName: "品牌名称",
                  contactName: "联系人",
                  phone: "联系电话",
                  email: "邮箱",
                }[key]
              }
              <input
                value={profile[key]}
                onChange={(e) =>
                  setProfile({ ...profile, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <button className="secondary" onClick={() => void saveProfile()}>
            保存资料
          </button>
          {saved && <small className="muted">{saved}</small>}
        </div>
      </div>
      {chosen.length > 0 && (
        <div className="table-card operator-quote-card">
          <div className="table-head">
            <div>
              <span className="section-kicker">DRAFT DOCUMENT</span>
              <h2>本次报价</h2>
            </div>
            <button className="primary" onClick={() => void printQuote()}>
              打印 / 另存为 PDF
            </button>
          </div>
          {quoteError && <div className="form-error">{quoteError}</div>}
          <div className="operator-quote-sheet">
            <div className="quote-brand">
              {profile.brandName || profile.companyName || "MODEL PRICE HUB"}
            </div>
            <p className="quote-warning">最终价格及服务条款以商务确认为准</p>
            <table>
              <thead>
                <tr>
                  <th>模型 / 方案</th>
                  <th>服务商</th>
                  <th>本次最低折扣率</th>
                  <th>本次最高折扣率</th>
                </tr>
              </thead>
              <tbody>
                {chosen.map((item) => {
                  const value = prices[item.id] ?? {
                    min: String(item.publicMin),
                    max: String(item.publicMax),
                  };
                  return (
                    <tr key={item.id}>
                      <td>
                        <b>{item.model}</b>
                        <br />
                        {item.publicName}
                      </td>
                      <td>{item.providerName}</td>
                      <td>
                        <input
                          type="number"
                          step="0.0001"
                          value={value.min}
                          onChange={(e) =>
                            setPrices({
                              ...prices,
                              [item.id]: { ...value, min: e.target.value },
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.0001"
                          value={value.max}
                          onChange={(e) =>
                            setPrices({
                              ...prices,
                              [item.id]: { ...value, max: e.target.value },
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function QuoteProfileEditor({
  user,
  onDone,
  onCancel,
}: {
  user: UserRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [profile, setProfile] = useState({
    companyName: "",
    brandName: "",
    contactName: "",
    phone: "",
    email: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void requestJson<{ data: typeof profile }>(
      `/api/me/quote-profile?userId=${encodeURIComponent(user.id)}`,
    )
      .then((response) => setProfile(response.data))
      .catch(() => setError("报价资料加载失败"))
      .finally(() => setLoading(false));
  }, [user.id]);
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/me/quote-profile?userId=" + encodeURIComponent(user.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      onDone();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "保存失败"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={save}>
        <div className="modal-head">
          <div>
            <span className="section-kicker">QUOTE PROFILE</span>
            <h2>编辑 {user.displayName} 的报价资料</h2>
          </div>
          <button type="button" className="icon-button" onClick={onCancel}>
            ×
          </button>
        </div>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="form-grid compact">
          {(
            [
              ["companyName", "公司名称"],
              ["brandName", "品牌名称"],
              ["contactName", "联系人"],
              ["phone", "联系电话"],
              ["email", "邮箱"],
            ] as const
          ).map(([key, label]) => (
            <label className="form-field" key={key}>
              {label}
              <input
                value={profile[key]}
                disabled={loading}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            取消
          </button>
          <button className="primary" disabled={loading || saving}>
            保存资料
          </button>
        </div>
      </form>
    </div>
  );
}

function PermissionEditor({ user, onDone, onCancel }: { user: UserRow; onDone: () => void; onCancel: () => void }) {
  const [rows, setRows] = useState<PermissionRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void requestJson<{ data: PermissionRow[] }>(`/api/admin/users/${user.id}/permissions`).then((r) => setRows(r.data)).catch(() => setError("权限加载失败"));
  }, [user.id]);
  const save = async (row: PermissionRow, effect: PermissionRow["effect"]) => {
    try {
      await requestJson(`/api/admin/users/${user.id}/permissions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissionKey: row.key, effect }) });
      setRows((current) => current.map((item) => item.key === row.key ? { ...item, effect } : item));
    } catch { setError("权限保存失败"); }
  };
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-head"><div><span className="section-kicker">PERMISSIONS</span><h2>{user.displayName} 的权限</h2></div><button type="button" className="icon-button" onClick={onCancel}>×</button></div>{error && <div className="form-error">{error}</div>}<div className="product-table">{rows.map((row) => <div className="product-row" key={row.key}><span><b>{row.key}</b><small>{row.description}</small></span><span>{row.effect === "allow" ? "允许" : row.effect === "deny" ? "禁止" : "跟随角色默认"}</span><span className="row-actions"><button onClick={() => void save(row, "allow")}>允许</button><button onClick={() => void save(row, "deny")}>禁止</button></span></div>)}</div><div className="modal-actions"><button className="secondary" onClick={onDone}>完成</button></div></div></div>;
}

const requestJson = async <T,>(url: string, options?: RequestInit) => {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (!contentType.includes("application/json"))
    throw new Error(`api_not_reached:${response.status}:${raw.slice(0, 120)}`);
  const payload = JSON.parse(raw) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "request_failed");
  return payload;
};
const errorText = (value: unknown) => {
  if (String(value).startsWith("api_not_reached:"))
    return "请求未到达 Worker，请检查登录状态或部署路由";
  return ({
    required_product_field_missing: "请填写所有必填字段",
    invalid_public_price_range: "对外价格区间无效",
    internal_price_required_to_publish: "发布前必须填写内部参考价",
    invalid_price: "价格必须是数字",
    price_precision_exceeded: "价格最多保留 4 位小数",
    last_super_admin_protected: "不能停用或降级最后一个超管",
    password_too_short: "密码至少 8 位",
    public_confirmation_required: "请确认 PDF 适合公开展示",
    api_not_reached: "登录接口未到达 Worker，请检查部署路由配置",
    database_unavailable: "数据库暂不可用，请检查 D1 绑定",
    internal_error: "服务端初始化失败，请检查 Worker 日志",
    bootstrap_db_read_failed: "初始账号创建失败：无法读取 D1",
    bootstrap_password_hash_failed: "初始账号创建失败：密码哈希不受当前 Worker 运行环境支持",
    bootstrap_db_write_failed: "初始账号创建失败：无法写入 D1",
  })[String(value)] ?? String(value);
};

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [error, setError] = useState("");
  return (
    <main className="login-shell">
      <div className="login-art">
        <span className="eyebrow">OPERATIONS / PRIVATE SPACE</span>
        <h1>
          让每一次
          <br />
          <em>报价有据可循。</em>
        </h1>
        <p>产品、价格、资料和操作记录，统一在这里维护。</p>
      </div>
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const form = new FormData(event.currentTarget);
          try {
            const payload = await requestJson<{ data: { user: SessionUser } }>(
              "/api/auth/login",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  username: form.get("username"),
                  password: form.get("password"),
                }),
              },
            );
            onLogin(payload.data.user);
          } catch (cause) {
            const code = cause instanceof Error ? cause.message : "request_failed";
            setError(code === "invalid_credentials" ? "账号或密码不正确，请重试" : errorText(code));
          }
        }}
      >
        <div className="brand-mark">
          MP<span>/</span>HUB
        </div>
        <h2>运营登录</h2>
        <p className="muted">使用分配的账号进入管理台</p>
        <label>
          用户名
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit">
          进入后台 <span>↗</span>
        </button>
        <small>由管理 Worker 提供同源认证</small>
      </form>
    </main>
  );
}
function PasswordChange({ onComplete }: { onComplete: () => void }) {
  const [error, setError] = useState("");
  return (
    <main className="login-shell">
      <div className="login-art">
        <span className="eyebrow">SECURITY / FIRST LOGIN</span>
        <h1>
          先换一把
          <br />
          <em>自己的钥匙。</em>
        </h1>
        <p>初始密码只能使用一次。修改后需要重新登录。</p>
      </div>
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const form = new FormData(event.currentTarget);
          const next = String(form.get("newPassword") ?? "");
          if (next !== String(form.get("confirmPassword") ?? "")) {
            setError("两次输入的新密码不一致");
            return;
          }
          try {
            await requestJson("/api/auth/change-password", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                currentPassword: form.get("currentPassword"),
                newPassword: next,
              }),
            });
            onComplete();
          } catch (cause) {
            setError(
              errorText(cause instanceof Error ? cause.message : "修改失败"),
            );
          }
        }}
      >
        <div className="brand-mark">
          MP<span>/</span>HUB
        </div>
        <h2>修改初始密码</h2>
        <p className="muted">新密码至少 8 位，完成后重新登录</p>
        <label>
          当前密码
          <input name="currentPassword" type="password" required />
        </label>
        <label>
          新密码
          <input name="newPassword" type="password" minLength={8} required />
        </label>
        <label>
          确认新密码
          <input
            name="confirmPassword"
            type="password"
            minLength={8}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit">保存并退出</button>
      </form>
    </main>
  );
}

function SearchableSelect({
  name, label, value, options, onChange, onCreate,
}: { name: string; label: string; value: string; options: { id: string; name: string; status?: string }[]; onChange: (id: string) => void; onCreate: (name: string) => Promise<string | undefined> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(value);
  const selected = options.find((item) => item.id === selectedId);
  const matches = options.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const create = async () => { const nameValue = query.trim(); if (!nameValue) return; const id = await onCreate(nameValue); if (id) { setSelectedId(id); onChange(id); setQuery(""); setOpen(false); } };
  return <label className="form-field searchable-field">{label}<input type="hidden" name={name} value={selectedId} /><div className="search-select"><button type="button" className="search-select-trigger" onClick={() => setOpen(!open)}>{selected?.name ?? "请选择"}<span>⌄</span></button>{open && <div className="search-select-menu"><input autoFocus placeholder="搜索或输入新分组" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />{matches.map((item) => <button type="button" key={item.id} disabled={item.status === "disabled"} onClick={() => { setSelectedId(item.id); onChange(item.id); setOpen(false); setQuery(""); }}>{item.name}{item.status === "disabled" ? "（已停用）" : ""}</button>)}{query.trim() && !matches.some((item) => item.name.toLowerCase() === query.trim().toLowerCase()) && <button type="button" className="create-option" onClick={() => void create()}>创建 “{query.trim()}”</button>}</div>}</div></label>;
}

function ProductForm({
  initial,
  providers,
  dictionaries,
  onDone,
  onCancel,
  copy = false,
}: {
  initial?: Product;
  providers: Provider[];
  dictionaries: Dictionary[];
  onDone: () => void;
  onCancel: () => void;
  copy?: boolean;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [providerOptions, setProviderOptions] = useState<Provider[]>(providers);
  const [dictionaryOptions, setDictionaryOptions] = useState<Dictionary[]>(dictionaries);
  const createProvider = async (name: string) => { const alias = window.prompt("服务商别名（可选）", "") ?? ""; try { const r = await requestJson<{ data: { id: string } }>("/api/admin/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, alias }) }); const item: Provider = { id: r.data.id, name, alias, status: "active" }; setProviderOptions((v: Provider[]) => [...v, item]); return item.id; } catch { setError("服务商创建失败"); return undefined; } };
  const createDictionary = async (type: Dictionary["type"], name: string) => { try { const r = await requestJson<{ data: { id: string } }>("/api/admin/dictionaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, name }) }); const item: Dictionary = { id: r.data.id, type, name, status: "active" }; setDictionaryOptions((v: Dictionary[]) => [...v, item]); return item.id; } catch { setError("字典项创建失败"); return undefined; } };
  const dict = (type: Dictionary["type"]) =>
    dictionaries.filter(
      (item) => item.type === type && item.status === "active",
    );
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    const f = new FormData(event.currentTarget);
    const value = (key: string) => String(f.get(key) ?? "");
    const body = {
      providerId: value("providerId"),
      modelId: value("modelId"),
      brandId: value("brandId"),
      originId: value("originId"),
      productLineId: value("productLineId"),
      publicName: value("publicName"),
      publicDescription: value("publicDescription"),
      referenceTpm: value("referenceTpm"),
      costMin: value("costPrice"),
      internalMin: value("internalMin"),
      internalMax: value("internalMax"),
      publicMin: value("publicPrice"),
      publicMax: value("publicPrice"),
      currency: value("currency"),
      unit: initial?.unit ?? "",
      officialInputMin: value("officialInputPrice"), officialInputMax: value("officialInputPrice"),
      officialOutputMin: value("officialOutputPrice"), officialOutputMax: value("officialOutputPrice"),
      cacheHitPercent: value("cacheHitPercent"),
      officialCacheHitPrice: value("officialCacheHitPrice"),
    };
    try {
      await requestJson(
        initial && !copy ? `/api/admin/products/${initial.id}` : "/api/admin/products",
        {
          method: initial && !copy ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      onDone();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "保存失败"));
    } finally {
      setSaving(false);
    }
  };
  const field = (
    name: string,
    label: string,
    type = "text",
    required = false,
    step?: string,
    valueOverride?: string,
  ) => (
    <label className="form-field">
      {label}
      <input
        name={name}
        type={type}
        step={step}
        required={required}
        defaultValue={valueOverride ?? (
          ((initial as Record<string, unknown> | undefined)?.[
            name === "costPrice"
              ? "costMin"
              : name === "publicPrice"
                ? "publicMin"
                : name === "officialInputPrice"
                  ? "officialInputMin"
                  : name === "officialOutputPrice"
                    ? "officialOutputMin"
                    : name
          ] as
            | string
            | number
            | undefined) ?? ""
        )}
      />
    </label>
  );
  return (
    <div className="modal-backdrop">
      <form className="modal-card product-form" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <span className="section-kicker">CATALOG EDITOR</span>
          <h2>{copy ? "复制产品" : initial ? "编辑产品" : "新增产品"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="form-grid">
          <SearchableSelect name="providerId" label="服务商" value={initial?.providerId ?? ""} options={providerOptions} onChange={() => {}} onCreate={createProvider} />
          <SearchableSelect name="modelId" label="模型" value={initial?.modelId ?? ""} options={dictionaryOptions.filter((d) => d.type === "model")} onChange={() => {}} onCreate={(n) => createDictionary("model", n)} />
          <SearchableSelect name="brandId" label="品牌" value={initial?.brandId ?? ""} options={dictionaryOptions.filter((d) => d.type === "brand")} onChange={() => {}} onCreate={(n) => createDictionary("brand", n)} />
          <SearchableSelect name="originId" label="来源" value={initial?.originId ?? ""} options={dictionaryOptions.filter((d) => d.type === "origin")} onChange={() => {}} onCreate={(n) => createDictionary("origin", n)} />
          <SearchableSelect name="productLineId" label="产品线" value={initial?.productLineId ?? ""} options={dictionaryOptions.filter((d) => d.type === "product_line")} onChange={() => {}} onCreate={(n) => createDictionary("product_line", n)} />
          {field("publicName", "对外方案名称", "text", true, undefined, copy ? `${initial?.publicName ?? ""} - 副本` : undefined)}
          {field("publicDescription", "公开说明")}
          {field("referenceTpm", "参考 TPM（可填 500-1000w）")}
          {field("cacheHitPercent", "缓存命中比例（如大于60%）")}
        </div>
        <div className="price-grid">
          <div>
            <h3>供应商成本折扣率</h3>
            <div className="inline-fields">
              {field("costPrice", "折扣率", "number", false, "0.0001")}
            </div>
          </div>
          <div>
            <h3>内部参考折扣率</h3>
            <div className="inline-fields">
              {field("internalMin", "最低", "number", false, "0.0001")}
              {field("internalMax", "最高", "number", false, "0.0001")}
            </div>
          </div>
          <div>
            <h3>对外展示折扣率</h3>
            <div className="inline-fields">
              {field("publicPrice", "折扣率", "number", true, "0.0001")}
            </div>
          </div>
        </div>
        <div className="form-grid compact">
          <label className="form-field">币种<select name="currency" required defaultValue={initial?.currency ?? "USD"}><option value="USD">$ 美元（USD）</option><option value="CNY">¥ 人民币（CNY）</option></select></label>
        </div>
        <div className="price-grid public-breakdown"><div><h3>官网输入价</h3>{field("officialInputPrice", "每 1M tokens", "number", false, "0.0001")}</div><div><h3>官网输出价</h3>{field("officialOutputPrice", "每 1M tokens", "number", false, "0.0001")}</div><div><h3>官方缓存命中价格</h3>{field("officialCacheHitPrice", "每 1M tokens", "number", false, "0.0001")}</div></div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            取消
          </button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? "保存中…" : "保存为草稿"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PdfModal({
  product,
  onDone,
  onCancel,
}: {
  product: Product;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [versions, setVersions] = useState<PdfVersion[]>([]);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [download, setDownload] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const load = async () =>
    setVersions(
      (
        await requestJson<{ data: PdfVersion[] }>(
          `/api/admin/products/${product.id}/pdf`,
        )
      ).data,
    );
  useEffect(() => {
    void load();
  }, []);
  const upload = async () => {
    if (!file || !confirmed) {
      setError("请选择 PDF 并确认适合公开展示");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("publicSafeConfirmed", "true");
    form.set("showDownloadButton", String(download));
    try {
      await requestJson(`/api/admin/products/${product.id}/pdf`, {
        method: "POST",
        body: form,
      });
      setFile(null);
      setConfirmed(false);
      await load();
      onDone();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "上传失败"));
    }
  };
  const versionAction = async (id: string, action: "restore" | "withdraw") => {
    try {
      await requestJson(
        `/api/admin/products/${product.id}/pdf/${id}/${action}`,
        { method: "POST" },
      );
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "操作失败"));
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <span className="section-kicker">PUBLIC DOCUMENTS</span>
            <h2>{product.publicName} · PDF</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="upload-box">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            我已确认文件适合公开展示，且不含不应公开的信息
          </label>
          <label>
            <input
              type="checkbox"
              checked={download}
              onChange={(e) => setDownload(e.target.checked)}
            />{" "}
            公开页面显示下载按钮
          </label>
          <button className="primary" onClick={() => void upload()}>
            上传新版本
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="version-list">
          {versions.length ? (
            versions.map((v) => (
              <div className="version-row" key={v.id}>
                <span>
                  <b>v{v.versionNo}</b>
                  <small>
                    {v.originalFilename} ·{" "}
                    {(v.fileSize / 1024 / 1024).toFixed(2)} MB
                  </small>
                </span>
                <span className={`status status-${v.publicStatus}`}>
                  {v.publicStatus === "public"
                    ? "公开"
                    : v.publicStatus === "withdrawn"
                      ? "已撤下"
                      : "私有"}
                </span>
                <span>
                  {v.publicStatus !== "public" && (
                    <button onClick={() => void versionAction(v.id, "restore")}>
                      恢复
                    </button>
                  )}
                  {v.publicStatus === "public" && (
                    <button
                      onClick={() => void versionAction(v.id, "withdraw")}
                    >
                      撤下
                    </button>
                  )}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">暂无历史版本</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Admin({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<
    | "products"
    | "providers"
    | "dictionaries"
    | "compare"
    | "quote"
    | "users"
    | "logs"
  >("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userMeta, setUserMeta] = useState<PageMeta>({ page: 1, pageSize: 20, total: 0 });
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerMeta, setProviderMeta] = useState<PageMeta>({ page: 1, pageSize: 20, total: 0 });
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([]);
  const [dictionaryMeta, setDictionaryMeta] = useState<PageMeta>({ page: 1, pageSize: 20, total: 0 });
  const [permissionUser, setPermissionUser] = useState<UserRow | null>(null);
  const [logFilters, setLogFilters] = useState<LogFilters>({
    after: "",
    before: "",
    actor: "",
    action: "",
    targetType: "",
    result: "",
  });
  const [logPage, setLogPage] = useState(1);
  const [logMeta, setLogMeta] = useState({ pageSize: 50, total: 0 });
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingDictionaryId, setEditingDictionaryId] = useState<string | null>(null);
  const [modal, setModal] = useState<"product" | "product-copy" | "pdf" | "user" | null>(null);
  const [quoteProfileUser, setQuoteProfileUser] = useState<UserRow | null>(null);
  const [editing, setEditing] = useState<Product | undefined>();
  const [pdfProduct, setPdfProduct] = useState<Product | undefined>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [productMeta, setProductMeta] = useState({ pageSize: 50, total: 0 });
  const [internalCompareModel, setInternalCompareModel] = useState("");
  const [internalCompareLine, setInternalCompareLine] = useState("全部产品线");
  const [internalCompareRows, setInternalCompareRows] = useState<Product[]>([]);
  const [internalCompareLoading, setInternalCompareLoading] = useState(false);
  const load = async () => {
    setError("");
    try {
      if (section === "products") {
        const [p, pr, d] = await Promise.all([
          requestJson<{ data: Product[]; meta?: { pageSize: number; total: number } }>(
            `/api/admin/products?page=${productPage}&pageSize=${productMeta.pageSize}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
          ),
          requestJson<{ data: Provider[]; meta?: PageMeta }>("/api/admin/providers?page=1&pageSize=100"),
          requestJson<{ data: Dictionary[]; meta?: PageMeta }>("/api/admin/dictionaries?page=1&pageSize=100"),
        ]);
        setProducts(p.data);
        if (p.meta) setProductMeta(p.meta);
        setProviders(pr.data);
        if (pr.meta) setProviderMeta(pr.meta);
        setDictionaries(d.data);
        if (d.meta) setDictionaryMeta(d.meta);
      }
      if (section === "quote")
        setProducts(
          (
            await requestJson<{ data: Product[] }>(
              "/api/admin/products/options?status=published",
            )
          ).data,
        );
      if (section === "compare") {
        const [dictionariesResponse] = await Promise.all([
          requestJson<{ data: Dictionary[]; meta?: PageMeta }>("/api/admin/dictionaries?page=1&pageSize=100"),
        ]);
        setDictionaries(dictionariesResponse.data);
      }
      if (section === "providers") {
        const providerResponse = await requestJson<{ data: Provider[]; meta?: PageMeta }>(`/api/admin/providers?page=${providerMeta.page}&pageSize=${providerMeta.pageSize}`);
        setProviders(providerResponse.data);
        if (providerResponse.meta) setProviderMeta(providerResponse.meta);
      }
      if (section === "dictionaries") {
        const dictionaryResponse = await requestJson<{ data: Dictionary[]; meta?: PageMeta }>(`/api/admin/dictionaries?page=${dictionaryMeta.page}&pageSize=${dictionaryMeta.pageSize}`);
        setDictionaries(dictionaryResponse.data);
        if (dictionaryResponse.meta) setDictionaryMeta(dictionaryResponse.meta);
      }
      if (section === "users" && user.role === "super_admin") {
        const userResponse = await requestJson<{ data: UserRow[]; meta?: PageMeta }>(`/api/admin/users?page=${userMeta.page}&pageSize=${userMeta.pageSize}`);
        setUsers(userResponse.data);
        if (userResponse.meta) setUserMeta(userResponse.meta);
      }
      if (section === "logs" && user.role === "super_admin") {
        const params = new URLSearchParams({
          page: String(logPage),
          pageSize: String(logMeta.pageSize),
        });
        Object.entries(logFilters).forEach(([key, value]) => {
          if (value)
            params.set(
              key,
              key === "after" || key === "before"
                ? value.replace("T", " ") + (value.length === 16 ? ":00" : "")
                : value,
            );
        });
        const response = await requestJson<{
          data: LogRow[];
          meta?: { pageSize: number; total: number };
        }>(`/api/admin/audit-logs?${params.toString()}`);
        setLogs(response.data);
        if (response.meta) setLogMeta(response.meta);
      }
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "加载失败"));
    }
  };
  useEffect(() => {
    void load();
  }, [section, logPage, productPage, productMeta.pageSize, providerMeta.page, providerMeta.pageSize, dictionaryMeta.page, dictionaryMeta.pageSize, userMeta.page, userMeta.pageSize]);
  useEffect(() => {
    if (section !== "compare" || !internalCompareModel) {
      setInternalCompareRows([]);
      return;
    }
    const params = new URLSearchParams({ model: internalCompareModel });
    if (internalCompareLine !== "全部产品线")
      params.set("productLine", internalCompareLine);
    setInternalCompareLoading(true);
    void requestJson<{ data: Product[] }>(`/api/admin/compare?${params.toString()}`)
      .then((response) => setInternalCompareRows(response.data))
      .catch(() => setInternalCompareRows([]))
      .finally(() => setInternalCompareLoading(false));
  }, [section, internalCompareModel, internalCompareLine]);
  const action = async (product: Product, next: "publish" | "disable") => {
    try {
      await requestJson(`/api/admin/products/${product.id}/${next}`, {
        method: "POST",
      });
      setMessage(next === "publish" ? "产品已发布" : "产品已停用");
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "操作失败"));
    }
  };
  const count = (status: string) =>
    products.filter((item) => item.status === status).length;
  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      await requestJson("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: f.get("username"),
          displayName: f.get("displayName"),
          password: f.get("password"),
          role: f.get("role"),
        }),
      });
      setModal(null);
      setMessage("用户已创建");
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "创建失败"));
    }
  };
  const updateUser = async (item: UserRow, patch: Record<string, string>) => {
    try {
      await requestJson(`/api/admin/users/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "更新失败"));
    }
  };
  const saveProvider = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      await requestJson("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.get("name"), alias: f.get("alias") }),
      });
      setMessage("服务商已创建");
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "创建失败"));
    }
  };
  const saveDictionary = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      await requestJson("/api/admin/dictionaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: f.get("type"), name: f.get("name") }),
      });
      setMessage("字典项已创建");
      await load();
      event.currentTarget.reset();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "创建失败"));
    }
  };
  const updateDictionary = async (
    item: Dictionary,
    patch: Record<string, string> = {
      status: item.status === "active" ? "disabled" : "active",
    },
  ) => {
    try {
      await requestJson(`/api/admin/dictionaries/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setEditingDictionaryId(null);
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "更新失败"));
    }
  };
  const purgeLogs = async () => {
    const before = window.prompt("删除此时间之前的日志（格式：YYYY-MM-DD HH:mm:ss）");
    if (!before || !window.confirm(`确认永久删除 ${before} 之前的操作日志吗？`)) return;
    try {
      const response = await requestJson<{ data: { deleted: number } }>(
        "/api/admin/audit-logs/purge",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ before }),
        },
      );
      setMessage(`已清理 ${response.data.deleted} 条日志`);
      setLogPage(1);
      await load();
    } catch (cause) {
      setError(errorText(cause instanceof Error ? cause.message : "清理失败"));
    }
  };
  const auditR2 = async () => {
    if (!window.confirm("先执行 R2 孤立对象巡检吗？下一步删除需要再次确认。")) return;
    try {
      const scan = await requestJson<{ data: { orphaned: string[] } }>("/api/admin/maintenance/r2-audit", { method: "POST", body: JSON.stringify({ confirm: false }), headers: { "Content-Type": "application/json" } });
      if (!scan.data.orphaned.length) { setMessage("R2 未发现孤立对象"); return; }
      if (!window.confirm(`发现 ${scan.data.orphaned.length} 个孤立对象，确认删除吗？`)) { setMessage(`发现 ${scan.data.orphaned.length} 个孤立对象，未删除`); return; }
      const deleted = await requestJson<{ data: { deleted: number } }>("/api/admin/maintenance/r2-audit", { method: "POST", body: JSON.stringify({ confirm: true }), headers: { "Content-Type": "application/json" } });
      setMessage(`已删除 ${deleted.data.deleted} 个孤立对象`);
      await load();
    } catch (cause) { setError(errorText(cause instanceof Error ? cause.message : "R2 巡检失败")); }
  };
  const filteredProducts = useMemo(() => products, [products]);
  const compareModels = useMemo(
    () =>
      dictionaries
        .filter((item) => item.type === "model" && item.status === "active")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [dictionaries],
  );
  const compareLines = useMemo(
    () =>
      dictionaries
        .filter(
          (item) => item.type === "product_line" && item.status === "active",
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [dictionaries],
  );
  useEffect(() => {
    if (!internalCompareModel && compareModels.length)
      setInternalCompareModel(compareModels[0].name);
    if (
      internalCompareModel &&
      !compareModels.some((item) => item.name === internalCompareModel)
    )
      setInternalCompareModel("");
  }, [compareModels, internalCompareModel]);
  return (
    <main className="admin-shell">
      <aside>
        <div className="brand-mark">
          MP<span>/</span>HUB
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav>
          <a
            className={section === "products" ? "active" : ""}
            onClick={() => setSection("products")}
          >
            产品管理 <span>→</span>
          </a>
          <a
            className={section === "providers" ? "active" : ""}
            onClick={() => setSection("providers")}
          >
            服务商
          </a>
          <a
            className={section === "dictionaries" ? "active" : ""}
            onClick={() => setSection("dictionaries")}
          >
            字典
          </a>
          <a
            className={section === "compare" ? "active" : ""}
            onClick={() => setSection("compare")}
          >
            内部比价
          </a>
          <a
            className={section === "quote" ? "active" : ""}
            onClick={() => setSection("quote")}
          >
            运营报价单
          </a>
          {user.role === "super_admin" && (
            <a
              className={section === "users" ? "active" : ""}
              onClick={() => setSection("users")}
            >
              用户与权限
            </a>
          )}
          {user.role === "super_admin" && (
            <a
              className={section === "logs" ? "active" : ""}
              onClick={() => setSection("logs")}
            >
              操作日志
            </a>
          )}
        </nav>
        <div className="side-bottom">
          <span className="avatar">
            {user.role === "super_admin" ? "SA" : "OP"}
          </span>
          <div>
            <b>{user.display_name ?? user.displayName ?? user.username}</b>
            <small>{user.role === "super_admin" ? "超管" : "运营"}</small>
          </div>
          <button
            onClick={async () => {
              await requestJson("/api/auth/logout", { method: "POST" });
              onLogout();
            }}
          >
            退出
          </button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              OPERATIONS / {section.toUpperCase()}
            </span>
            <h1>
              {section === "products"
                ? "产品管理"
                : section === "providers"
                  ? "服务商"
                  : section === "dictionaries"
                    ? "字典"
                    : section === "compare"
                      ? "内部比价"
                    : section === "quote"
                      ? "运营报价单"
                      : section === "users"
                        ? "用户与权限"
                        : "操作日志"}
            </h1>
          </div>
          {section === "products" && (
            <button
              className="primary"
              onClick={() => {
                setEditing(undefined);
                setModal("product");
              }}
            >
              + 新增产品
            </button>
          )}
          {section === "users" && (
            <button className="primary" onClick={() => setModal("user")}>
              + 新增用户
            </button>
          )}
        </header>
        {error && (
          <div className="notice notice-error">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {message && (
          <div className="notice">
            {message}
            <button onClick={() => setMessage("")}>知道了</button>
          </div>
        )}
        {section === "products" && (
          <>
            <div className="stats">
              <div>
                <span>已发布</span>
                <strong>{count("published")}</strong>
                <small>公开方案</small>
              </div>
              <div>
                <span>草稿</span>
                <strong>{count("draft")}</strong>
                <small>等待发布</small>
              </div>
              <div>
                <span>已停用</span>
                <strong>{count("disabled")}</strong>
                <small>历史保留</small>
              </div>
            </div>
            <div className="table-card">
              <div className="table-head">
                <div>
                  <span className="section-kicker">
                    CATALOG / {String(filteredProducts.length).padStart(2, "0")}
                  </span>
                  <h2>全部产品</h2>
                </div>
                <input
                  placeholder="搜索模型或公开名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setProductPage(1);
                      void load();
                    }
                  }}
                />
              </div>
              {filteredProducts.length ? (
                <div className="product-table">
                  <div className="product-row product-row-head">
                    <span>方案</span>
                    <span>服务商</span>
                    <span>状态</span>
                    <span>操作</span>
                  </div>
                  {filteredProducts.map((product) => (
                    <div className="product-row" key={product.id}>
                      <span>
                        <b>{product.model}</b>
                        <small>{product.publicName}</small>
                      </span>
                      <span>{product.providerName}</span>
                      <span className={`status status-${product.status}`}>
                        {product.status === "published"
                          ? "已发布"
                          : product.status === "draft"
                            ? "草稿"
                            : "已停用"}
                      </span>
                      <span className="row-actions">
                        <button
                          onClick={() => {
                            setEditing(product);
                            setModal("product");
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            setPdfProduct(product);
                            setModal("pdf");
                          }}
                        >
                          PDF
                        </button>
                        <button onClick={() => { setEditing(product); setModal("product-copy"); }}>复制</button>
                        {product.status !== "published" && (
                          <button
                            onClick={() => void action(product, "publish")}
                          >
                            发布
                          </button>
                        )}
                        {product.status === "published" && (
                          <button
                            onClick={() => void action(product, "disable")}
                          >
                            停用
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-table">
                  <div className="empty-icon">＋</div>
                  <h3>还没有正式产品</h3>
                  <p>先新增一个草稿产品，填好三层价格后再发布。</p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(undefined);
                      setModal("product");
                    }}
                  >
                    创建第一个产品
                  </button>
                </div>
              )}
              <div className="pagination">
                <span>
                  共 {productMeta.total} 条，第 {productPage} 页
                </span>
                <span>
                  <select
                    value={productMeta.pageSize}
                    onChange={(event) => {
                      setProductMeta((current) => ({
                        ...current,
                        pageSize: Number(event.target.value),
                      }));
                      setProductPage(1);
                    }}
                    aria-label="每页数量"
                  >
                    <option value={20}>20 条/页</option>
                    <option value={50}>50 条/页</option>
                    <option value={100}>100 条/页</option>
                  </select>
                  <button
                    disabled={productPage <= 1}
                    onClick={() => setProductPage((page) => Math.max(page - 1, 1))}
                  >
                    上一页
                  </button>
                  <button
                    disabled={productPage * productMeta.pageSize >= productMeta.total}
                    onClick={() => setProductPage((page) => page + 1)}
                  >
                    下一页
                  </button>
                </span>
              </div>
            </div>
          </>
        )}
        {section === "compare" && (
          <div className="table-card internal-compare-card">
            <div className="table-head">
              <div>
                <span className="section-kicker">INTERNAL COMPARISON</span>
                <h2>内部比价</h2>
              </div>
              <span className="muted">仅登录运营人员可见，包含内部价格</span>
            </div>
            <div className="compare-filters">
              <label className="form-field">
                模型
                <select
                  value={internalCompareModel}
                  onChange={(event) => setInternalCompareModel(event.target.value)}
                >
                  <option value="">请选择模型</option>
                  {compareModels.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                产品线
                <select
                  value={internalCompareLine}
                  onChange={(event) => setInternalCompareLine(event.target.value)}
                >
                  <option>全部产品线</option>
                  {compareLines.map((item) => (
                    <option key={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {!internalCompareModel && (
              <div className="empty-table">请选择模型后查看内部比价。</div>
            )}
            {internalCompareLoading && (
              <div className="empty-table">正在加载比价结果…</div>
            )}
            {!internalCompareLoading && internalCompareModel && (
              <div className="product-table">
                <div className="product-row internal-compare-row internal-compare-head">
                  <span>方案 / 服务商</span>
                  <span>状态</span>
                  <span>成本价</span>
                  <span>内部参考价</span>
                  <span>对外价</span>
                </div>
                {internalCompareRows.map((item) => (
                  <div className="product-row internal-compare-row" key={item.id}>
                    <span>
                      <b>{item.publicName}</b>
                      <small>
                        {item.providerName} · {item.productLine} · {item.origin ?? "—"}
                      </small>
                    </span>
                    <span className={`status status-${item.status}`}>
                      {item.status === "published"
                        ? "已发布"
                        : item.status === "draft"
                          ? "草稿"
                          : item.status}
                    </span>
                    <span>
                      {formatSinglePrice(item.costMin, item.currency)}
                    </span>
                    <span>
                      {formatInternalPrice(
                        item.internalMin,
                        item.internalMax,
                        item.currency,
                        item.unit,
                      )}
                    </span>
                    <span>
                      {formatSinglePrice(item.publicMin, item.currency)}
                    </span>
                  </div>
                ))}
                {!internalCompareRows.length && (
                  <div className="empty-table">当前模型暂无可比较方案。</div>
                )}
              </div>
            )}
          </div>
        )}
        {section === "quote" && <OperatorQuote products={products} />}
        {section === "dictionaries" && (
          <div className="table-card">
            <div className="table-head">
              <div>
                <span className="section-kicker">CONTROLLED VOCABULARY</span>
                <h2>字典维护</h2>
              </div>
              <form className="inline-create" onSubmit={saveDictionary}>
                <select name="type" defaultValue="model">
                  <option value="model">模型</option>
                  <option value="brand">品牌</option>
                  <option value="origin">来源</option>
                  <option value="product_line">产品线</option>
                </select>
                <input name="name" placeholder="新字典项" required />
                <button className="secondary">新增</button>
              </form>
            </div>
            <div className="product-table">
              <div className="product-row product-row-head">
                <span>类型</span>
                <span>名称</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {dictionaries.map((item) => (
                <div className="product-row" key={item.id}>
                  <span>
                    {
                      {
                        model: "模型",
                        brand: "品牌",
                        origin: "来源",
                        product_line: "产品线",
                      }[item.type]
                    }
                  </span>
                  <span>
                    {editingDictionaryId === item.id ? (
                      <input
                        defaultValue={item.name}
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === "Enter")
                            void updateDictionary(item, {
                              name: event.currentTarget.value,
                            });
                          if (event.key === "Escape") setEditingDictionaryId(null);
                        }}
                      />
                    ) : (
                      <b>{item.name}</b>
                    )}
                  </span>
                  <span>{item.status === "active" ? "正常" : "已停用"}</span>
                  <span className="row-actions">
                    {editingDictionaryId === item.id ? (
                      <>
                        <button
                          onClick={(event) => {
                            const input = event.currentTarget
                              .parentElement?.parentElement?.querySelector("input");
                            if (input instanceof HTMLInputElement)
                              void updateDictionary(item, { name: input.value });
                          }}
                        >
                          保存
                        </button>
                        <button onClick={() => setEditingDictionaryId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditingDictionaryId(item.id)}>
                          改名
                        </button>
                        <button onClick={() => void updateDictionary(item)}>
                          {item.status === "active" ? "停用" : "启用"}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <Pagination meta={dictionaryMeta} onPage={(page) => setDictionaryMeta((current) => ({ ...current, page }))} onPageSize={(pageSize) => setDictionaryMeta({ page: 1, pageSize, total: dictionaryMeta.total })} />
          </div>
        )}
        {section === "providers" && (
          <div className="table-card">
            <div className="table-head">
              <div>
                <span className="section-kicker">SUPPLY NETWORK</span>
                <h2>服务商目录</h2>
              </div>
              <form className="inline-create" onSubmit={saveProvider}>
                <input name="name" placeholder="服务商名称" required />
                <input name="alias" placeholder="别名（可选）" />
                <button className="secondary">新增</button>
              </form>
            </div>
            <div className="product-table">
              <div className="product-row product-row-head">
                <span>名称</span>
                <span>别名</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {providers.map((item) => (
                <div className="product-row" key={item.id}>
                  <span>
                    {editingProviderId === item.id ? (
                      <input defaultValue={item.name} aria-label="服务商名称" />
                    ) : (
                      <b>{item.name}</b>
                    )}
                  </span>
                  <span>
                    {editingProviderId === item.id ? (
                      <input defaultValue={item.alias} aria-label="服务商别名" />
                    ) : (
                      item.alias || "—"
                    )}
                  </span>
                  <span className={`status status-${item.status}`}>
                    {item.status === "active" ? "正常" : "已停用"}
                  </span>
                  <span className="row-actions">
                    {editingProviderId === item.id ? (
                      <>
                        <button
                          onClick={(event) => {
                            const row = event.currentTarget.closest(".product-row");
                            const inputs = row?.querySelectorAll("input");
                            if (inputs && inputs.length >= 2)
                              void updateProvider(item, {
                                name: (inputs[0] as HTMLInputElement).value,
                                alias: (inputs[1] as HTMLInputElement).value,
                              }).then(() => {
                                setEditingProviderId(null);
                                void load();
                              });
                          }}
                        >
                          保存
                        </button>
                        <button onClick={() => setEditingProviderId(null)}>取消</button>
                      </>
                    ) : item.status === "active" ? (
                      <button
                        onClick={() => void updateProvider(item, { status: "disabled" }).then(load)}
                      >
                        停用
                      </button>
                    ) : (
                      <button
                        onClick={() => void updateProvider(item, { status: "active" }).then(load)}
                      >
                        启用
                      </button>
                    )}
                    {editingProviderId !== item.id && (
                      <button onClick={() => setEditingProviderId(item.id)}>编辑</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <Pagination meta={providerMeta} onPage={(page) => setProviderMeta((current) => ({ ...current, page }))} onPageSize={(pageSize) => setProviderMeta({ page: 1, pageSize, total: providerMeta.total })} />
          </div>
        )}
        {section === "users" && (
          <div className="table-card">
            <div className="table-head">
              <div>
                <span className="section-kicker">ACCESS CONTROL</span>
                <h2>账号列表</h2>
              </div>
            </div>
            <div className="product-table">
              <div className="product-row product-row-head">
                <span>用户</span>
                <span>角色</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {users.map((item) => (
                <div className="product-row" key={item.id}>
                  <span>
                    <b>{item.displayName}</b>
                    <small>{item.username}</small>
                  </span>
                  <span>
                    <select
                      value={item.role}
                      onChange={(e) =>
                        void updateUser(item, { role: e.target.value })
                      }
                    >
                      <option value="operator">运营</option>
                      <option value="super_admin">超管</option>
                    </select>
                  </span>
                  <span>{item.status === "active" ? "正常" : "已停用"}</span>
                  <span className="row-actions">
                    <button
                      onClick={() =>
                        void updateUser(item, {
                          status:
                            item.status === "active" ? "disabled" : "active",
                        })
                      }
                    >
                      {item.status === "active" ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={() => {
                        const password =
                          window.prompt("输入新密码（至少 8 位）");
                        if (password) void updateUser(item, { password });
                      }}
                    >
                      重置密码
                    </button>
                    <button onClick={() => setQuoteProfileUser(item)}>
                      报价资料
                    </button>
                    <button onClick={() => setPermissionUser(item)}>
                      权限
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <Pagination meta={userMeta} onPage={(page) => setUserMeta((current) => ({ ...current, page }))} onPageSize={(pageSize) => setUserMeta({ page: 1, pageSize, total: userMeta.total })} />
          </div>
        )}
        {section === "logs" && (
          <div className="table-card">
            <div className="table-head">
              <div>
                <span className="section-kicker">AUDIT TRAIL</span>
                <h2>最近操作</h2>
              </div>
              <button className="secondary" onClick={() => void purgeLogs()}>
                清理旧日志
              </button>
              <button className="secondary" onClick={() => void auditR2()}>
                R2 孤立对象巡检
              </button>
            </div>
            <form
              className="log-filters"
              onSubmit={(event) => {
                event.preventDefault();
                setLogPage(1);
                void load();
              }}
            >
              <input
                type="datetime-local"
                value={logFilters.after}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    after: event.target.value,
                  }))
                }
                aria-label="开始时间"
              />
              <input
                type="datetime-local"
                value={logFilters.before}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    before: event.target.value,
                  }))
                }
                aria-label="结束时间"
              />
              <input
                placeholder="操作者用户名"
                value={logFilters.actor}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    actor: event.target.value,
                  }))
                }
              />
              <input
                placeholder="动作，如 product_updated"
                value={logFilters.action}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    action: event.target.value,
                  }))
                }
              />
              <input
                placeholder="对象类型，如 product"
                value={logFilters.targetType}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    targetType: event.target.value,
                  }))
                }
              />
              <select
                value={logFilters.result}
                onChange={(event) =>
                  setLogFilters((current) => ({
                    ...current,
                    result: event.target.value,
                  }))
                }
              >
                <option value="">全部结果</option>
                <option value="success">成功</option>
                <option value="failure">失败</option>
              </select>
              <button className="secondary">筛选</button>
            </form>
            <div className="product-table">
              <div className="product-row product-row-head">
                <span>操作者</span>
                <span>动作</span>
                <span>对象</span>
                <span>时间</span>
              </div>
              {logs.map((item) => (
                <div className="product-row" key={item.id}>
                  <span>
                    <b>{item.actorUsername}</b>
                    <small>{item.summary}</small>
                  </span>
                  <span>{item.action}</span>
                  <span>{item.targetType}</span>
                  <span>{item.createdAt?.slice(0, 16)}</span>
                </div>
              ))}
            </div>
            <div className="pagination">
              <span>
                共 {logMeta.total} 条，第 {logPage} 页
              </span>
              <span>
                <button
                  disabled={logPage <= 1}
                  onClick={() => setLogPage((page) => Math.max(page - 1, 1))}
                >
                  上一页
                </button>
                <button
                  disabled={logPage * logMeta.pageSize >= logMeta.total}
                  onClick={() => setLogPage((page) => page + 1)}
                >
                  下一页
                </button>
              </span>
            </div>
          </div>
        )}
      </section>
      {(modal === "product" || modal === "product-copy") && (
        <ProductForm
          initial={editing}
          copy={modal === "product-copy"}
          providers={providers}
          dictionaries={dictionaries}
          onDone={() => {
            setModal(null);
            setMessage("产品已保存为草稿");
            void load();
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === "pdf" && pdfProduct && (
        <PdfModal
          product={pdfProduct}
          onDone={() => {
            setMessage("PDF 已上传");
            void load();
          }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === "user" && (
        <div className="modal-backdrop">
          <form className="modal-card" onSubmit={saveUser}>
            <div className="modal-head">
              <div>
                <span className="section-kicker">ACCESS CONTROL</span>
                <h2>新增用户</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            <div className="form-grid compact">
              <label className="form-field">
                用户名
                <input name="username" required />
              </label>
              <label className="form-field">
                显示名称
                <input name="displayName" required />
              </label>
              <label className="form-field">
                初始密码
                <input name="password" type="password" minLength={8} required />
              </label>
              <label className="form-field">
                角色
                <select name="role" defaultValue="operator">
                  <option value="operator">运营</option>
                  <option value="super_admin">超管</option>
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className="primary">创建用户</button>
            </div>
          </form>
        </div>
      )}
      {quoteProfileUser && (
        <QuoteProfileEditor
          user={quoteProfileUser}
          onDone={() => {
            setQuoteProfileUser(null);
            setMessage("报价资料已保存");
          }}
          onCancel={() => setQuoteProfileUser(null)}
        />
      )}
      {permissionUser && (
        <PermissionEditor
          user={permissionUser}
          onDone={() => setPermissionUser(null)}
          onCancel={() => setPermissionUser(null)}
        />
      )}
    </main>
  );
}

function updateProvider(item: Provider, patch: Record<string, string>) {
  return requestJson(`/api/admin/providers/${item.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const mustChange = Boolean(
    user?.mustChangePassword ?? user?.must_change_password,
  );
  if (user && mustChange)
    return <PasswordChange onComplete={() => setUser(null)} />;
  return user ? (
    <Admin user={user} onLogout={() => setUser(null)} />
  ) : (
    <Login onLogin={setUser} />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

type AppEnv = Env & {
  INITIAL_ADMIN_USERNAME?: string;
  INITIAL_ADMIN_PASSWORD?: string;
};
type User = {
  id: string;
  username: string;
  display_name: string;
  role: "super_admin" | "operator";
  must_change_password: number;
};
type Input = Record<string, unknown>;
const PBKDF2_ITERATIONS = 99_999;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const newId = () => crypto.randomUUID();
const bodyRecord = (value: unknown): Input =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Input)
    : {};
const required = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0;
const numberOrNull = (value: unknown) =>
  value === null || value === "" || value === undefined ? null : Number(value);
const textOrNull = (value: unknown) =>
  value === null || value === "" || value === undefined ? null : String(value).trim();
const requestId = (request: Request) =>
  request.headers.get("cf-ray") ?? newId();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function base64UrlToBytes(value: string) {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function secureStringEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1)
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  return difference === 0;
}
async function sha256Bytes(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function hashPassword(password: string) {
  // Stay below Cloudflare Workers' production PBKDF2 hard cap.
  const iterations = PBKDF2_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    ),
  );
  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(digest)}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsText, saltText, digestText] = encoded.split("$");
  if (algorithm !== "pbkdf2" || !iterationsText || !saltText || !digestText)
    return false;
  const iterations = Number(iterationsText);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations !== PBKDF2_ITERATIONS
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: base64UrlToBytes(saltText),
        iterations,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
  const expected = base64UrlToBytes(digestText);
  if (derived.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < derived.length; i += 1)
    difference |= derived[i] ^ expected[i];
  return difference === 0;
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function audit(
  env: AppEnv,
  request: Request,
  rid: string,
  actor: User | null,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
  before?: unknown,
  after?: unknown,
  result: "success" | "failure" = "success",
) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, actor_username_snapshot, role, action, target_type, target_id, before_json, after_json, summary, result, request_id, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      actor?.id ?? null,
      actor?.username ?? "anonymous",
      actor?.role ?? "anonymous",
      action,
      targetType,
      targetId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      summary,
      result,
      rid,
      request.headers.get("CF-Connecting-IP"),
      request.headers.get("User-Agent"),
    )
    .run();
}
async function ensureInitialAdmin(env: AppEnv) {
  if (!env.DB || !env.INITIAL_ADMIN_USERNAME || !env.INITIAL_ADMIN_PASSWORD)
    return;
  let existing: { id: string } | null;
  try {
    existing = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1",
    ).first<{ id: string }>();
  } catch (error) {
    console.error(JSON.stringify({ event: "bootstrap_db_read_failed", error: String(error) }));
    throw new Error("bootstrap_db_read_failed");
  }
  if (existing) return;
  if (env.INITIAL_ADMIN_PASSWORD.length < 8)
    throw new Error("INITIAL_ADMIN_PASSWORD must be at least 8 characters");
  const username = env.INITIAL_ADMIN_USERNAME.trim();
  if (!username) throw new Error("INITIAL_ADMIN_USERNAME is required");
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(env.INITIAL_ADMIN_PASSWORD);
  } catch (error) {
    console.error(JSON.stringify({ event: "bootstrap_password_hash_failed", error: String(error) }));
    throw new Error("bootstrap_password_hash_failed");
  }
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, 'super_admin', ?, 1)",
    )
      .bind(newId(), username, username, passwordHash)
      .run();
  } catch (error) {
    console.error(JSON.stringify({ event: "bootstrap_db_write_failed", error: String(error) }));
    throw new Error("bootstrap_db_write_failed");
  }
}
async function authenticate(request: Request, env: AppEnv) {
  if (!env.DB) return null;
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)mp_session=([^;]+)/)?.[1];
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.must_change_password FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND u.status = 'active' LIMIT 1`,
  )
    .bind(await sha256(token))
    .first<User>();
}

const operatorPermissions = new Set([
  "product.read",
  "product.write",
  "product.publish",
  "provider.write",
  "dictionary.write",
  "pdf.write",
  "quote.write",
]);

async function hasPermission(
  env: AppEnv,
  actor: User,
  permission: string,
) {
  if (actor.role === "super_admin") return true;
  try {
    const override = await env.DB?.prepare(
      "SELECT effect FROM user_permissions WHERE user_id = ? AND permission_key = ?",
    )
      .bind(actor.id, permission)
      .first<{ effect: "allow" | "deny" }>();
    if (override?.effect) return override.effect === "allow";
  } catch {
    // Older local databases may not have migration 0002 yet; retain role defaults.
  }
  return actor.role === "operator" && operatorPermissions.has(permission);
}

async function publicProducts(env: AppEnv, url: URL) {
  if (!env.DB)
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }, 200, {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
  const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
  const pageSize = Math.min(
    Math.max(Number(url.searchParams.get("pageSize") ?? 20), 1),
    100,
  );
  const params: (string | number)[] = ["published"];
  const where = [
    "p.status = ?",
    "p.public_min IS NOT NULL",
    "p.public_max IS NOT NULL",
  ];
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  if (keyword) {
    where.push(
      "(p.public_name LIKE ? OR p.public_description LIKE ? OR m.name LIKE ? OR b.name LIKE ?)",
    );
    const value = `%${keyword}%`;
    params.push(value, value, value, value);
  }
  const productLine = url.searchParams.get("productLine")?.trim() ?? "";
  if (productLine) {
    where.push("l.name = ?");
    params.push(productLine);
  }
  const origin = url.searchParams.get("origin")?.trim() ?? "";
  if (origin) {
    where.push("o.name = ?");
    params.push(origin);
  }
  const countParams = [...params];
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM products p JOIN dictionaries m ON p.model_id = m.id JOIN dictionaries b ON p.brand_id = b.id JOIN dictionaries o ON p.origin_id = o.id JOIN dictionaries l ON p.product_line_id = l.id WHERE ${where.join(" AND ")}`,
  )
    .bind(...countParams)
    .first<{ total: number }>();
  params.push(pageSize, (page - 1) * pageSize);
  const result = await env.DB.prepare(
    `SELECT p.id, m.name AS model, b.name AS brand, o.name AS origin, l.name AS productLine, p.public_name AS publicName, p.public_description AS publicDescription, p.public_min AS publicMin, p.public_max AS publicMax, p.currency, p.unit, p.reference_tpm AS referenceTpm, p.service_note AS serviceNote, p.official_input_min AS officialInputMin, p.official_input_max AS officialInputMax, p.official_output_min AS officialOutputMin, p.official_output_max AS officialOutputMax, p.cache_hit_percent AS cacheHitPercent, p.official_cache_hit_price AS officialCacheHitPrice, CASE WHEN v.id IS NULL OR v.public_status != 'public' THEN 0 ELSE 1 END AS hasPdf, CASE WHEN v.id IS NULL OR v.public_status != 'public' THEN 0 ELSE v.show_download_button END AS pdfDownload FROM products p JOIN dictionaries m ON p.model_id = m.id JOIN dictionaries b ON p.brand_id = b.id JOIN dictionaries o ON p.origin_id = o.id JOIN dictionaries l ON p.product_line_id = l.id LEFT JOIN product_pdf_versions v ON v.id = p.current_pdf_version_id WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params)
    .all();
  return json(
    {
      data: result.results,
      meta: { page, pageSize, total: total?.total ?? result.results.length },
    },
    200,
    { "X-Robots-Tag": "noindex, nofollow, noarchive" },
  );
}

async function publicDictionaries(env: AppEnv) {
  if (!env.DB)
    return json({ data: [] }, 200, {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Access-Control-Allow-Origin": "*",
    });
  const rows = await env.DB.prepare(
    "SELECT id, type, name FROM dictionaries WHERE status = 'active' ORDER BY type, name",
  ).all();
  return json({ data: rows.results }, 200, {
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Access-Control-Allow-Origin": "*",
  });
}

async function publicCompare(env: AppEnv, url: URL) {
  if (!env.DB)
    return json({ data: [] }, 200, {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Access-Control-Allow-Origin": "*",
    });
  const model = url.searchParams.get("model")?.trim();
  if (!model)
    return json({ error: "model_required" }, 400, {
      "Access-Control-Allow-Origin": "*",
    });
  const line = url.searchParams.get("productLine")?.trim();
  const params: string[] = ["published", model];
  const where = [
    "p.status = ?",
    "m.name = ?",
    "p.public_min IS NOT NULL",
    "p.public_max IS NOT NULL",
  ];
  if (line) {
    where.push("l.name = ?");
    params.push(line);
  }
  const rows = await env.DB.prepare(
    `SELECT p.id, m.name AS model, b.name AS brand, o.name AS origin, l.name AS productLine, p.public_name AS publicName, p.public_description AS publicDescription, p.public_min AS publicMin, p.public_max AS publicMax, p.currency, p.unit, p.reference_tpm AS referenceTpm, p.service_note AS serviceNote, p.official_input_min AS officialInputMin, p.official_input_max AS officialInputMax, p.official_output_min AS officialOutputMin, p.official_output_max AS officialOutputMax, p.cache_hit_percent AS cacheHitPercent, p.official_cache_hit_price AS officialCacheHitPrice, CASE WHEN v.id IS NULL OR v.public_status != 'public' THEN 0 ELSE 1 END AS hasPdf, CASE WHEN v.id IS NULL OR v.public_status != 'public' THEN 0 ELSE v.show_download_button END AS pdfDownload FROM products p JOIN dictionaries m ON p.model_id = m.id JOIN dictionaries b ON p.brand_id = b.id JOIN dictionaries o ON p.origin_id = o.id JOIN dictionaries l ON p.product_line_id = l.id LEFT JOIN product_pdf_versions v ON v.id = p.current_pdf_version_id WHERE ${where.join(" AND ")} ORDER BY p.currency ASC, p.unit ASC, p.public_min ASC, p.updated_at DESC`,
  )
    .bind(...params)
    .all<Record<string, unknown> & { currency: string; unit: string }>();
  const data = rows.results.map((item, index) => ({
    ...item,
    publicLabel: `方案 ${String.fromCharCode(65 + index)}`,
  }));
  const groups = [...data.reduce((map, item) => {
    const key = String(item.currency);
    const group = map.get(key) ?? {
      currency: String(item.currency),
      unit: "",
      data: [],
    };
    group.data.push(item);
    map.set(key, group);
    return map;
  }, new Map<string, { currency: string; unit: string; data: typeof data }>()).values()];
  return json({ data, groups }, 200, {
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Access-Control-Allow-Origin": "*",
  });
}

async function login(request: Request, env: AppEnv, rid: string) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const body = bodyRecord(await request.json().catch(() => ({})));
  if (!required(body.username) || !required(body.password))
    return json({ error: "username_and_password_required" }, 400);
  const user = await env.DB.prepare(
    "SELECT id, username, display_name, role, password_hash, status, must_change_password FROM users WHERE username = ? LIMIT 1",
  )
    .bind(String(body.username).trim())
    .first<User & { password_hash: string; status: string }>();
  const submittedPassword = String(body.password);
  let passwordValid =
    Boolean(user) && (await verifyPassword(submittedPassword, user!.password_hash));
  let bootstrapRecovered = false;
  if (
    user &&
    !passwordValid &&
    user.status === "active" &&
    user.role === "super_admin" &&
    Boolean(user.must_change_password) &&
    env.INITIAL_ADMIN_USERNAME?.trim() === user.username &&
    typeof env.INITIAL_ADMIN_PASSWORD === "string" &&
    env.INITIAL_ADMIN_PASSWORD.length >= 8 &&
    (await secureStringEqual(submittedPassword, env.INITIAL_ADMIN_PASSWORD))
  ) {
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND must_change_password = 1",
    )
      .bind(await hashPassword(submittedPassword), user.id)
      .run();
    passwordValid = true;
    bootstrapRecovered = true;
  }
  if (!user || user.status !== "active" || !passwordValid) {
    await audit(
      env,
      request,
      rid,
      null,
      "login_failed",
      "user",
      null,
      "invalid credentials",
      undefined,
      undefined,
      "failure",
    );
    return json({ error: "invalid_credentials" }, 401);
  }
  if (bootstrapRecovered)
    await audit(
      env,
      request,
      rid,
      user,
      "bootstrap_password_recovered",
      "user",
      user.id,
      "pending initial administrator password recovered from bootstrap secret",
    );
  const token = `${newId()}${newId()}`;
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, datetime('now', '+30 days'), datetime('now'))",
  )
    .bind(newId(), user.id, await sha256(token))
    .run();
  await env.DB.prepare(
    "UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  )
    .bind(user.id)
    .run();
  await audit(
    env,
    request,
    rid,
    user,
    "login",
    "user",
    user.id,
    "login succeeded",
  );
  return json(
    {
      data: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          mustChangePassword: Boolean(user.must_change_password),
        },
      },
    },
    200,
    {
      "Set-Cookie": `mp_session=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    },
  );
}

async function changePassword(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
) {
  if (!env.DB || !sameOrigin(request))
    return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  if (
    !required(body.currentPassword) ||
    !required(body.newPassword) ||
    String(body.newPassword).length < 8
  )
    return json({ error: "invalid_password" }, 400);
  const row = await env.DB.prepare(
    "SELECT password_hash AS passwordHash FROM users WHERE id = ?",
  )
    .bind(actor.id)
    .first<{ passwordHash: string }>();
  if (
    !row ||
    !(await verifyPassword(String(body.currentPassword), row.passwordHash))
  )
    return json({ error: "invalid_current_password" }, 401);
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(await hashPassword(String(body.newPassword)), actor.id)
    .run();
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
  )
    .bind(actor.id)
    .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "password_changed",
    "user",
    actor.id,
    "password changed and sessions revoked",
  );
  return json({ data: { ok: true } }, 200, {
    "Set-Cookie":
      "mp_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
  });
}

async function quoteProfileApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "quote.write")))
    return json({ error: "forbidden" }, 403);
  const targetUserId = new URL(request.url).searchParams.get("userId")?.trim() || actor.id;
  if (targetUserId !== actor.id && !(await hasPermission(env, actor, "user.manage")))
    return json({ error: "forbidden" }, 403);
  const target = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ?",
  )
    .bind(targetUserId)
    .first<{ id: string }>();
  if (!target) return json({ error: "user_not_found" }, 404);
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT company_name AS companyName, brand_name AS brandName, contact_name AS contactName, phone, email FROM user_quote_profiles WHERE user_id = ?",
    )
      .bind(targetUserId)
      .first();
    return json({
      data: row ?? {
        companyName: "",
        brandName: "",
        contactName: "",
        phone: "",
        email: "",
      },
    });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  await env.DB.prepare(
    `INSERT INTO user_quote_profiles (user_id, company_name, brand_name, contact_name, phone, email, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET company_name = excluded.company_name, brand_name = excluded.brand_name, contact_name = excluded.contact_name, phone = excluded.phone, email = excluded.email, updated_at = datetime('now'), updated_by = excluded.updated_by`,
  )
    .bind(
      targetUserId,
      String(body.companyName ?? ""),
      String(body.brandName ?? ""),
      String(body.contactName ?? ""),
      String(body.phone ?? ""),
      String(body.email ?? ""),
      actor.id,
    )
    .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "quote_profile_updated",
    "user_quote_profile",
    targetUserId,
    "quote profile updated",
  );
  return json({ data: { ok: true } });
}

async function quoteGeneratedApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
) {
  if (!(await hasPermission(env, actor, "quote.write")))
    return json({ error: "forbidden" }, 403);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  await audit(
    env,
    request,
    rid,
    actor,
    "quote_generated",
    "quote",
    null,
    "operator quote generated; quote content omitted",
  );
  return json({ data: { ok: true } });
}

async function usersApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  userId?: string,
) {
  if (!(await hasPermission(env, actor, "user.manage")))
    return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") ?? 100), 1), 100);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    const rows = await env.DB.prepare(
      "SELECT id, username, display_name AS displayName, role, status, must_change_password AS mustChangePassword, created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
    ).bind(pageSize, (page - 1) * pageSize).all();
    return json({ data: rows.results, meta: { page, pageSize, total: count?.total ?? rows.results.length } });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  if (request.method === "POST") {
    if (
      !required(body.username) ||
      !required(body.password) ||
      String(body.password).length < 8
    )
      return json({ error: "username_and_password_required" }, 400);
    const newUserId = newId();
    const role = body.role === "super_admin" ? "super_admin" : "operator";
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)",
      )
        .bind(
          newUserId,
          String(body.username).trim(),
          String(body.displayName ?? body.username).trim(),
          role,
          await hashPassword(String(body.password)),
        )
        .run();
    } catch {
      return json({ error: "username_already_exists" }, 409);
    }
    await audit(
      env,
      request,
      rid,
      actor,
      "user_created",
      "user",
      newUserId,
      "user created",
    );
    return json({ data: { id: newUserId } }, 201);
  }
  if (!userId) return json({ error: "user_id_required" }, 400);
  const before = await env.DB.prepare(
    "SELECT id, username, display_name AS displayName, role, status FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{
      id: string;
      username: string;
      displayName: string;
      role: string;
      status: string;
    }>();
  if (!before) return json({ error: "user_not_found" }, 404);
  const targetRole =
    body.role === "super_admin"
      ? "super_admin"
      : body.role === "operator"
        ? "operator"
        : before.role;
  const targetStatus =
    body.status === "disabled"
      ? "disabled"
      : body.status === "active"
        ? "active"
        : before.status;
  if (
    before.role === "super_admin" &&
    (targetStatus === "disabled" || targetRole !== "super_admin")
  ) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active'",
    ).first<{ count: number }>();
    if ((count?.count ?? 0) <= 1)
      return json({ error: "last_super_admin_protected" }, 409);
  }
  if (body.password !== undefined) {
    if (String(body.password).length < 8)
      return json({ error: "password_too_short" }, 400);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(await hashPassword(String(body.password)), userId)
      .run();
    await env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
    )
      .bind(userId)
      .run();
  }
  await env.DB.prepare(
    "UPDATE users SET display_name = ?, role = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(
      body.displayName === undefined
        ? before.displayName
        : String(body.displayName).trim(),
      targetRole,
      targetStatus,
      userId,
    )
    .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "user_updated",
    "user",
    userId,
    "user updated",
    before,
    { role: targetRole, status: targetStatus },
  );
  return json({ data: { id: userId } });
}

async function permissionsApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  userId: string,
) {
  if (actor.role !== "super_admin") return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (!target) return json({ error: "user_not_found" }, 404);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT p.key, p.description, up.effect FROM permissions p LEFT JOIN user_permissions up ON up.permission_key = p.key AND up.user_id = ? ORDER BY p.key",
    )
      .bind(userId)
      .all();
    return json({ data: rows.results });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  const key = String(body.permissionKey ?? body.key ?? "").trim();
  const effect = body.effect;
  if (!key || (effect !== "allow" && effect !== "deny"))
    return json({ error: "invalid_permission_override" }, 400);
  const permission = await env.DB.prepare("SELECT key FROM permissions WHERE key = ?")
    .bind(key)
    .first<{ key: string }>();
  if (!permission) return json({ error: "permission_not_found" }, 404);
  await env.DB.prepare(
    "INSERT INTO user_permissions (user_id, permission_key, effect, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, permission_key) DO UPDATE SET effect = excluded.effect, updated_at = datetime('now'), updated_by = excluded.updated_by",
  )
    .bind(userId, key, effect, actor.id)
    .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "user_permission_updated",
    "user_permission",
    userId,
    `${key}=${effect}`,
  );
  return json({ data: { userId, permissionKey: key, effect } });
}

async function providerApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  providerId?: string,
) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "provider.write")))
    return json({ error: "forbidden" }, 403);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") ?? 100), 1), 100);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM providers").first<{ total: number }>();
    const rows = await env.DB.prepare(
      "SELECT id, name, alias, status, created_at AS createdAt, updated_at AS updatedAt FROM providers ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
    ).bind(pageSize, (page - 1) * pageSize).all();
    return json({ data: rows.results, meta: { page, pageSize, total: count?.total ?? rows.results.length } });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  if (request.method === "POST") {
    if (!required(body.name)) return json({ error: "name_required" }, 400);
    const value = newId();
    await env.DB.prepare(
      "INSERT INTO providers (id, name, alias, updated_by) VALUES (?, ?, ?, ?)",
    )
      .bind(
        value,
        String(body.name).trim(),
        String(body.alias ?? "").trim(),
        actor.id,
      )
      .run();
    await audit(
      env,
      request,
      rid,
      actor,
      "provider_created",
      "provider",
      value,
      "provider created",
    );
    return json({ data: { id: value } }, 201);
  }
  if (!providerId) return json({ error: "provider_id_required" }, 400);
  const before = await env.DB.prepare(
    "SELECT id, name, alias, status FROM providers WHERE id = ?",
  )
    .bind(providerId)
    .first<{ id: string; name: string; alias: string; status: string }>();
  if (!before) return json({ error: "provider_not_found" }, 404);
  const name = body.name === undefined ? before.name : String(body.name).trim();
  const alias =
    body.alias === undefined ? before.alias : String(body.alias).trim();
  const status =
    body.status === "disabled"
      ? "disabled"
      : body.status === "active"
        ? "active"
        : before.status;
  if (!name) return json({ error: "name_required" }, 400);
  await env.DB.prepare(
    "UPDATE providers SET name = ?, alias = ?, status = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
  )
    .bind(name, alias, status, actor.id, providerId)
    .run();
  if (status === "disabled")
    await env.DB.prepare(
      "UPDATE products SET status = 'disabled', updated_at = datetime('now'), updated_by = ? WHERE provider_id = ? AND status != 'disabled'",
    )
      .bind(actor.id, providerId)
      .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "provider_updated",
    "provider",
    providerId,
    status === "disabled" ? "provider disabled" : "provider updated",
    before,
    { name, alias, status },
  );
  return json({ data: { id: providerId } });
}

function validateProduct(data: Input, requireInternal: boolean) {
  const keys = [
    "providerId",
    "modelId",
    "brandId",
    "originId",
    "productLineId",
    "publicName",
    "currency",
  ];
  if (keys.some((key) => !required(data[key])))
    return "required_product_field_missing";
  if (data.currency !== "USD" && data.currency !== "CNY")
    return "unsupported_currency";
  const values = Object.fromEntries(
    [
      "publicMin",
      "costMin",
      "internalMin",
      "internalMax",
    ].map((key) => [key, numberOrNull(data[key])]),
  );
  if (
    Object.values(values).some(
      (value) =>
        value !== null &&
        Math.abs(Number(value) * 10000 - Math.round(Number(value) * 10000)) >
          1e-8,
    )
  )
    return "price_precision_exceeded";
  if (
    Object.values(values).some(
      (value) => value !== null && !Number.isFinite(value),
    )
  )
    return "invalid_price";
  if (values.publicMin === null) return "invalid_public_price_range";
  if (
    values.internalMin !== null &&
    values.internalMax !== null &&
    values.internalMin > values.internalMax
  )
    return "invalid_internal_price_range";
  if (requireInternal && (values.internalMin === null || values.internalMax === null))
    return "internal_price_required_to_publish";
  return null;
}

async function productsApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  productId?: string,
  action?: "publish" | "disable",
) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (request.method === "GET" && !productId) {
    if (!(await hasPermission(env, actor, "product.read")))
      return json({ error: "forbidden" }, 403);
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
    const pageSize = Math.min(
      Math.max(Number(url.searchParams.get("pageSize") ?? 20), 1),
      100,
    );
    const params: (string | number)[] = [];
    const where: string[] = [];
    if (url.searchParams.get("status")) {
      where.push("p.status = ?");
      params.push(url.searchParams.get("status")!);
    }
    if (url.searchParams.get("q")) {
      where.push(
        "(p.public_name LIKE ? OR m.name LIKE ? OR p.internal_resource LIKE ?)",
      );
      const value = `%${url.searchParams.get("q")}%`;
      params.push(value, value, value);
    }
    const countParams = [...params];
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM products p JOIN providers pv ON pv.id = p.provider_id JOIN dictionaries m ON m.id = p.model_id JOIN dictionaries b ON b.id = p.brand_id JOIN dictionaries o ON o.id = p.origin_id JOIN dictionaries l ON l.id = p.product_line_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    )
      .bind(...countParams)
      .first<{ total: number }>();
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await env.DB.prepare(
      `SELECT p.id, p.status, p.public_name AS publicName, p.public_description AS publicDescription, p.internal_resource AS internalResource, p.tier, p.internal_note AS internalNote, p.reference_tpm AS referenceTpm, p.service_note AS serviceNote, p.public_min AS publicMin, p.public_max AS publicMax, p.internal_min AS internalMin, p.internal_max AS internalMax, p.cost_min AS costMin, p.cost_max AS costMax, p.currency, p.unit, p.official_input_min AS officialInputMin, p.official_input_max AS officialInputMax, p.official_output_min AS officialOutputMin, p.official_output_max AS officialOutputMax, p.cache_hit_percent AS cacheHitPercent, p.official_cache_hit_price AS officialCacheHitPrice, p.updated_at AS updatedAt, p.provider_id AS providerId, pv.name AS providerName, m.id AS modelId, m.name AS model, b.id AS brandId, b.name AS brand, o.id AS originId, o.name AS origin, l.id AS productLineId, l.name AS productLine FROM products p JOIN providers pv ON pv.id = p.provider_id JOIN dictionaries m ON m.id = p.model_id JOIN dictionaries b ON b.id = p.brand_id JOIN dictionaries o ON o.id = p.origin_id JOIN dictionaries l ON l.id = p.product_line_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params)
      .all();
    return json({
      data: rows.results,
      meta: { page, pageSize, total: total?.total ?? rows.results.length },
    });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  // Treat a collection PATCH like create for compatibility with older admin bundles
  // that used the edit method while copying a product without an id.
  if (!productId && (request.method === "POST" || request.method === "PATCH")) {
    if (!(await hasPermission(env, actor, "product.write")))
      return json({ error: "forbidden" }, 403);
    const error = validateProduct(body, false);
    if (error) return json({ error }, 400);
    const value = newId();
    await env.DB.prepare(
      `INSERT INTO products (id, provider_id, model_id, brand_id, origin_id, product_line_id, internal_resource, tier, internal_note, public_name, public_description, reference_tpm, service_note, cost_min, cost_max, internal_min, internal_max, public_min, public_max, currency, unit, official_input_min, official_input_max, official_output_min, official_output_max, cache_hit_percent, official_cache_hit_price, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        value,
        body.providerId,
        body.modelId,
        body.brandId,
        body.originId,
        body.productLineId,
        "",
        "",
        "",
        body.publicName,
        body.publicDescription ?? "",
        textOrNull(body.referenceTpm),
        "",
        numberOrNull(body.costMin),
        numberOrNull(body.costMin),
        numberOrNull(body.internalMin),
        numberOrNull(body.internalMax),
        Number(body.publicMin),
        Number(body.publicMin),
        body.currency,
        body.unit ?? "",
        textOrNull(body.officialInputMin),
        textOrNull(body.officialInputMin),
        textOrNull(body.officialOutputMin),
        textOrNull(body.officialOutputMin),
        textOrNull(body.cacheHitPercent),
        textOrNull(body.officialCacheHitPrice),
        actor.id,
      )
      .run();
    await audit(
      env,
      request,
      rid,
      actor,
      "product_created",
      "product",
      value,
      "product created as draft",
    );
    return json({ data: { id: value, status: "draft" } }, 201);
  }
  if (!productId) return json({ error: "product_id_required" }, 400);
  const before = await env.DB.prepare("SELECT * FROM products WHERE id = ?")
    .bind(productId)
    .first<Input>();
  if (!before) return json({ error: "product_not_found" }, 404);
  if (action) {
    if (!(await hasPermission(env, actor, "product.publish")))
      return json({ error: "forbidden" }, 403);
    if (action === "publish") {
      const error = validateProduct(
        {
          providerId: before.provider_id,
          modelId: before.model_id,
          brandId: before.brand_id,
          originId: before.origin_id,
          productLineId: before.product_line_id,
          publicName: before.public_name,
          currency: before.currency,
          unit: before.unit,
          publicMin: before.public_min,
          publicMax: before.public_min,
          internalMin: before.internal_min,
          internalMax: before.internal_max,
        },
        true,
      );
      if (error) return json({ error }, 400);
      await env.DB.prepare(
        "UPDATE products SET status = 'published', published_at = datetime('now'), published_by = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
      )
        .bind(actor.id, actor.id, productId)
        .run();
      if (before.current_pdf_version_id)
        await env.DB.prepare(
          "UPDATE product_pdf_versions SET public_status = 'public', withdrawn_at = NULL WHERE id = ?",
        )
          .bind(before.current_pdf_version_id)
          .run();
    } else
      await env.DB.prepare(
        "UPDATE products SET status = 'disabled', updated_at = datetime('now'), updated_by = ? WHERE id = ?",
      )
        .bind(actor.id, productId)
        .run();
    await audit(
      env,
      request,
      rid,
      actor,
      action === "publish" ? "product_published" : "product_disabled",
      "product",
      productId,
      action,
    );
    return json({
      data: {
        id: productId,
        status: action === "publish" ? "published" : "disabled",
      },
    });
  }
  if (request.method !== "PATCH")
    return json({ error: "method_not_allowed" }, 405);
  if (!(await hasPermission(env, actor, "product.write")))
    return json({ error: "forbidden" }, 403);
  const merged: Input = {
    providerId: before.provider_id,
    modelId: before.model_id,
    brandId: before.brand_id,
    originId: before.origin_id,
    productLineId: before.product_line_id,
    publicName: before.public_name,
    publicDescription: before.public_description,
    currency: before.currency,
    unit: before.unit,
    publicMin: before.public_min,
    publicMax: before.public_max,
    internalMin: before.internal_min,
    internalMax: before.internal_max,
    officialInputMin: before.official_input_min,
    officialInputMax: before.official_input_max,
    officialOutputMin: before.official_output_min,
    officialOutputMax: before.official_output_max,
    cacheHitPercent: before.cache_hit_percent,
    officialCacheHitPrice: before.official_cache_hit_price,
    costMin: before.cost_min,
    costMax: before.cost_max,
    ...body,
  };
  const error = validateProduct(merged, before.status === "published");
  if (error) return json({ error }, 400);
  await env.DB.prepare(
    `UPDATE products SET provider_id = ?, model_id = ?, brand_id = ?, origin_id = ?, product_line_id = ?, internal_resource = ?, tier = ?, internal_note = ?, public_name = ?, public_description = ?, reference_tpm = ?, service_note = ?, cost_min = ?, cost_max = ?, internal_min = ?, internal_max = ?, public_min = ?, public_max = ?, currency = ?, unit = ?, official_input_min = ?, official_input_max = ?, official_output_min = ?, official_output_max = ?, cache_hit_percent = ?, official_cache_hit_price = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
  )
    .bind(
      merged.providerId,
      merged.modelId,
      merged.brandId,
      merged.originId,
      merged.productLineId,
      "",
      "",
      "",
      merged.publicName,
      merged.publicDescription ?? "",
      textOrNull(merged.referenceTpm),
      "",
      numberOrNull(merged.costMin),
      numberOrNull(merged.costMin),
      numberOrNull(merged.internalMin),
      numberOrNull(merged.internalMax),
      Number(merged.publicMin),
      Number(merged.publicMin),
      merged.currency,
      merged.unit ?? before.unit ?? "",
      textOrNull(merged.officialInputMin),
      textOrNull(merged.officialInputMin),
      textOrNull(merged.officialOutputMin),
      textOrNull(merged.officialOutputMin),
      textOrNull(merged.cacheHitPercent),
      textOrNull(merged.officialCacheHitPrice),
      actor.id,
      productId,
    )
    .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "product_updated",
    "product",
    productId,
    "product updated",
    before,
    merged,
  );
  return json({ data: { id: productId } });
}

async function adminCompareApi(request: Request, env: AppEnv, actor: User) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "product.read")))
    return json({ error: "forbidden" }, 403);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const model = url.searchParams.get("model")?.trim() ?? "";
  if (!model) return json({ error: "model_required" }, 400);
  const line = url.searchParams.get("productLine")?.trim() ?? "";
  const params: string[] = [model];
  const where = ["m.name = ?", "p.status != 'disabled'"];
  if (line) {
    where.push("l.name = ?");
    params.push(line);
  }
  const rows = await env.DB.prepare(
    `SELECT p.id, p.status, p.public_name AS publicName, p.public_description AS publicDescription, p.internal_resource AS internalResource, p.tier, p.internal_note AS internalNote, p.reference_tpm AS referenceTpm, p.service_note AS serviceNote, p.public_min AS publicMin, p.public_max AS publicMax, p.internal_min AS internalMin, p.internal_max AS internalMax, p.cost_min AS costMin, p.cost_max AS costMax, p.currency, p.unit, p.updated_at AS updatedAt, p.provider_id AS providerId, pv.name AS providerName, m.id AS modelId, m.name AS model, b.id AS brandId, b.name AS brand, o.id AS originId, o.name AS origin, l.id AS productLineId, l.name AS productLine FROM products p JOIN providers pv ON pv.id = p.provider_id JOIN dictionaries m ON m.id = p.model_id JOIN dictionaries b ON b.id = p.brand_id JOIN dictionaries o ON o.id = p.origin_id JOIN dictionaries l ON l.id = p.product_line_id WHERE ${where.join(" AND ")} ORDER BY p.currency ASC, p.unit ASC, p.internal_min IS NULL ASC, p.internal_min ASC, p.public_min ASC, p.updated_at DESC`,
  )
    .bind(...params)
    .all();
  return json({ data: rows.results });
}

async function productOptionsApi(request: Request, env: AppEnv, actor: User) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "product.read")))
    return json({ error: "forbidden" }, 403);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") === "all" ? "all" : "published";
  const rows = await env.DB.prepare(
    `SELECT p.id, p.status, p.public_name AS publicName, p.public_description AS publicDescription, p.public_min AS publicMin, p.public_max AS publicMax, p.currency, p.unit, p.reference_tpm AS referenceTpm, p.service_note AS serviceNote, pv.name AS providerName, m.name AS model, b.name AS brand, o.name AS origin, l.name AS productLine FROM products p JOIN providers pv ON pv.id = p.provider_id JOIN dictionaries m ON m.id = p.model_id JOIN dictionaries b ON b.id = p.brand_id JOIN dictionaries o ON o.id = p.origin_id JOIN dictionaries l ON l.id = p.product_line_id ${status === "all" ? "" : "WHERE p.status = 'published'"} ORDER BY m.name, p.public_name, p.id`,
  ).all();
  return json({ data: rows.results });
}

async function r2AuditApi(request: Request, env: AppEnv, rid: string, actor: User) {
  if (actor.role !== "super_admin") return json({ error: "forbidden" }, 403);
  if (!env.DB || !env.PDF_BUCKET) return json({ error: "storage_unavailable" }, 503);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  const referenced = await env.DB.prepare("SELECT r2_object_key AS objectKey FROM product_pdf_versions").all<{ objectKey: string }>();
  const keys = new Set(referenced.results.map((row) => row.objectKey));
  const orphaned: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.PDF_BUCKET.list({ prefix: "products/", cursor });
    for (const object of page.objects) if (!keys.has(object.key)) orphaned.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const confirm = body.confirm === true;
  if (confirm) for (const key of orphaned) await env.PDF_BUCKET.delete(key);
  await audit(env, request, rid, actor, "r2_audit", "r2_object", null, `${confirm ? "deleted" : "found"} ${orphaned.length} orphaned objects`);
  return json({ data: { orphaned, deleted: confirm ? orphaned.length : 0, dryRun: !confirm } });
}

async function pdfApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  productId: string,
  versionId?: string,
  action?: "restore" | "withdraw",
) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "pdf.write")))
    return json({ error: "forbidden" }, 403);
  const product = await env.DB.prepare(
    "SELECT id, status, current_pdf_version_id AS currentPdfVersionId FROM products WHERE id = ?",
  )
    .bind(productId)
    .first<{
      id: string;
      status: string;
      currentPdfVersionId: string | null;
    }>();
  if (!product) return json({ error: "product_not_found" }, 404);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, product_id AS productId, version_no AS versionNo, original_filename AS originalFilename, public_filename AS publicFilename, file_size AS fileSize, show_download_button AS showDownloadButton, public_status AS publicStatus, uploaded_at AS uploadedAt FROM product_pdf_versions WHERE product_id = ? ORDER BY version_no DESC",
    )
      .bind(productId)
      .all();
    return json({ data: rows.results });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  if (action && versionId) {
    const version = await env.DB.prepare(
      "SELECT id FROM product_pdf_versions WHERE id = ? AND product_id = ?",
    )
      .bind(versionId, productId)
      .first<{ id: string }>();
    if (!version) return json({ error: "pdf_version_not_found" }, 404);
    if (action === "restore") {
      await env.DB.prepare(
        "UPDATE products SET current_pdf_version_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
      )
        .bind(versionId, actor.id, productId)
        .run();
      await env.DB.prepare(
        "UPDATE product_pdf_versions SET public_status = ?, withdrawn_at = NULL WHERE id = ?",
      )
        .bind(product.status === "published" ? "public" : "private", versionId)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE product_pdf_versions SET public_status = 'withdrawn', withdrawn_at = datetime('now') WHERE id = ?",
      )
        .bind(versionId)
        .run();
      if (product.currentPdfVersionId === versionId)
        await env.DB.prepare(
          "UPDATE products SET current_pdf_version_id = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        )
          .bind(actor.id, productId)
          .run();
    }
    await audit(
      env,
      request,
      rid,
      actor,
      `pdf_${action}`,
      "product_pdf",
      versionId,
      action,
    );
    return json({ data: { id: versionId } });
  }
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!env.PDF_BUCKET) return json({ error: "r2_unavailable" }, 503);
  const form = await request.formData();
  if (form.get("publicSafeConfirmed") !== "true")
    return json({ error: "public_confirmation_required" }, 400);
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "pdf_required" }, 400);
  if (file.size > 50 * 1024 * 1024 || file.type !== "application/pdf")
    return json({ error: "invalid_pdf" }, 400);
  const header = new TextDecoder().decode(
    new Uint8Array(await file.slice(0, 4).arrayBuffer()),
  );
  if (header !== "%PDF") return json({ error: "invalid_pdf_header" }, 400);
  const next = await env.DB.prepare(
    "SELECT COALESCE(MAX(version_no), 0) + 1 AS versionNo FROM product_pdf_versions WHERE product_id = ?",
  )
    .bind(productId)
    .first<{ versionNo: number }>();
  const versionNo = next?.versionNo ?? 1;
  const versionIdValue = newId();
  const key = `products/${productId}/pdf/${versionIdValue}.pdf`;
  await env.PDF_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: "application/pdf" },
  });
  const status = product.status === "published" ? "public" : "private";
  try {
    await env.DB.prepare(
      "INSERT INTO product_pdf_versions (id, product_id, version_no, r2_object_key, original_filename, public_filename, file_size, sha256, show_download_button, public_status, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        versionIdValue,
        productId,
        versionNo,
        key,
        file.name,
        `product-${productId}-v${versionNo}.pdf`,
        file.size,
        await sha256Bytes(await file.arrayBuffer()),
        form.get("showDownloadButton") !== "false" ? 1 : 0,
        status,
        actor.id,
      )
      .run();
  } catch (error) {
    // Compensate an R2 object when the metadata write fails.
    await env.PDF_BUCKET.delete(key).catch(() => undefined);
    throw error;
  }
  if (status === "public")
    await env.DB.prepare(
      "UPDATE products SET current_pdf_version_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    )
      .bind(versionIdValue, actor.id, productId)
      .run();
  await audit(
    env,
    request,
    rid,
    actor,
    "pdf_uploaded",
    "product_pdf",
    versionIdValue,
    "pdf uploaded after public-safe confirmation",
  );
  return json(
    { data: { id: versionIdValue, versionNo, publicStatus: status } },
    201,
  );
}
async function publicPdf(env: AppEnv, productId: string) {
  if (!env.DB || !env.PDF_BUCKET)
    return json({ error: "file_unavailable" }, 503, {
      "Access-Control-Allow-Origin": "*",
    });
  const row = await env.DB.prepare(
    "SELECT v.r2_object_key AS objectKey, v.public_filename AS filename, v.show_download_button AS showDownloadButton FROM products p JOIN product_pdf_versions v ON v.id = p.current_pdf_version_id WHERE p.id = ? AND p.status = 'published' AND v.public_status = 'public'",
  )
    .bind(productId)
    .first<{
      objectKey: string;
      filename: string;
      showDownloadButton: number;
    }>();
  if (!row)
    return json({ error: "file_not_found" }, 404, {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Access-Control-Allow-Origin": "*",
    });
  const object = await env.PDF_BUCKET.get(row.objectKey);
  if (!object)
    return json({ error: "file_not_found" }, 404, {
      "Access-Control-Allow-Origin": "*",
    });
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.filename}"`,
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
async function auditApi(request: Request, env: AppEnv, actor: User) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (request.method === "GET") {
    if (!(await hasPermission(env, actor, "audit.read")))
      return json({ error: "forbidden" }, 403);
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
    const pageSize = Math.min(
      Math.max(Number(url.searchParams.get("pageSize") ?? 50), 1),
      200,
    );
    const where: string[] = [];
    const params: (string | number)[] = [];
    const add = (condition: string, value: string | null) => {
      if (value?.trim()) {
        where.push(condition);
        params.push(value.trim());
      }
    };
    add("created_at >= ?", url.searchParams.get("after"));
    add("created_at < ?", url.searchParams.get("before"));
    add("actor_username_snapshot = ?", url.searchParams.get("actor"));
    add("action = ?", url.searchParams.get("action"));
    add("target_type = ?", url.searchParams.get("targetType"));
    add("result = ?", url.searchParams.get("result"));
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM audit_logs ${clause}`,
    )
      .bind(...params)
      .first<{ total: number }>();
    const rows = await env.DB.prepare(
      `SELECT id, actor_username_snapshot AS actorUsername, role, action, target_type AS targetType, target_id AS targetId, summary, result, request_id AS requestId, ip, user_agent AS userAgent, created_at AS createdAt FROM audit_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all();
    return json({
      data: rows.results,
      meta: { page, pageSize, total: count?.total ?? rows.results.length },
    });
  }
  if (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/admin/audit-logs/purge"
  ) {
    if (!(await hasPermission(env, actor, "audit.purge")))
      return json({ error: "forbidden" }, 403);
    if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
    const body = bodyRecord(await request.json().catch(() => ({})));
    if (!required(body.before)) return json({ error: "before_required" }, 400);
    const result = await env.DB.prepare(
      "DELETE FROM audit_logs WHERE created_at < ?",
    )
      .bind(String(body.before))
      .run();
    await audit(
      env,
      request,
      requestId(request),
      actor,
      "audit_purged",
      "audit_log",
      null,
      `purged ${result.meta.changes} logs`,
    );
    return json({ data: { deleted: result.meta.changes } });
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function dictionariesApi(
  request: Request,
  env: AppEnv,
  rid: string,
  actor: User,
  dictionaryId?: string,
) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await hasPermission(env, actor, "dictionary.write")))
    return json({ error: "forbidden" }, 403);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") ?? 100), 1), 100);
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM dictionaries").first<{ total: number }>();
    const rows = await env.DB.prepare(
      "SELECT id, type, name, status FROM dictionaries ORDER BY type, name LIMIT ? OFFSET ?",
    ).bind(pageSize, (page - 1) * pageSize).all();
    return json({ data: rows.results, meta: { page, pageSize, total: count?.total ?? rows.results.length } });
  }
  if (!sameOrigin(request)) return json({ error: "csrf_check_failed" }, 403);
  const body = bodyRecord(await request.json().catch(() => ({})));
  const allowed = ["model", "brand", "origin", "product_line"];
  if (request.method === "POST") {
    if (!allowed.includes(String(body.type)) || !required(body.name))
      return json({ error: "invalid_dictionary" }, 400);
    const value = newId();
    try {
      await env.DB.prepare(
        "INSERT INTO dictionaries (id, type, name, updated_by) VALUES (?, ?, ?, ?)",
      )
        .bind(value, body.type, String(body.name).trim(), actor.id)
        .run();
    } catch {
      return json({ error: "dictionary_already_exists" }, 409);
    }
    await audit(
      env,
      request,
      rid,
      actor,
      "dictionary_created",
      "dictionary",
      value,
      "dictionary created",
    );
    return json({ data: { id: value } }, 201);
  }
  if (!dictionaryId) return json({ error: "dictionary_id_required" }, 400);
  const before = await env.DB.prepare(
    "SELECT id, type, name, status FROM dictionaries WHERE id = ?",
  )
    .bind(dictionaryId)
    .first<{ id: string; type: string; name: string; status: string }>();
  if (!before) return json({ error: "dictionary_not_found" }, 404);
  const name = body.name === undefined ? before.name : String(body.name).trim();
  const status =
    body.status === "disabled"
      ? "disabled"
      : body.status === "active"
        ? "active"
        : before.status;
  if (!name) return json({ error: "name_required" }, 400);
  try {
    await env.DB.prepare(
      "UPDATE dictionaries SET name = ?, status = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    )
      .bind(name, status, actor.id, dictionaryId)
      .run();
  } catch {
    return json({ error: "dictionary_already_exists" }, 409);
  }
  await audit(
    env,
    request,
    rid,
    actor,
    "dictionary_updated",
    "dictionary",
    dictionaryId,
    "dictionary updated",
    before,
    { name, status },
  );
  return json({ data: { id: dictionaryId } });
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    const rid = requestId(request);
    try {
      if (request.method === "GET" && url.pathname === "/health")
        return json({ ok: true, requestId: rid });
      await ensureInitialAdmin(env);
      if (
        request.method === "OPTIONS" &&
        url.pathname.startsWith("/api/public/")
      )
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      if (request.method === "GET" && url.pathname === "/api/public/products") {
        const response = await publicProducts(env, url);
        response.headers.set("Access-Control-Allow-Origin", "*");
        response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        return response;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/public/dictionaries"
      ) {
        const response = await publicDictionaries(env);
        response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        return response;
      }
      if (request.method === "GET" && url.pathname === "/api/public/compare") {
        const response = await publicCompare(env, url);
        response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
        return response;
      }
      const publicPdfMatch = url.pathname.match(
        /^\/api\/public\/products\/([^/]+)\/pdf$/,
      );
      if (request.method === "GET" && publicPdfMatch)
        return publicPdf(env, publicPdfMatch[1]);
      if (request.method === "POST" && url.pathname === "/api/auth/login")
        return login(request, env, rid);
      const current = await authenticate(request, env);
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        if (!current) return json({ error: "unauthorized" }, 401);
        const token = request.headers
          .get("Cookie")
          ?.match(/(?:^|;\s*)mp_session=([^;]+)/)?.[1];
        if (token && env.DB)
          await env.DB.prepare(
            "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?",
          )
            .bind(await sha256(token))
            .run();
        await audit(
          env,
          request,
          rid,
          current,
          "logout",
          "user",
          current.id,
          "logout",
        );
        return json({ data: { ok: true } }, 200, {
          "Set-Cookie":
            "mp_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
        });
      }
      if (request.method === "GET" && url.pathname === "/api/auth/me")
        return current
          ? json({ data: { user: current } })
          : json({ error: "unauthorized" }, 401);
      if (
        request.method === "POST" &&
        url.pathname === "/api/auth/change-password"
      ) {
        if (!current) return json({ error: "unauthorized" }, 401);
        return changePassword(request, env, rid, current);
      }
      if (url.pathname === "/api/me/quote-profile") {
        if (!current) return json({ error: "unauthorized" }, 401);
        return quoteProfileApi(request, env, rid, current);
      }
      if (url.pathname === "/api/me/quote-generated") {
        if (!current) return json({ error: "unauthorized" }, 401);
        return quoteGeneratedApi(request, env, rid, current);
      }
      if (url.pathname.startsWith("/api/admin")) {
        if (!current) return json({ error: "unauthorized" }, 401);
        if (current.must_change_password)
          return json({ error: "password_change_required" }, 403);
        const permissionsMatch = url.pathname.match(
          /^\/api\/admin\/users\/([^/]+)\/permissions$/,
        );
        if (permissionsMatch)
          return permissionsApi(
            request,
            env,
            rid,
            current,
            permissionsMatch[1],
          );
        if (url.pathname === "/api/admin/products/options")
          return productOptionsApi(request, env, current);
        if (url.pathname === "/api/admin/maintenance/r2-audit")
          return r2AuditApi(request, env, rid, current);
        if (
          url.pathname === "/api/admin/users" ||
          url.pathname.startsWith("/api/admin/users/")
        )
          return usersApi(
            request,
            env,
            rid,
            current,
            url.pathname.split("/")[4],
          );
        if (
          url.pathname === "/api/admin/providers" ||
          url.pathname.startsWith("/api/admin/providers/")
        )
          return providerApi(
            request,
            env,
            rid,
            current,
            url.pathname.split("/")[4],
          );
        if (
          url.pathname === "/api/admin/dictionaries" ||
          url.pathname.startsWith("/api/admin/dictionaries/")
        )
          return dictionariesApi(
            request,
            env,
            rid,
            current,
            url.pathname.split("/")[4],
          );
        const pdfMatch = url.pathname.match(
          /^\/api\/admin\/products\/([^/]+)\/pdf(?:\/([^/]+)\/(restore|withdraw))?$/,
        );
        if (pdfMatch)
          return pdfApi(
            request,
            env,
            rid,
            current,
            pdfMatch[1],
            pdfMatch[2],
            pdfMatch[3] as "restore" | "withdraw" | undefined,
          );
        if (
          url.pathname === "/api/admin/products" ||
          url.pathname.match(/^\/api\/admin\/products\/[^/]+/)
        ) {
          const match = url.pathname.match(
            /^\/api\/admin\/products\/([^/]+)(?:\/(publish|disable))?$/,
          );
          return productsApi(
            request,
            env,
            rid,
            current,
            match?.[1],
            match?.[2] as "publish" | "disable" | undefined,
          );
        }
        if (url.pathname.startsWith("/api/admin/audit-logs"))
          return auditApi(request, env, current);
        if (url.pathname === "/api/admin/compare")
          return adminCompareApi(request, env, current);
        return json({ error: "not_found" }, 404);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: "not_found", requestId: rid }, 404);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId: rid,
          error: String(error),
        }),
      );
      if (
        error instanceof Error &&
        /^bootstrap_(db_read|password_hash|db_write)_failed$/.test(error.message)
      )
        return json({ error: error.message, requestId: rid }, 500);
      return json({ error: "internal_error", requestId: rid }, 500);
    }
  },
};

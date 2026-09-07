import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const persistDir = await mkdtemp(join(tmpdir(), "model-price-worker-"));
const port = 8787 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const wranglerEntry = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
    cwd: root,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0)
    throw new Error(`Wrangler failed: ${result.stdout}\n${result.stderr}`);
}

runWrangler([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistDir,
]);
runWrangler([
  "d1",
  "execute",
  "DB",
  "--local",
  "--persist-to",
  persistDir,
  "--command",
  "INSERT INTO users (id, username, display_name, role, password_hash, must_change_password) VALUES ('bootstrap-admin', 'localadmin', 'localadmin', 'super_admin', 'invalid-bootstrap-hash', 1)",
]);

const child = spawn(
  process.execPath,
  [
    wranglerEntry,
    "dev",
    "--local",
    "--port",
    String(port),
    "--persist-to",
    persistDir,
    "--show-interactive-dev-session=false",
  ],
  {
    cwd: root,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function stop() {
  if (!child.killed) {
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    await rm(persistDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows may briefly hold SQLite files; the temp directory is harmless.
  }
}
process.on("exit", () => child.kill());

async function waitForServer() {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Worker did not start in time.\n${output}`);
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") ?? "";
  return value.match(/mp_session=([^;]*)/)?.[1] || null;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", `mp_session=${options.cookie}`);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined || options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, data, cookie: cookieFrom(response) };
}

async function expectStatus(path, status, options = {}) {
  const result = await api(path, options);
  assert.equal(result.response.status, status, `${path}: ${JSON.stringify(result.data)}`);
  return result;
}

async function login(username, password) {
  const result = await expectStatus("/api/auth/login", 200, {
    method: "POST",
    body: { username, password },
  });
  assert.ok(result.cookie, "login did not return a session cookie");
  return { cookie: result.cookie, user: result.data.data.user };
}

async function changePassword(cookie, currentPassword, newPassword) {
  await expectStatus("/api/auth/change-password", 200, {
    method: "POST",
    cookie,
    body: { currentPassword, newPassword },
  });
}

function id(result) {
  return result.data.data.id;
}

await waitForServer();
try {
  await expectStatus("/health", 200);
  const publicInitial = await expectStatus("/api/public/products?page=1&pageSize=1", 200);
  assert.match(publicInitial.response.headers.get("cache-control") ?? "", /max-age=30/);

  // Initial super admin must change the bootstrap password once.
  await expectStatus("/api/auth/login", 401, {
    method: "POST",
    body: { username: "localadmin", password: "wrong-password" },
  });
  const bootstrap = await login("localadmin", "localpass123");
  assert.equal(bootstrap.user.role, "super_admin");
  assert.equal(bootstrap.user.mustChangePassword, true);
  await changePassword(bootstrap.cookie, "localpass123", "localpass456");
  const admin = await login("localadmin", "localpass456");
  assert.equal(admin.user.mustChangePassword, false);

  const models = id(
    await expectStatus("/api/admin/dictionaries", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: { type: "model", name: "Integration Model" },
    }),
  );
  const brand = id(
    await expectStatus("/api/admin/dictionaries", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: { type: "brand", name: "Integration Brand" },
    }),
  );
  const origin = id(
    await expectStatus("/api/admin/dictionaries", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: { type: "origin", name: "Integration Origin" },
    }),
  );
  const line = id(
    await expectStatus("/api/admin/dictionaries", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: { type: "product_line", name: "Integration Line" },
    }),
  );
  const provider = id(
    await expectStatus("/api/admin/providers", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: { name: "Integration Provider", alias: "IT" },
    }),
  );

  const operatorId = id(
    await expectStatus("/api/admin/users", 201, {
      method: "POST",
      cookie: admin.cookie,
      body: {
        username: `operator-${Date.now()}`,
        displayName: "集成运营",
        password: "operator123",
        role: "operator",
      },
    }),
  );
  const users = await expectStatus("/api/admin/users", 200, {
    cookie: admin.cookie,
  });
  assert.ok(users.data.data.some((item) => item.id === operatorId));
  assert.equal(typeof users.data.meta.total, "number");
  const providerPage = await expectStatus("/api/admin/providers?page=1&pageSize=1", 200, { cookie: admin.cookie });
  assert.equal(typeof providerPage.data.meta.total, "number");
  const dictionaryPage = await expectStatus("/api/admin/dictionaries?page=1&pageSize=1", 200, { cookie: admin.cookie });
  assert.equal(typeof dictionaryPage.data.meta.total, "number");

  // Only super admin can inspect and update permission overrides.
  const permissionList = await expectStatus(
    `/api/admin/users/${operatorId}/permissions`,
    200,
    { cookie: admin.cookie },
  );
  assert.ok(permissionList.data.data.some((item) => item.key === "product.read"));
  await expectStatus(`/api/admin/users/${operatorId}/permissions`, 200, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { permissionKey: "product.read", effect: "deny" },
  });

  const operatorBootstrap = await login(
    users.data.data.find((item) => item.id === operatorId).username,
    "operator123",
  );
  assert.equal(operatorBootstrap.user.mustChangePassword, true);
  await changePassword(operatorBootstrap.cookie, "operator123", "operator456");
  const operator = await login(
    users.data.data.find((item) => item.id === operatorId).username,
    "operator456",
  );
  await expectStatus("/api/admin/products", 403, { cookie: operator.cookie });
  await expectStatus("/api/admin/users", 403, { cookie: operator.cookie });
  await expectStatus("/api/admin/audit-logs", 403, { cookie: operator.cookie });
  await expectStatus("/api/admin/audit-logs/purge", 403, {
    method: "POST",
    cookie: operator.cookie,
    body: { before: "2999-01-01" },
  });

  await expectStatus(`/api/admin/users/${operatorId}/permissions`, 403, {
    cookie: operator.cookie,
  });
  await expectStatus(`/api/admin/users/${operatorId}/permissions`, 200, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { permissionKey: "product.read", effect: "allow" },
  });

  const draft = await expectStatus("/api/admin/products", 201, {
    method: "POST",
    cookie: operator.cookie,
    body: {
      providerId: provider,
      modelId: models,
      brandId: brand,
      originId: origin,
      productLineId: line,
      publicName: "集成测试产品",
      publicDescription: "公开描述",
      internalResource: "internal-resource",
      tier: "standard",
      internalNote: "internal-note",
      publicMin: 1.25,
      publicMax: 2.5,
      costMin: 0.5,
      costMax: 1,
      currency: "USD",
      unit: "1M tokens",
    },
  });
  const productId = id(draft);
  // The admin copy flow submits a collection PATCH in older bundles; keep this
  // path covered so placeholder/binding regressions fail locally before deploy.
  const copiedDraft = await expectStatus("/api/admin/products", 201, {
    method: "PATCH",
    cookie: operator.cookie,
    body: {
      providerId: provider,
      modelId: models,
      brandId: brand,
      originId: origin,
      productLineId: line,
      publicName: "集成测试产品 - 副本",
      publicDescription: "公开描述",
      referenceTpm: "500-1000w",
      publicMin: 0.78,
      currency: "USD",
      officialInputMin: "1.00",
      officialOutputMin: "2.00",
      cacheHitPercent: "大于60%",
      officialCacheHitPrice: "0.50",
    },
  });
  assert.notEqual(id(copiedDraft), productId);
  const options = await expectStatus("/api/admin/products/options?status=all", 200, { cookie: operator.cookie });
  assert.ok(options.data.data.some((item) => item.id === productId));
  await expectStatus(`/api/admin/products/${productId}/publish`, 400, {
    method: "POST",
    cookie: operator.cookie,
  });
  await expectStatus(`/api/admin/products/${productId}`, 200, {
    method: "PATCH",
    cookie: operator.cookie,
    body: { internalMin: 0.75, internalMax: 1.5 },
  });
  await expectStatus(`/api/admin/products/${productId}/publish`, 200, {
    method: "POST",
    cookie: operator.cookie,
  });

  const publicProducts = await expectStatus(
    "/api/public/products?q=集成测试产品&productLine=Integration%20Line&origin=Integration%20Origin&page=1&pageSize=20",
    200,
  );
  assert.equal(publicProducts.data.meta.total, 1);
  const publicRow = publicProducts.data.data[0];
  assert.equal(publicRow.id, productId);
  assert.equal("costMin" in publicRow, false);
  assert.equal("internalMin" in publicRow, false);
  assert.equal("providerName" in publicRow, false);
  const compare = await expectStatus(
    "/api/public/compare?model=Integration%20Model",
    200,
  );
  assert.ok(compare.data.data.some((item) => item.id === productId));
  const internalCompare = await expectStatus(
    "/api/admin/compare?model=Integration%20Model",
    200,
    { cookie: operator.cookie },
  );
  const internalRow = internalCompare.data.data.find((item) => item.id === productId);
  assert.ok(internalRow, "original product missing from internal compare");
  assert.equal(internalRow.costMin, 0.5);
  assert.equal(internalRow.internalMin, 0.75);

  const form = new FormData();
  form.set("publicSafeConfirmed", "true");
  form.set("showDownloadButton", "true");
  form.set("file", new Blob(["%PDF-1.4\nIntegration test"], { type: "application/pdf" }), "source.pdf");
  const missingConfirmation = new FormData();
  missingConfirmation.set("file", new Blob(["%PDF-1.4\nIntegration test"], { type: "application/pdf" }), "source.pdf");
  await expectStatus(`/api/admin/products/${productId}/pdf`, 400, {
    method: "POST",
    cookie: operator.cookie,
    body: missingConfirmation,
  });
  const invalidPdf = new FormData();
  invalidPdf.set("publicSafeConfirmed", "true");
  invalidPdf.set("file", new Blob(["not a pdf"], { type: "application/pdf" }), "bad.pdf");
  await expectStatus(`/api/admin/products/${productId}/pdf`, 400, {
    method: "POST",
    cookie: operator.cookie,
    body: invalidPdf,
  });
  const uploaded = await expectStatus(`/api/admin/products/${productId}/pdf`, 201, {
    method: "POST",
    cookie: operator.cookie,
    body: form,
  });
  const versionId = id(uploaded);
  const pdf = await fetch(`${baseUrl}/api/public/products/${productId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  await expectStatus(`/api/admin/products/${productId}/pdf/${versionId}/withdraw`, 200, {
    method: "POST",
    cookie: operator.cookie,
  });
  assert.equal((await fetch(`${baseUrl}/api/public/products/${productId}/pdf`)).status, 404);
  await expectStatus(`/api/admin/products/${productId}/pdf/${versionId}/restore`, 200, {
    method: "POST",
    cookie: operator.cookie,
  });
  assert.equal((await fetch(`${baseUrl}/api/public/products/${productId}/pdf`)).status, 200);
  const r2Scan = await expectStatus("/api/admin/maintenance/r2-audit", 200, {
    method: "POST",
    cookie: admin.cookie,
    body: { confirm: false },
  });
  assert.equal(r2Scan.data.data.dryRun, true);
  assert.deepEqual(r2Scan.data.data.orphaned, []);

  await expectStatus("/api/me/quote-profile", 200, { cookie: operator.cookie });
  await expectStatus("/api/me/quote-profile", 200, {
    method: "PATCH",
    cookie: operator.cookie,
    body: { companyName: "集成公司", contactName: "运营", phone: "13800000000" },
  });
  const profile = await expectStatus("/api/me/quote-profile", 200, { cookie: operator.cookie });
  assert.equal(profile.data.data.companyName, "集成公司");
  await expectStatus("/api/me/quote-generated", 200, {
    method: "POST",
    cookie: operator.cookie,
    body: { ignored: "quote content is not stored" },
  });

  await expectStatus(`/api/admin/providers/${provider}`, 200, {
    method: "PATCH",
    cookie: operator.cookie,
    body: { status: "disabled" },
  });
  const afterDisable = await expectStatus("/api/admin/products?page=1&pageSize=100", 200, {
    cookie: operator.cookie,
  });
  assert.equal(afterDisable.data.data.find((item) => item.id === productId).status, "disabled");
  const afterPublic = await expectStatus("/api/public/products?q=集成测试产品", 200);
  assert.equal(afterPublic.data.meta.total, 0);

  const failures = await expectStatus("/api/admin/audit-logs?result=failure&pageSize=200", 200, {
    cookie: admin.cookie,
  });
  assert.ok(failures.data.data.some((item) => item.action === "login_failed"));
  const purge = await expectStatus("/api/admin/audit-logs/purge", 200, {
    method: "POST",
    cookie: admin.cookie,
    body: { before: "2999-01-01" },
  });
  assert.ok(purge.data.data.deleted > 0);
  const purgeAudit = await expectStatus("/api/admin/audit-logs?action=audit_purged", 200, {
    cookie: admin.cookie,
  });
  assert.ok(purgeAudit.data.data.length >= 1);

  console.log("Integration test passed: authentication, permissions, CRUD, PDF, quote audit, logs, and public isolation.");
} finally {
  await stop();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker/src/index.ts", import.meta.url), "utf8");
const publicApp = await readFile(new URL("../apps/public/src/main.tsx", import.meta.url), "utf8");
const adminApp = await readFile(new URL("../apps/admin/src/main.tsx", import.meta.url), "utf8");

// Contract checks run without Cloudflare credentials or a remote database.
assert.match(worker, /\/api\/public\/compare/);
assert.match(worker, /\/api\/public\/dictionaries/);
assert.match(worker, /\/api\/admin\/compare/);
assert.match(worker, /\/api\/me\/quote-generated/);
assert.match(worker, /quote_generated/);
assert.match(worker, /result: "success" \| "failure"/);
assert.match(worker, /productLine = url\.searchParams/);
assert.match(worker, /origin = url\.searchParams/);
assert.match(worker, /currency ASC, p\.unit ASC/);
assert.match(worker, /created_at >= \?/);
assert.match(worker, /audit-logs\/purge/);
assert.match(worker, /permissionsMatch/);
assert.match(worker, /user_permission_updated/);
assert.match(worker, /LIMIT \? OFFSET \?/);
assert.match(worker, /productOptionsApi/);
assert.match(worker, /r2AuditApi/);
assert.match(publicApp, /选择模型/);
assert.match(publicApp, /compareGroups/);
assert.match(adminApp, /清理旧日志/);
assert.match(adminApp, /editingProviderId/);
assert.match(adminApp, /editingDictionaryId/);

const baseUrl = process.env.TEST_BASE_URL;
if (baseUrl) {
  const health = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
  assert.equal(health.status, 200, "Worker health check failed");
  const products = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/products?page=1&pageSize=1`);
  assert.equal(products.status, 200, "Public products endpoint failed");
  const payload = await products.json();
  assert.ok(Array.isArray(payload.data), "Public products data must be an array");
  assert.ok(payload.meta && typeof payload.meta.total === "number", "Pagination metadata missing");
  const dictionaries = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/dictionaries`);
  assert.equal(dictionaries.status, 200, "Public dictionaries endpoint failed");
  const dictionaryPayload = await dictionaries.json();
  assert.ok(Array.isArray(dictionaryPayload.data), "Public dictionaries data must be an array");
  console.log(`HTTP smoke passed: ${baseUrl}`);
} else {
  console.log("Contract smoke passed (set TEST_BASE_URL to run HTTP checks).");
}

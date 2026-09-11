import { existsSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const varsFile = join(root, ".dev.vars");
const wranglerEntry = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(varsFile)) {
  console.error("未找到 .dev.vars。请先复制 .dev.vars.example 为 .dev.vars，再按需修改本地管理员账号。");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("正在应用本地 D1 迁移...");
run(process.execPath, [wranglerEntry, "d1", "migrations", "apply", "DB", "--local"]);

console.log("正在构建管理后台...");
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:admin"]);

console.log("本地 Worker 启动中：http://localhost:8787");
const child = spawn(process.execPath, [
  wranglerEntry,
  "dev",
  "--local",
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
});

const stop = (signal) => child.kill(signal);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

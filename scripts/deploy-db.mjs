import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.includes("--local") ? ["--local"] : ["--remote"];
const target = args[0] === "--local" ? "DB" : "model-price-db-production";

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["wrangler", "d1", "migrations", "apply", target, ...args]);
run("npx", ["wrangler", "d1", "migrations", "list", target, ...args]);

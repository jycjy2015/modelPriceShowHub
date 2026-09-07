import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function run(script, args = []) {
  const result = spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("deploy-db.mjs");
run("deploy-admin.mjs");
run("deploy-public.mjs");

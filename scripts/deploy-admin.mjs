import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build:admin"]);
run("npx", ["wrangler", "deploy", "--dry-run"]);
run("npx", ["wrangler", "deploy"]);
console.log("Admin Worker deployed with the latest assets. If the browser keeps an old asset hash, hard-refresh once to clear the cached index.html.");

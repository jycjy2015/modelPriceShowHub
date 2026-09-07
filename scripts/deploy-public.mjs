import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = fileURLToPath(new URL("../apps/public/", import.meta.url));
// The existing Pages project uses master as its Production branch.
const branch = process.env.CF_PAGES_BRANCH || "master";
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build from the repository root, then deploy from apps/public so Pages Functions are included.
run("npm", ["run", "build:public"]);
run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name", "model-price-public", "--branch", branch, "--commit-dirty"], publicDir);

console.log(`Public Pages deployed to project model-price-public, branch ${branch}. If a browser still reports a JavaScript MIME error, hard-refresh once to discard a cached index.html.`);

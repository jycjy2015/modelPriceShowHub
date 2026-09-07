import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";

const database = "model-price-db-production";
const username = process.argv[2]?.trim();
if (!username) {
  console.error("用法: npm run reset:admin -- <管理员用户名>");
  process.exit(1);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(new Error("需要在交互式终端运行，密码不会通过命令参数传递"));
      return;
    }
    stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error("已取消"));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    stdin.on("data", onData);
  });
}

const password = await readHidden("请输入新的临时密码（至少 8 位，不会回显）: ");
if (password.length < 8) throw new Error("密码至少需要 8 位");
const iterations = 99_999;
const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const encoded = `pbkdf2$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
const sql = `UPDATE users SET password_hash = '${encoded}', must_change_password = 1, status = 'active', updated_at = datetime('now') WHERE username = '${username.replaceAll("'", "''")}' AND role = 'super_admin'; UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = (SELECT id FROM users WHERE username = '${username.replaceAll("'", "''")}');`;
const root = fileURLToPath(new URL("..", import.meta.url));
const wranglerEntry = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const result = spawnSync(process.execPath, [wranglerEntry, "d1", "execute", database, "--remote", "--command", sql], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("管理员密码哈希已写入远程 D1，现有会话已注销；请登录后立即修改密码。");

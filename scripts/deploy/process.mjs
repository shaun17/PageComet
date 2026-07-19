import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const wranglerCli = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
export const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

/** 以参数数组启动子进程，兼容 Windows、macOS 和 Linux，且不经过 shell 拼接。 */
export const runProcess = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      const detail = signal ? `信号 ${signal}` : `退出码 ${code ?? "未知"}`;
      return reject(new Error(`${executable} ${args.join(" ")} 执行失败（${detail}）`));
    });
  });

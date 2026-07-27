import { execFileSync, spawn } from "node:child_process";
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
export const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 5 * 1000;

/** 构造 Windows 进程树强制终止参数，避免 npm.cmd 的后代进程继续运行。 */
export const createWindowsTaskkillArguments = (pid) => [
  "/pid",
  String(pid),
  "/t",
  "/f",
];

/** 使用系统 taskkill 一次终止 Windows 子进程及其全部后代。 */
const terminateWindowsProcessTree = (child) => {
  if (!child.pid) return false;
  try {
    execFileSync("taskkill", createWindowsTaskkillArguments(child.pid), {
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    throw error;
  }
};

/** 向单个进程或 POSIX 进程组发送信号，确保 npm 的孙进程不会在超时后残留。 */
const signalProcessTree = (child, signal, usesProcessGroup) => {
  if (!child.pid) return false;
  try {
    if (usesProcessGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
};

/** 判断超时后的 POSIX 进程组是否仍有后代存活，决定是否需要升级为强制终止。 */
const isProcessTreeRunning = (child, usesProcessGroup) => {
  if (!usesProcessGroup) return false;
  return signalProcessTree(child, 0, true);
};

/** 以参数数组启动带硬超时的子进程，兼容各平台且不经过 shell 拼接。 */
export const runProcess = (executable, args, options = {}) => {
  const {
    timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
    forceKillDelayMs = FORCE_KILL_DELAY_MS,
    ...spawnOptions
  } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("子进程超时必须是正整数毫秒");
  }
  if (!Number.isSafeInteger(forceKillDelayMs) || forceKillDelayMs <= 0) {
    throw new TypeError("子进程强制终止等待时间必须是正整数毫秒");
  }

  return new Promise((resolve, reject) => {
    const usesProcessGroup =
      process.platform !== "win32" && spawnOptions.detached !== false;
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
      detached: usesProcessGroup,
      ...spawnOptions,
    });
    let timedOut = false;
    let settled = false;
    let forceKillTimer;
    let timeoutTimer;

    /** 构造统一的超时错误，避免不同退出顺序产生不同诊断信息。 */
    const createTimeoutError = () =>
      new Error(
        `${executable} ${args.join(" ")} 执行超过 ${timeoutMs} 毫秒，已终止`,
      );

    /** 清理当前子进程持有的计时器，避免成功执行后阻止 Node 正常退出。 */
    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    /** 只结算一次 Promise，处理 spawn error 与 exit 同时到达的竞态。 */
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") {
        try {
          terminateWindowsProcessTree(child);
          return settle(() => reject(createTimeoutError()));
        } catch (error) {
          return settle(() =>
            reject(
              new AggregateError(
                [createTimeoutError(), error],
                `${executable} 的 Windows 进程树终止失败`,
              ),
            ),
          );
        }
      }
      signalProcessTree(child, "SIGTERM", usesProcessGroup);
      forceKillTimer = setTimeout(() => {
        signalProcessTree(child, "SIGKILL", usesProcessGroup);
        settle(() => reject(createTimeoutError()));
      }, forceKillDelayMs);
    }, timeoutMs);
    timeoutTimer.unref();

    child.once("error", (error) => settle(() => reject(error)));
    child.once("exit", (code, signal) => {
      if (timedOut) {
        if (isProcessTreeRunning(child, usesProcessGroup)) return;
        return settle(() => reject(createTimeoutError()));
      }
      if (code === 0) return settle(resolve);
      const detail = signal ? `信号 ${signal}` : `退出码 ${code ?? "未知"}`;
      return settle(() =>
        reject(new Error(`${executable} ${args.join(" ")} 执行失败（${detail}）`)),
      );
    });
  });
};

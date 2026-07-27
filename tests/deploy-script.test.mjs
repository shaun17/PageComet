import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeploymentScanValues,
  createNotionBuildEnvironment,
  createTestEnvironment,
  createVerificationEnvironment,
  createWranglerEnvironment,
  validateDeploymentEnvironment,
} from "../scripts/deploy.mjs";
import {
  createWindowsTaskkillArguments,
  runProcess,
} from "../scripts/deploy/process.mjs";

const validEnvironment = {
  NOTION_TOKEN: "ntn_abcdefghijklmnopqrstuvwxyz0123456789",
  NOTION_DATA_SOURCE_ID: "11111111-2222-4333-8444-555555555555",
  NOTION_JOURNAL_DATA_SOURCE_ID: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  CLOUDFLARE_PAGES_PROJECT: "alice-portfolio",
};

/** 逐项删除必需变量，确保部署不会带着不完整配置继续运行。 */
for (const name of Object.keys(validEnvironment)) {
  test(`rejects a missing ${name}`, () => {
    const environment = { ...validEnvironment };
    delete environment[name];
    assert.throws(() => validateDeploymentEnvironment(environment), new RegExp(name));
  });
}

test("validates deployment identifiers before running child processes", () => {
  assert.deepEqual(validateDeploymentEnvironment(validEnvironment), {
    notionToken: validEnvironment.NOTION_TOKEN,
    notionDataSourceId: validEnvironment.NOTION_DATA_SOURCE_ID,
    notionJournalDataSourceId: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
    pagesProject: validEnvironment.CLOUDFLARE_PAGES_PROJECT,
  });
  assert.throws(
    () => validateDeploymentEnvironment({ ...validEnvironment, NOTION_TOKEN: "placeholder" }),
    /NOTION_TOKEN 格式无效/,
  );
  assert.throws(
    () =>
      validateDeploymentEnvironment({
        ...validEnvironment,
        CLOUDFLARE_PAGES_PROJECT: "Alice Portfolio",
      }),
    /CLOUDFLARE_PAGES_PROJECT 格式无效/,
  );
});

test("isolates credentials for every deployment stage", () => {
  const environment = {
    ...validEnvironment,
    NOTION_CUSTOM_SETTING: "private",
    CONTENT_SOURCE: "notion",
    ALLOW_EMPTY_SITE: "true",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
    CLOUDFLARE_API_KEY: "cloudflare-global-api-key",
    CLOUDFLARE_EMAIL: "cloudflare@example.com",
    CLOUDFLARE_CUSTOM_SETTING: "must-not-pass",
    CF_API_TOKEN: "legacy-token",
    GITHUB_TOKEN: "unrelated-github-token",
    AWS_SECRET_ACCESS_KEY: "unrelated-aws-secret",
    STATIC_OUTPUT_SECRET_MANIFEST: "/tmp/stale-manifest.json",
    ASTRO_ENV_DIR: "/project/root",
    PATH: "/usr/bin",
  };
  const deployment = validateDeploymentEnvironment(environment);

  assert.deepEqual(createTestEnvironment(environment, "/tmp/isolated-astro-env"), {
    ASTRO_ENV_DIR: "/tmp/isolated-astro-env",
    PATH: "/usr/bin",
  });
  assert.deepEqual(
    createNotionBuildEnvironment(environment, deployment, "/tmp/isolated-astro-env"),
    {
      ASTRO_ENV_DIR: "/tmp/isolated-astro-env",
      PATH: "/usr/bin",
      NOTION_TOKEN: validEnvironment.NOTION_TOKEN,
      NOTION_DATA_SOURCE_ID: validEnvironment.NOTION_DATA_SOURCE_ID,
      NOTION_JOURNAL_DATA_SOURCE_ID: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
      ALLOW_EMPTY_SITE: "true",
    },
  );
  assert.deepEqual(
    createVerificationEnvironment(environment, "/tmp/current-manifest.json"),
    {
      ASTRO_ENV_DIR: "/project/root",
      PATH: "/usr/bin",
      STATIC_OUTPUT_SECRET_MANIFEST: "/tmp/current-manifest.json",
    },
  );
  assert.deepEqual(createWranglerEnvironment(environment), {
    ASTRO_ENV_DIR: "/project/root",
    PATH: "/usr/bin",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
  });
  assert.deepEqual(createDeploymentScanValues(environment, deployment), {
    NOTION_TOKEN: validEnvironment.NOTION_TOKEN,
    NOTION_DATA_SOURCE_ID: validEnvironment.NOTION_DATA_SOURCE_ID,
    NOTION_JOURNAL_DATA_SOURCE_ID: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
  });
});

test("adds credential-bearing proxy values to the real-secret scan", () => {
  const proxy = "https://proxy-user-2026:proxy-password-2026@proxy.example.com:8443";
  const deployment = validateDeploymentEnvironment(validEnvironment);
  const scanValues = createDeploymentScanValues(
    { ...validEnvironment, HTTPS_PROXY: proxy },
    deployment,
  );

  assert.equal(scanValues.HTTPS_PROXY_URL, proxy);
  assert.equal(scanValues.HTTPS_PROXY_USERNAME, "proxy-user-2026");
  assert.equal(scanValues.HTTPS_PROXY_PASSWORD, "proxy-password-2026");
});

test("keeps fixture tests deterministic when empty-site override exists", () => {
  assert.deepEqual(
    createTestEnvironment({ PATH: "/usr/bin", ALLOW_EMPTY_SITE: "true" }),
    { PATH: "/usr/bin" },
  );
});

/** 卡死的构建子进程必须在期限内连同进程组退出，不能永久占用定时发布锁。 */
test("terminates a deployment process after its hard timeout", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      timeoutMs: 100,
    }),
    /执行超过 100 毫秒，已终止/,
  );
  assert.ok(Date.now() - startedAt < 3_000);
});

/** Windows 必须要求系统工具连同后代一起强制终止，而非只结束 npm.cmd。 */
test("builds a Windows taskkill command for the complete process tree", () => {
  assert.deepEqual(createWindowsTaskkillArguments(1234), [
    "/pid",
    "1234",
    "/t",
    "/f",
  ]);
});

/** 轮询进程号直到系统确认退出，避免把短暂的回收延迟误判为残留。 */
const waitForProcessExit = async (pid) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`超时进程组仍残留子进程 ${pid}`);
};

/** POSIX 超时必须升级信号并清理忽略 SIGTERM 的孙进程。 */
test(
  "force-kills descendants that survive the graceful timeout signal",
  { skip: process.platform === "win32" },
  async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "pagecomet-process-timeout-"),
    );
    const pidFile = path.join(temporaryDirectory, "descendant.pid");
    const descendantProgram = [
      'const { writeFileSync } = require("node:fs");',
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'process.on("SIGTERM", () => {});',
      "setInterval(() => {}, 1000);",
    ].join("");
    const parentProgram = [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendantProgram)}], { stdio: "ignore" });`,
      "setInterval(() => {}, 1000);",
    ].join("");

    try {
      await assert.rejects(
        runProcess(process.execPath, ["-e", parentProgram], {
          stdio: "ignore",
          timeoutMs: 250,
          forceKillDelayMs: 100,
        }),
        /执行超过 250 毫秒，已终止/,
      );
      const descendantPid = Number(await readFile(pidFile, "utf8"));
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      await waitForProcessExit(descendantPid);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

/** 双击发布也必须在安装依赖或登录 Cloudflare 前发现第二数据源缺失。 */
test("checks both Notion data sources before the macOS deployment flow", async () => {
  const launcher = await readFile(new URL("../deploy.command", import.meta.url), "utf8");
  for (const name of [
    "NOTION_TOKEN",
    "NOTION_DATA_SOURCE_ID",
    "NOTION_JOURNAL_DATA_SOURCE_ID",
    "CLOUDFLARE_PAGES_PROJECT",
  ]) {
    assert.match(launcher, new RegExp(`\\[.*\"${name}\"`));
  }
});

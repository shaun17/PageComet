import { writeFile } from "node:fs/promises";
import path from "node:path";

const NOTION_DATA_SOURCE_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const SECRET_SCAN_MANIFEST_VARIABLE = "STATIC_OUTPUT_SECRET_MANIFEST";
const CLOUDFLARE_WRANGLER_VARIABLES = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];
const PROXY_VARIABLES = new Set(["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY"]);
const SAFE_RUNTIME_VARIABLES = new Set([
  "ALL_PROXY",
  "APPDATA",
  "ASTRO_ENV_DIR",
  "ASTRO_TELEMETRY_DISABLED",
  "CI",
  "COLORTERM",
  "COMSPEC",
  "DO_NOT_TRACK",
  "FORCE_COLOR",
  "HOME",
  "HOSTNAME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NODE_NO_WARNINGS",
  "NO_COLOR",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "WRANGLER_LOG",
  "WRANGLER_SEND_METRICS",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "__CF_USER_TEXT_ENCODING",
]);

/** 去除首尾空白并拒绝空值，让配置错误在执行 Cloudflare 命令前暴露。 */
const readRequiredValue = (environment, name) => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}：请先复制 .env.example 并填写真实值`);
  return value;
};

/** 校验 Pages 项目名并返回可直接交给 Wrangler 的值。 */
export const validatePagesProjectEnvironment = (environment) => {
  const pagesProject = readRequiredValue(environment, "CLOUDFLARE_PAGES_PROJECT");
  if (
    pagesProject.length > 58 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(pagesProject)
  ) {
    throw new Error("CLOUDFLARE_PAGES_PROJECT 格式无效：仅支持小写字母、数字和中划线");
  }
  return pagesProject;
};

/** 严格校验部署所需的 Notion 凭据、数据源 ID 和 Pages 项目名。 */
export const validateDeploymentEnvironment = (environment) => {
  const notionToken = readRequiredValue(environment, "NOTION_TOKEN");
  const notionDataSourceId = readRequiredValue(environment, "NOTION_DATA_SOURCE_ID");
  const pagesProject = validatePagesProjectEnvironment(environment);

  if (!/^(?:ntn_|secret_)[A-Za-z0-9_-]{10,}$/.test(notionToken)) {
    throw new Error("NOTION_TOKEN 格式无效：应使用 Notion Integration 的 ntn_ 或 secret_ 密钥");
  }
  if (!NOTION_DATA_SOURCE_PATTERN.test(notionDataSourceId)) {
    throw new Error("NOTION_DATA_SOURCE_ID 格式无效：应填写 32 位 Notion 数据源 UUID");
  }

  return { notionToken, notionDataSourceId, pagesProject };
};

/** 从环境白名单创建各子进程共享的无凭据基础环境。 */
export const createCredentialFreeEnvironment = (environment) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        SAFE_RUNTIME_VARIABLES.has(name.toUpperCase()) ||
        name.toUpperCase().startsWith("LC_"),
    ),
  );

/** 测试只使用无凭据基础环境和空 Astro 配置目录，避免 fixture 重新加载项目 .env。 */
export const createTestEnvironment = (environment, astroEnvironmentDirectory) => ({
  ...createCredentialFreeEnvironment(environment),
  ...(astroEnvironmentDirectory
    ? { ASTRO_ENV_DIR: astroEnvironmentDirectory }
    : {}),
});

/** Notion 构建只恢复读取内容所需变量，不传入任何 Cloudflare 配置。 */
export const createNotionBuildEnvironment = (
  environment,
  { notionToken, notionDataSourceId },
  astroEnvironmentDirectory,
) => {
  const buildEnvironment = {
    ...createCredentialFreeEnvironment(environment),
    ...(astroEnvironmentDirectory
      ? { ASTRO_ENV_DIR: astroEnvironmentDirectory }
      : {}),
    NOTION_TOKEN: notionToken,
    NOTION_DATA_SOURCE_ID: notionDataSourceId,
  };
  const allowEmptySite = environment.ALLOW_EMPTY_SITE?.trim();
  if (allowEmptySite) buildEnvironment.ALLOW_EMPTY_SITE = allowEmptySite;
  return buildEnvironment;
};

/** 静态校验只获得临时清单路径；真实密钥不进入该子进程的环境变量。 */
export const createVerificationEnvironment = (environment, manifestPath) => ({
  ...createCredentialFreeEnvironment(environment),
  [SECRET_SCAN_MANIFEST_VARIABLE]: manifestPath,
});

/** Wrangler 只恢复官方 Cloudflare 认证变量，Notion 密钥始终被移除。 */
export const createWranglerEnvironment = (environment) => {
  const wranglerEnvironment = createCredentialFreeEnvironment(environment);
  for (const name of CLOUDFLARE_WRANGLER_VARIABLES) {
    const value = environment[name]?.trim();
    if (value) wranglerEnvironment[name] = value;
  }
  return wranglerEnvironment;
};

/** 安全解码代理登录信息；无效百分号编码不会中断发布前校验。 */
const decodeProxyCredential = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** 收集构建凭据及代理登录信息，供最终产物做精确泄漏扫描。 */
export const createDeploymentScanValues = (environment, deployment) => {
  const scanValues = {
    NOTION_TOKEN: deployment.notionToken,
    NOTION_DATA_SOURCE_ID: deployment.notionDataSourceId,
    ...Object.fromEntries(
      CLOUDFLARE_WRANGLER_VARIABLES.map((name) => [name, environment[name]?.trim()]),
    ),
  };

  for (const [name, rawValue] of Object.entries(environment)) {
    const normalizedName = name.toUpperCase();
    if (!PROXY_VARIABLES.has(normalizedName) || !rawValue?.trim()) continue;

    const proxyValue = rawValue.trim();
    try {
      const proxyUrl = new URL(proxyValue.includes("://") ? proxyValue : `http://${proxyValue}`);
      if (!proxyUrl.username && !proxyUrl.password) continue;

      scanValues[`${normalizedName}_URL`] = proxyValue;
      const username = decodeProxyCredential(proxyUrl.username);
      const password = decodeProxyCredential(proxyUrl.password);
      if (username.length >= 8) scanValues[`${normalizedName}_USERNAME`] = username;
      if (password.length >= 8) scanValues[`${normalizedName}_PASSWORD`] = password;
    } catch {
      // 代理变量仍由底层网络库解释；这里只跳过无法可靠拆分的凭据片段。
    }
  }
  return scanValues;
};

/** 把真实密钥写入仅当前用户可读的临时清单，不把值放进参数或日志。 */
export const writeSecretScanManifest = async (directory, secrets) => {
  const manifestPath = path.join(directory, "secret-scan-manifest.json");
  const manifest = {
    version: 1,
    secrets: Object.entries(secrets)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([name, value]) => ({ name, value })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return manifestPath;
};

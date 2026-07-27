import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const TEMPLATE_REPOSITORY = "github.com/shaun17/pagecomet";
const PERSONAL_REPOSITORY = "github.com/shaun17/wenren-site";
const COMMON_FORBIDDEN_FILES = new Set(["site.config.mjs"]);
const COMMON_FORBIDDEN_PREFIXES = [
  ".astro/",
  ".cache/",
  ".wrangler/",
  "dist/",
  "node_modules/",
  "public/notion-assets/",
];
const TEMPLATE_FORBIDDEN_FILES = new Set([
  "src/components/SpatialPortrait.astro",
  "src/lib/spatial-avatar-scene.ts",
  "src/lib/spatial-portrait.ts",
  "src/pages/avatar.astro",
  "src/styles/avatar.css",
  "tests/spatial-portrait.test.mjs",
]);
const TEMPLATE_FORBIDDEN_PREFIXES = ["public/3d/"];
const PERSONAL_REQUIRED_FILES = [
  "src/components/SpatialPortrait.astro",
  "src/lib/spatial-avatar-scene.ts",
  "src/lib/spatial-portrait.ts",
  "src/pages/avatar.astro",
  "src/styles/avatar.css",
  "tests/spatial-portrait.test.mjs",
];

/** 把 SSH 与 HTTPS GitHub 地址统一成不带协议和 .git 后缀的小写标识。 */
export const normalizeRepositoryUrl = (value = "") =>
  value
    .trim()
    .replace(/^git@github\.com:/i, "github.com/")
    .replace(/^https?:\/\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/** 根据显式角色、GitHub Actions 仓库名或个人站 origin 判断当前仓库职责。 */
export const resolveRepositoryRole = ({
  explicitRole = "",
  githubRepository = "",
  originUrl = "",
} = {}) => {
  if (["template", "personal", "downstream"].includes(explicitRole)) {
    return explicitRole;
  }

  const actionsRepository = normalizeRepositoryUrl(
    githubRepository ? `github.com/${githubRepository}` : "",
  );
  if (actionsRepository === TEMPLATE_REPOSITORY) return "template";
  if (actionsRepository === PERSONAL_REPOSITORY) return "personal";

  // 官方模板的普通 clone 仍属于可自由定制的下游；只有 CI 或显式角色启用模板边界。
  if (normalizeRepositoryUrl(originUrl) === PERSONAL_REPOSITORY) return "personal";
  return "downstream";
};

/** 判断文件是否属于任何不允许跟踪的目录前缀。 */
const hasForbiddenPrefix = (file, prefixes) =>
  prefixes.some((prefix) => file.startsWith(prefix));

/** 校验仓库的受控边界，同时允许普通模板使用者继续自由定制自己的下游站点。 */
export const validateRepositoryBoundary = ({ role, trackedFiles, packageJson }) => {
  const errors = [];
  const tracked = new Set(trackedFiles);
  for (const file of trackedFiles) {
    const isPrivateEnvironment = /^\.env(?:\.|$)/.test(file) && file !== ".env.example";
    if (
      isPrivateEnvironment ||
      COMMON_FORBIDDEN_FILES.has(file) ||
      hasForbiddenPrefix(file, COMMON_FORBIDDEN_PREFIXES)
    ) {
      errors.push(`不应被 Git 跟踪：${file}`);
    }
  }

  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  if (role === "template") {
    for (const file of trackedFiles) {
      if (
        TEMPLATE_FORBIDDEN_FILES.has(file) ||
        hasForbiddenPrefix(file, TEMPLATE_FORBIDDEN_PREFIXES)
      ) {
        errors.push(`PageComet 模板包含个人站文件：${file}`);
      }
    }
    for (const dependency of ["three", "@types/three"]) {
      if (dependency in allDependencies) {
        errors.push(`PageComet 模板不应依赖个人 3D 运行库：${dependency}`);
      }
    }
  }

  if (role === "personal") {
    for (const file of PERSONAL_REQUIRED_FILES) {
      if (!tracked.has(file)) errors.push(`wenren-site 缺少个人站文件：${file}`);
    }
    const glbAssets = trackedFiles.filter(
      (file) => file.startsWith("public/3d/") && file.endsWith(".glb"),
    );
    const posterAssets = trackedFiles.filter(
      (file) =>
        file.startsWith("public/3d/") &&
        /\.(?:avif|jpe?g|png|webp)$/i.test(file),
    );
    if (glbAssets.length === 0) errors.push("wenren-site 缺少公开 GLB 模型");
    if (posterAssets.length < 2) errors.push("wenren-site 缺少桌面或移动端模型海报");
    if (!("three" in allDependencies)) errors.push("wenren-site 缺少 three 运行依赖");
  }

  return errors;
};

/** 读取 origin；源码压缩包或尚未配置远端时按普通下游项目处理。 */
const readOriginUrl = () => {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

/** 从 Git 索引读取真实提交边界；源码压缩包没有索引时返回 null。 */
const readTrackedFiles = () => {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
};

/** 汇总仓库角色与文件边界，供命令行和测试复用。 */
export const checkRepositoryBoundary = async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const role = resolveRepositoryRole({
    explicitRole: process.env.REPOSITORY_ROLE,
    githubRepository: process.env.GITHUB_REPOSITORY,
    originUrl: readOriginUrl(),
  });
  const trackedFiles = readTrackedFiles();
  if (trackedFiles === null) {
    const errors =
      role === "downstream"
        ? []
        : ["无法读取 Git 索引，不能验证受控仓库的提交边界"];
    return { role, errors, skipped: role === "downstream" };
  }
  const errors = validateRepositoryBoundary({
    role,
    trackedFiles,
    packageJson,
  });
  return { role, errors, skipped: false };
};

const isDirectExecution = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectExecution) {
  const { role, errors, skipped } = await checkRepositoryBoundary();
  if (errors.length > 0) {
    console.error(`仓库边界检查失败（角色：${role}）：\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
  } else if (skipped) {
    console.log(`仓库边界检查跳过（角色：${role}；当前目录没有 Git 索引）。`);
  } else {
    console.log(`仓库边界检查通过（角色：${role}）。`);
  }
}

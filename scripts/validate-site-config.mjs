import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot } from "./deploy/process.mjs";

/** 正式开发和构建必须显式提供本机配置，避免误用 Alice 示例身份。 */
export const validateLocalSiteConfig = async () => {
  const configPath = path.join(projectRoot, "site.config.mjs");
  try {
    await access(configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new Error(
      "缺少 site.config.mjs：请先复制 site.config.example.mjs，并填写自己的公开站点信息",
    );
  }

  const localModule = await import(pathToFileURL(configPath).href);
  if (!localModule.siteConfig) throw new Error("site.config.mjs 必须导出 siteConfig");
  console.log(`已验证本机站点配置：${localModule.siteConfig.origin}`);
};

try {
  await validateLocalSiteConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

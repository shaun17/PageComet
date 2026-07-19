import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { siteConfig as exampleSiteConfig } from "../../site.config.example.mjs";

/** @typedef {import("./site-config-types").SiteConfig} SiteConfig */

const localConfigUrl = new URL("../../site.config.mjs", import.meta.url);

/** 判断当前命令是否明确要求使用可提交的示例配置。 */
const fixtureUsesExampleConfig = () => process.env.SITE_CONFIG_MODE === "example";

/** 只把文件不存在视为未配置，权限或文件系统错误必须继续向上抛出。 */
const localConfigExists = async () => {
  try {
    await access(fileURLToPath(localConfigUrl));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

/**
 * 优先读取被 Git 忽略的个人配置；克隆预览和 CI 则使用虚构示例。
 * @returns {Promise<{ config: SiteConfig; source: "example" | "local" }>}
 */
const loadSiteConfig = async () => {
  if (fixtureUsesExampleConfig() || !(await localConfigExists())) {
    return { config: exampleSiteConfig, source: "example" };
  }

  const localModule = await import(/* @vite-ignore */ localConfigUrl.href);
  if (!localModule.siteConfig) {
    throw new Error("site.config.mjs 必须导出 siteConfig");
  }
  return { config: localModule.siteConfig, source: "local" };
};

const loadedSiteConfig = await loadSiteConfig();

export const siteConfig = loadedSiteConfig.config;
export const siteConfigSource = loadedSiteConfig.source;

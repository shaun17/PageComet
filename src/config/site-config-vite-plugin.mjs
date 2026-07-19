/** @typedef {import("./site-config-types").SiteConfig} SiteConfig */

const VIRTUAL_SITE_CONFIG_ID = "virtual:site-config";
const RESOLVED_VIRTUAL_SITE_CONFIG_ID = `\0${VIRTUAL_SITE_CONFIG_ID}`;

/**
 * 把启动阶段选定的配置注入 Vite 模块图，保证页面和测试共享同一对象。
 * @param {SiteConfig} siteConfig
 * @returns {import("vite").Plugin}
 */
export const createSiteConfigPlugin = (siteConfig) => ({
  name: "site-config",
  resolveId: (id) =>
    id === VIRTUAL_SITE_CONFIG_ID ? RESOLVED_VIRTUAL_SITE_CONFIG_ID : null,
  load: (id) =>
    id === RESOLVED_VIRTUAL_SITE_CONFIG_ID
      ? `export const siteConfig = Object.freeze(${JSON.stringify(siteConfig)});`
      : null,
});

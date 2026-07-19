import { createServer } from "vite";
import { siteConfig } from "../src/config/site-config.mjs";
import { createSiteConfigPlugin } from "../src/config/site-config-vite-plugin.mjs";

/** 创建带站点配置模块的统一 Vite 测试服务器。 */
export const createTestViteServer = (projectRoot) =>
  createServer({
    root: projectRoot,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
    plugins: [createSiteConfigPlugin(siteConfig)],
  });

import { defineConfig } from "astro/config";
import { siteConfig } from "./src/config/site-config.mjs";
import { createSiteConfigPlugin } from "./src/config/site-config-vite-plugin.mjs";

// 正式部署会把 Vite 的 .env 搜索目录指向一次性空目录，确保各阶段只使用显式白名单变量。
const isolatedEnvironmentDirectory = process.env.ASTRO_ENV_DIR?.trim();
const siteConfigPlugin = createSiteConfigPlugin(siteConfig);

// 只生成可直接交给 Cloudflare Pages 的静态文件，不引入运行时服务器。
export default defineConfig({
  site: siteConfig.origin,
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  // CSP 只允许同源代码执行，因此将体积较小的浏览器脚本也输出为独立文件。
  vite: {
    ...(isolatedEnvironmentDirectory
      ? { envDir: isolatedEnvironmentDirectory }
      : {}),
    plugins: [siteConfigPlugin],
    build: {
      assetsInlineLimit: 0,
    },
  },
});

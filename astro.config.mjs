import { defineConfig } from "astro/config";

// 只生成可直接交给 Cloudflare Pages 的静态文件，不引入运行时服务器。
export default defineConfig({
  site: "https://wenren.cc",
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  // CSP 只允许同源代码执行，因此将体积较小的浏览器脚本也输出为独立文件。
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});

import { defineConfig } from "astro/config";

// 只生成可直接交给 Cloudflare Pages 的静态文件，不引入运行时服务器。
export default defineConfig({
  site: "https://wenren.cc",
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
});

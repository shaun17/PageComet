import type { APIRoute } from "astro";
import { siteConfig } from "../config/runtime-site-config";

/** 构建时按当前站点域名生成抓取规则，模板和正式站不会互相泄漏地址。 */
export const GET: APIRoute = () => {
  const sitemapUrl = new URL("/sitemap.xml", siteConfig.origin).href;
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${sitemapUrl}`, ""].join(
    "\n",
  );

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

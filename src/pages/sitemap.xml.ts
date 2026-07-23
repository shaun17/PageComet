import type { APIRoute } from "astro";
import { siteConfig } from "../config/runtime-site-config";
import { ORDERED_CATEGORIES } from "../content/categories";
import { getJournalEntries, getSiteContent } from "../content/site-content";

interface SitemapRecord {
  loc: string;
  lastmod: string | null;
}

interface UpdatedContent {
  updatedAt: string;
}

/** 转义 XML 文本节点，避免标题或地址中的特殊字符破坏 Sitemap。 */
const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** 统一生成带尾斜杠的规范地址，文件型 sitemap.xml 本身除外。 */
const createCanonicalUrl = (path: string): string => {
  const normalizedPath = path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`;
  return new URL(normalizedPath, siteConfig.origin).href;
};

/** ISO 日期可以按字典序比较，取最新值作为聚合页面的更新时间。 */
const getLatestUpdatedAt = (entries: readonly UpdatedContent[]): string | null =>
  entries.reduce<string | null>(
    (latest, entry) => (!latest || entry.updatedAt > latest ? entry.updatedAt : latest),
    null,
  );

/** 把单条规范地址渲染成 Sitemap URL 节点。 */
const renderSitemapRecord = ({ loc, lastmod }: SitemapRecord): string => {
  const lastmodElement = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url><loc>${escapeXml(loc)}</loc>${lastmodElement}</url>`;
};

/** 构建时读取已发布内容，只向搜索引擎公开真实存在的静态地址。 */
export const GET: APIRoute = async () => {
  const [articles, journals] = await Promise.all([
    getSiteContent(),
    getJournalEntries(),
  ]);
  const allContent = [...articles, ...journals];
  const records: SitemapRecord[] = [
    {
      loc: createCanonicalUrl("/"),
      lastmod: getLatestUpdatedAt(allContent),
    },
    ...ORDERED_CATEGORIES.map((category) => {
      const categoryContent =
        category.key === "journal"
          ? journals
          : articles.filter((entry) => entry.category === category.key);
      return {
        loc: createCanonicalUrl(category.path),
        lastmod: getLatestUpdatedAt(categoryContent),
      };
    }),
    ...articles.map((entry) => ({
      loc: createCanonicalUrl(entry.route),
      lastmod: entry.updatedAt,
    })),
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...records.map(renderSitemapRecord),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};

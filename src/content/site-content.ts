import { siteConfig } from "../config/runtime-site-config";
import type { ContentCategory, ContentEntry } from "../lib/notion";
import { loadPublishedContent } from "../lib/notion";
import { validateSiteContent } from "./content-validation";
import { rewriteInternalLinks } from "./internal-links";
import { enrichContentLinkPreviews } from "./link-preview";
import { createCachedLinkPreviewResolver } from "./link-preview-resolver";
import { TEST_CONTENT } from "./test-content";

/** 为正式内容补充网页标题和摘要；失败只记录域名并保留原始 mention。 */
const addExternalLinkPreviews = async (
  entries: ContentEntry[],
): Promise<ContentEntry[]> => {
  const resolver = createCachedLinkPreviewResolver();
  const failedHosts = new Set<string>();
  try {
    const enriched = await enrichContentLinkPreviews(entries, resolver.resolve, {
      concurrency: 4,
      onFailure: (url) => failedHosts.add(new URL(url).hostname),
    });
    if (failedHosts.size > 0) {
      console.warn(`以下站点未能生成链接摘要：${[...failedHosts].join("、")}`);
    }
    return enriched;
  } finally {
    await resolver.close();
  }
};

/** 正式构建读取 Notion；测试构建使用固定夹具，不会访问用户账户。 */
const loadSiteContent = async (): Promise<ContentEntry[]> => {
  const source = import.meta.env.CONTENT_SOURCE ?? "notion";
  if (source === "fixture") return validateSiteContent(rewriteInternalLinks(TEST_CONTENT));
  if (source !== "notion") throw new Error(`未知的 CONTENT_SOURCE：${source}`);

  const token = import.meta.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error("缺少 NOTION_TOKEN：请在本机 .env 中配置网站专用的 Notion 只读密钥");
  }
  const dataSourceId = import.meta.env.NOTION_DATA_SOURCE_ID?.trim();
  if (!dataSourceId) {
    throw new Error("缺少 NOTION_DATA_SOURCE_ID：请在本机 .env 中填写自己的 Notion 数据源 ID");
  }

  const entries = validateSiteContent(
    rewriteInternalLinks(await loadPublishedContent({
      token,
      dataSourceId,
      media: { localizeExternalImages: true },
    })),
  );
  return siteConfig.features.linkPreviews ? addExternalLinkPreviews(entries) : entries;
};

let contentCache: Promise<ContentEntry[]> | null = null;

/** 同一次 Astro 构建只读取一次 Notion，所有静态页面共享同一份内容。 */
export const getSiteContent = (): Promise<ContentEntry[]> => {
  contentCache ??= loadSiteContent();
  return contentCache;
};

/** 按分类获取稳定排序后的文章。 */
export const getCategoryEntries = async (
  category: ContentCategory,
): Promise<ContentEntry[]> => (await getSiteContent()).filter((entry) => entry.category === category);

/** 所有数据库条目统一进入站内静态详情页，外部链接只作为内容元数据保留。 */
export const getEntryHref = (entry: ContentEntry): string =>
  `${entry.route}/`;

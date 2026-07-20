import { siteConfig } from "../config/runtime-site-config";
import type {
  ContentCategory,
  ContentEntry,
  JournalEntry,
  RenderableContentEntry,
} from "../lib/notion";
import { loadJournalContent, loadPublishedContent } from "../lib/notion";
import { validateSiteContent } from "./content-validation";
import { rewriteInternalLinks } from "./internal-links";
import { enrichContentLinkPreviews } from "./link-preview";
import { createCachedLinkPreviewResolver } from "./link-preview-resolver";
import { TEST_ARTICLES, TEST_JOURNAL_ENTRIES } from "./test-content";

export { getEntryHref } from "./entry-href";

/** 为正式内容补充网页标题和摘要；失败只记录域名并保留原始 mention。 */
const addExternalLinkPreviews = async <T extends RenderableContentEntry>(
  entries: T[],
): Promise<T[]> => {
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

interface SiteContentBundle {
  articles: ContentEntry[];
  journals: JournalEntry[];
}

/** 合并两类条目完成跨数据源内链改写，再按原顺序拆回独立模型。 */
const prepareSiteContent = async (
  articles: ContentEntry[],
  journals: JournalEntry[],
): Promise<SiteContentBundle> => {
  const misplacedJournal = articles.find((entry) => entry.category === "journal");
  if (misplacedJournal) {
    throw new Error(
      `文章数据库仍包含已发布流水账「${misplacedJournal.title}」；请迁移到独立流水账数据库`,
    );
  }

  const articleCount = articles.length;
  const combined = validateSiteContent(
    rewriteInternalLinks<ContentEntry | JournalEntry>([...articles, ...journals]),
  );
  const enriched = siteConfig.features.linkPreviews
    ? await addExternalLinkPreviews(combined)
    : combined;
  return {
    articles: enriched.slice(0, articleCount) as ContentEntry[],
    journals: enriched.slice(articleCount) as JournalEntry[],
  };
};

/** 正式构建并行读取两个 Notion 数据源；测试构建使用固定夹具。 */
const loadSiteContentBundle = async (): Promise<SiteContentBundle> => {
  const source = import.meta.env.CONTENT_SOURCE ?? "notion";
  if (source === "fixture") {
    return prepareSiteContent(TEST_ARTICLES, TEST_JOURNAL_ENTRIES);
  }
  if (source !== "notion") throw new Error(`未知的 CONTENT_SOURCE：${source}`);

  const token = import.meta.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error("缺少 NOTION_TOKEN：请在本机 .env 中配置网站专用的 Notion 只读密钥");
  }
  const dataSourceId = import.meta.env.NOTION_DATA_SOURCE_ID?.trim();
  if (!dataSourceId) {
    throw new Error("缺少 NOTION_DATA_SOURCE_ID：请在本机 .env 中填写自己的 Notion 数据源 ID");
  }
  const journalDataSourceId = import.meta.env.NOTION_JOURNAL_DATA_SOURCE_ID?.trim();
  if (!journalDataSourceId) {
    throw new Error(
      "缺少 NOTION_JOURNAL_DATA_SOURCE_ID：请填写独立流水账数据库的数据源 ID",
    );
  }

  const [articles, journals] = await Promise.all([
    loadPublishedContent({
      token,
      dataSourceId,
      media: { localizeExternalImages: true },
    }),
    loadJournalContent({
      token,
      dataSourceId: journalDataSourceId,
      media: { localizeExternalImages: true },
      timeZone: siteConfig.timeZone,
    }),
  ]);
  return prepareSiteContent(articles, journals);
};

let contentCache: Promise<SiteContentBundle> | null = null;

/** 同一次 Astro 构建只读取一次两类 Notion 内容，所有静态页面共享结果。 */
const getSiteContentBundle = (): Promise<SiteContentBundle> => {
  contentCache ??= loadSiteContentBundle();
  return contentCache;
};

/** 文章页面继续只消费文章数据库，避免流水账字段进入目录组件。 */
export const getSiteContent = async (): Promise<ContentEntry[]> =>
  (await getSiteContentBundle()).articles;

/** 按分类获取稳定排序后的文章。 */
export const getCategoryEntries = async (
  category: ContentCategory,
): Promise<ContentEntry[]> => (await getSiteContent()).filter((entry) => entry.category === category);

/** 流水账严格按发布时间倒序展示，不受文章目录的人工排序影响。 */
export const getJournalEntries = async (): Promise<JournalEntry[]> =>
  (await getSiteContentBundle()).journals;

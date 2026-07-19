import type { ContentBlock, ContentCategory, ContentEntry } from "../lib/notion";
import { loadPublishedContent } from "../lib/notion";
import { enrichContentLinkPreviews } from "./link-preview";
import { createCachedLinkPreviewResolver } from "./link-preview-resolver";
import { TEST_CONTENT } from "./test-content";

const WEBSITE_CONTENT_DATA_SOURCE_ID = "edd7fd6c-d863-4b1a-96c2-8ae3804d5433";
const LEGACY_NOTION_PAGE_ALIASES = new Map<string, string>([
  ["3a1f211130e4800d8a5bc3fb3ffeaaf2", "3a1f211130e481f6b2aec459c7e41857"],
  ["3a1f211130e480608e16f7a50c77c42b", "3a1f211130e481a688ccec93825080f9"],
  ["3a1f211130e48038a132d55dbbfcc6e3", "3a1f211130e481ecb370d708b2b1a657"],
  ["1c0f211130e480218e58e66af61f09e2", "3a1f211130e4815195c6c61a72db49b2"],
  ["2c8f211130e480918bdfec198e501273", "3a1f211130e481988573e031629a61d8"],
  ["1aff211130e4808d9511f5cddb8d8a30", "3a1f211130e481a3a408cf59ba211572"],
  ["133f211130e4808d9df7ecb870a4ca84", "3a1f211130e481cb9ecbe77c6416c7df"],
  ["3a1f211130e480b0b3e1c8c30b902517", "3a1f211130e481118eb2f1660f52d6e8"],
]);
const RENDERABLE_BLOCKS = new Set<ContentBlock["type"]>([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
  "image",
  "video",
  "embed",
  "bookmark",
  "link_preview",
  "equation",
  "divider",
  "table",
  "table_row",
  "column_list",
  "column",
  "synced_block",
]);

/** 书签只允许站内相对路径或普通网页地址，避免内容块注入未知协议。 */
const isSafeBookmarkUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** 媒体只允许站内绝对路径或 HTTPS，避免混合内容和未知协议进入播放器。 */
const isSafeMediaUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** 从 Notion 页面地址中提取 UUID，兼容有无连字符的 URL。 */
const readNotionPageId = (value: string | null): string | null => {
  if (!value) return null;
  const matches = value.match(
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?=$|[/?#])/gi,
  );
  return matches?.at(-1)?.replaceAll("-", "").toLowerCase() ?? null;
};

/** 将数据库内页面之间的 Notion 链接改写为站内静态地址。 */
const rewriteInternalLinks = (entries: ContentEntry[]): ContentEntry[] => {
  const routesByPageId = new Map(
    entries.map((entry) => [
      entry.id.replaceAll("-", "").toLowerCase(),
      `${entry.route}/`,
    ]),
  );

  // 迁移后的正文可能仍引用旧公开页 ID；为这些 ID 建别名，统一改写到新静态路由。
  for (const [legacyPageId, currentPageId] of LEGACY_NOTION_PAGE_ALIASES) {
    const route = routesByPageId.get(currentPageId);
    if (route) routesByPageId.set(legacyPageId, route);
  }

  /** 将任意 Notion 页面地址解析为对应站内路由；普通网页地址保持不变。 */
  const resolveInternalRoute = (value: string | null | undefined): string | undefined => {
    const pageId = readNotionPageId(value ?? null);
    return pageId ? routesByPageId.get(pageId) : undefined;
  };

  /** 递归复制块树，避免修改内容管线缓存的原始对象。 */
  const rewriteBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
    blocks.map((item) => ({
      ...item,
      richText: item.richText.map((span) => ({
        ...span,
        href: resolveInternalRoute(span.href) ?? span.href,
      })),
      caption: item.caption?.map((span) => ({
        ...span,
        href: resolveInternalRoute(span.href) ?? span.href,
      })),
      cells: item.cells?.map((cell) =>
        cell.map((span) => ({
          ...span,
          href: resolveInternalRoute(span.href) ?? span.href,
        })),
      ),
      url: resolveInternalRoute(item.url) ?? item.url,
      children: rewriteBlocks(item.children),
    }));

  return entries.map((entry) => ({ ...entry, blocks: rewriteBlocks(entry.blocks) }));
};

/** 在构建前拦截无法安全呈现的块，防止已发布正文被静默丢失。 */
const assertRenderableBlocks = (blocks: ContentBlock[], articleTitle: string): void => {
  for (const item of blocks) {
    if (!RENDERABLE_BLOCKS.has(item.type)) {
      const sourceType = item.unsupportedType ?? item.type;
      throw new Error(`文章「${articleTitle}」包含暂不支持的 Notion 块：${sourceType}`);
    }
    if (["bookmark", "link_preview"].includes(item.type) && !isSafeBookmarkUrl(item.url)) {
      throw new Error(`文章「${articleTitle}」包含无效的 Notion 书签地址`);
    }
    if (item.type === "video" && !isSafeMediaUrl(item.video?.url)) {
      throw new Error(`文章「${articleTitle}」包含无效的 Notion 视频地址`);
    }
    if (item.type === "embed" && !isSafeMediaUrl(item.url)) {
      throw new Error(`文章「${articleTitle}」包含无效的 Notion 嵌入地址`);
    }
    assertRenderableBlocks(item.children, articleTitle);
  }
};

/** 校验正式内容和测试夹具都满足页面层的静态输出要求。 */
const validateSiteContent = (entries: ContentEntry[]): ContentEntry[] => {
  for (const entry of entries) {
    assertRenderableBlocks(entry.blocks, entry.title);
  }
  return entries;
};

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
  const dataSourceId =
    import.meta.env.NOTION_DATA_SOURCE_ID?.trim() || WEBSITE_CONTENT_DATA_SOURCE_ID;

  const entries = validateSiteContent(
    rewriteInternalLinks(await loadPublishedContent({
      token,
      dataSourceId,
      media: { localizeExternalImages: true },
    })),
  );
  return addExternalLinkPreviews(entries);
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

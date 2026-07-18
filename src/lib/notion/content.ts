import { localizeContentEntryMedia } from "./assets";
import { readNotionBlockTree } from "./blocks";
import { NotionClient } from "./client";
import {
  createPublishedContentQuery,
  normalizeContentPage,
  resolvePropertyNames,
  validateContentSchema,
} from "./schema";
import type {
  ContentBlock,
  ContentEntry,
  ContentPropertyNames,
  MediaLocalizationOptions,
} from "./types";

export interface LoadPublishedContentOptions {
  token?: string;
  dataSourceId?: string;
  client?: NotionClient;
  properties?: Partial<ContentPropertyNames>;
  media?: false | MediaLocalizationOptions;
  maxBlockDepth?: number;
}

/** 创建内容客户端；显式参数优先，缺失时读取构建环境变量。 */
const resolveClient = (options: LoadPublishedContentOptions): NotionClient => {
  if (options.client) return options.client;
  return new NotionClient({
    token: options.token ?? process.env.NOTION_TOKEN ?? "",
    dataSourceId: options.dataSourceId ?? process.env.NOTION_DATA_SOURCE_ID ?? "",
  });
};

/** 判断块树是否包含真实可展示内容，用于拦截误发布的空白内部文章。 */
const hasMeaningfulContent = (blocks: ContentBlock[]): boolean =>
  blocks.some((block) => {
    const hasText = block.richText.some((item) => item.plainText.trim().length > 0);
    const hasCells = block.cells?.some((cell) =>
      cell.some((item) => item.plainText.trim().length > 0),
    );
    return Boolean(
      hasText ||
        hasCells ||
        block.image ||
        block.video ||
        block.url ||
        block.expression ||
        block.title ||
        hasMeaningfulContent(block.children),
    );
  });

/** 所有已发布条目都会生成站内详情页，因此必须包含实际正文。 */
const validateEntryBody = (entry: ContentEntry): void => {
  if (hasMeaningfulContent(entry.blocks)) return;
  throw new Error(`文章「${entry.title}」没有正文，无法发布`);
};

/** 强制 Slug 全站唯一，避免分类调整后产生地址冲突或旧链接歧义。 */
const assertUniqueSlugs = (entries: ContentEntry[]): void => {
  const slugs = new Set<string>();
  for (const entry of entries) {
    if (slugs.has(entry.slug)) throw new Error(`检测到重复 Slug：${entry.slug}`);
    slugs.add(entry.slug);
  }
};

/** 按置顶、人工顺序和有效日期稳定排序；发布日期为空时使用最后编辑时间。 */
const sortContentEntries = (entries: ContentEntry[]): ContentEntry[] =>
  entries.sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    if (left.order !== right.order) return left.order - right.order;
    const leftTime = Date.parse(left.publishedAt ?? left.updatedAt);
    const rightTime = Date.parse(right.publishedAt ?? right.updatedAt);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.id.localeCompare(right.id);
  });

/**
 * 构建时读取全部已发布内容、递归展开正文，并将 Notion 临时媒体本地化。
 * 该函数不会在浏览器运行，调用方应仅在 Astro 构建阶段使用。
 */
export const loadPublishedContent = async (
  options: LoadPublishedContentOptions = {},
): Promise<ContentEntry[]> => {
  const client = resolveClient(options);
  const names = resolvePropertyNames(options.properties);
  const dataSource = await client.retrieveDataSource();
  validateContentSchema(dataSource, names);
  const pages = await client.queryDataSource(createPublishedContentQuery(names));
  const entries: ContentEntry[] = [];

  for (const page of pages) {
    const blocks = await readNotionBlockTree(client, page.id, {
      maxDepth: options.maxBlockDepth,
    });
    const entry = normalizeContentPage(page, blocks, names);
    validateEntryBody(entry);
    entries.push(
      options.media === false
        ? entry
        : await localizeContentEntryMedia(entry, options.media),
    );
  }

  assertUniqueSlugs(entries);
  return sortContentEntries(entries);
};

let cachedPublishedContent: Promise<ContentEntry[]> | null = null;

/** 在同一次 Astro 构建中共享查询结果，避免首页与文章路由重复请求 Notion。 */
export const getPublishedContent = (): Promise<ContentEntry[]> => {
  cachedPublishedContent ??= loadPublishedContent();
  return cachedPublishedContent;
};

/** 仅供测试或显式的长驻构建进程清理模块级缓存。 */
export const clearPublishedContentCache = (): void => {
  cachedPublishedContent = null;
};

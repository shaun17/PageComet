import type {
  ContentBlock,
  ContentEntry,
  ContentLinkPreview,
  ContentRichText,
} from "../lib/notion";
import { isSiteHostname } from "../config/site-origin";

export type LinkPreviewResolver = (
  url: string,
) => Promise<ContentLinkPreview | null>;

export interface LinkPreviewEnrichmentOptions {
  concurrency?: number;
  onFailure?: (url: string, error: unknown) => void;
}

/** 将可预览的公网 URL 规范化为去重键，并排除站内、邮件与相对地址。 */
const normalizePreviewUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (isSiteHostname(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

/** 收集一组富文本里的外链，并由 Set 完成跨文章去重。 */
const collectRichTextUrls = (items: ContentRichText[], urls: Set<string>): void => {
  for (const item of items) {
    const url = normalizePreviewUrl(item.href);
    if (url) urls.add(url);
  }
};

/** 递归收集正文链接和书签；媒体 URL 保持原有专用呈现，不生成通用摘要。 */
const collectBlockUrls = (blocks: ContentBlock[], urls: Set<string>): void => {
  for (const block of blocks) {
    collectRichTextUrls(block.richText, urls);
    if (block.caption) collectRichTextUrls(block.caption, urls);
    for (const cell of block.cells ?? []) collectRichTextUrls(cell, urls);
    if (["bookmark", "link_preview"].includes(block.type)) {
      const url = normalizePreviewUrl(block.url);
      if (url) urls.add(url);
    }
    collectBlockUrls(block.children, urls);
  }
};

/** 给富文本不可变地附加已经解析好的预览数据。 */
const enrichRichText = (
  items: ContentRichText[],
  previews: Map<string, ContentLinkPreview | null>,
): ContentRichText[] =>
  items.map((item) => {
    const url = normalizePreviewUrl(item.href);
    const linkPreview = url ? previews.get(url) : null;
    return linkPreview ? { ...item, linkPreview } : item;
  });

/** 递归把同一份 URL 预览回填到段落、表格和书签块。 */
const enrichBlocks = (
  blocks: ContentBlock[],
  previews: Map<string, ContentLinkPreview | null>,
): ContentBlock[] =>
  blocks.map((block) => {
    const url =
      ["bookmark", "link_preview"].includes(block.type)
        ? normalizePreviewUrl(block.url)
        : null;
    const linkPreview = url ? previews.get(url) : null;
    return {
      ...block,
      richText: enrichRichText(block.richText, previews),
      caption: block.caption ? enrichRichText(block.caption, previews) : undefined,
      cells: block.cells?.map((cell) => enrichRichText(cell, previews)),
      children: enrichBlocks(block.children, previews),
      ...(linkPreview ? { linkPreview } : {}),
    };
  });

/** 以小批次执行远程解析，避免文章增多后无界并发压垮构建和目标站点。 */
const resolvePreviews = async (
  urls: string[],
  resolvePreview: LinkPreviewResolver,
  options: LinkPreviewEnrichmentOptions,
): Promise<Map<string, ContentLinkPreview | null>> => {
  const previews = new Map<string, ContentLinkPreview | null>();
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  for (let index = 0; index < urls.length; index += concurrency) {
    const batch = urls.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          return await resolvePreview(url);
        } catch (error) {
          options.onFailure?.(url, error);
          return null;
        }
      }),
    );
    batch.forEach((url, resultIndex) => previews.set(url, results[resultIndex] ?? null));
  }
  return previews;
};

/** 全站一次性解析外链摘要；任一链接失败只降级该链接，不中断静态构建。 */
export const enrichContentLinkPreviews = async (
  entries: ContentEntry[],
  resolvePreview: LinkPreviewResolver,
  options: LinkPreviewEnrichmentOptions = {},
): Promise<ContentEntry[]> => {
  const urls = new Set<string>();
  for (const entry of entries) collectBlockUrls(entry.blocks, urls);
  if (urls.size === 0) return entries;

  const previews = await resolvePreviews([...urls], resolvePreview, options);
  return entries.map((entry) => ({
    ...entry,
    blocks: enrichBlocks(entry.blocks, previews),
  }));
};

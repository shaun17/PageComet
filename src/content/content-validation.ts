import type { ContentBlock, ContentEntry } from "../lib/notion";

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
  "audio",
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
    if (item.type === "audio" && !isSafeMediaUrl(item.audio?.url)) {
      throw new Error(`文章「${articleTitle}」包含无效的 Notion 音频地址`);
    }
    if (item.type === "embed" && !isSafeMediaUrl(item.url)) {
      throw new Error(`文章「${articleTitle}」包含无效的 Notion 嵌入地址`);
    }
    assertRenderableBlocks(item.children, articleTitle);
  }
};

/** 校验正式内容和测试夹具都满足页面层的静态输出要求。 */
export const validateSiteContent = (entries: ContentEntry[]): ContentEntry[] => {
  for (const entry of entries) assertRenderableBlocks(entry.blocks, entry.title);
  return entries;
};

import type { NotionBlockResponse } from "./api-types";
import type { NotionClient } from "./client";
import type { ContentBlock, ContentBlockType, ContentRichText } from "./types";
import {
  asRecord,
  readFileImage,
  readFileMedia,
  readRichText,
  richTextToPlainText,
} from "./values";

const SUPPORTED_TYPES = new Set<ContentBlockType>([
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
  "bookmark",
  "link_preview",
  "embed",
  "video",
  "audio",
  "file",
  "pdf",
  "equation",
  "divider",
  "table",
  "table_row",
  "column_list",
  "column",
  "child_page",
  "child_database",
  "table_of_contents",
  "breadcrumb",
  "synced_block",
]);

/** 收窄 Notion 块类型；新类型先作为 unsupported 保留，页面渲染不会崩溃。 */
const normalizeBlockType = (type: string): ContentBlockType =>
  SUPPORTED_TYPES.has(type as ContentBlockType) ? (type as ContentBlockType) : "unsupported";

/** 从块负载中读取通用 caption。 */
const readCaption = (payload: Record<string, unknown>): ContentRichText[] =>
  readRichText(payload.caption);

/** 从块负载中读取 URL，兼容直接链接和 Notion 文件对象。 */
const readBlockUrl = (payload: Record<string, unknown>): string | undefined => {
  if (typeof payload.url === "string") return payload.url;
  return readFileMedia(payload)?.url;
};

/** 读取 callout 图标，当前仅渲染语义稳定的 emoji。 */
const readCalloutIcon = (payload: Record<string, unknown>): string | undefined => {
  const icon = asRecord(payload.icon);
  return typeof icon?.emoji === "string" ? icon.emoji : undefined;
};

/** 将 table_row 的二维富文本单元格标准化。 */
const readTableCells = (payload: Record<string, unknown>): ContentRichText[][] => {
  if (!Array.isArray(payload.cells)) return [];
  return payload.cells.map((cell) => readRichText(cell));
};

/** 将一个原始 Notion 块转换为页面层可直接消费的统一结构。 */
export const normalizeNotionBlock = (
  raw: NotionBlockResponse,
  children: ContentBlock[],
): ContentBlock => {
  const payload = asRecord(raw[raw.type]) ?? {};
  const type = normalizeBlockType(raw.type);
  const richText = readRichText(payload.rich_text);
  const block: ContentBlock = { id: raw.id, type, richText, children };

  if (typeof payload.color === "string") block.color = payload.color;
  if (type === "to_do") block.checked = payload.checked === true;
  if (type === "callout") block.icon = readCalloutIcon(payload);
  if (type === "code") {
    block.language = typeof payload.language === "string" ? payload.language : "plain text";
    block.caption = readCaption(payload);
  }
  if (type === "image") {
    const caption = readCaption(payload);
    block.caption = caption;
    const image = readFileImage(payload, richTextToPlainText(caption));
    if (image) block.image = image;
  }
  if (type === "video") {
    block.caption = readCaption(payload);
    const video = readFileMedia(payload);
    if (video) block.video = video;
  }
  if (type === "audio") {
    block.caption = readCaption(payload);
    const audio = readFileMedia(payload);
    if (audio) block.audio = audio;
  }
  if (["bookmark", "link_preview", "embed", "file", "pdf"].includes(type)) {
    block.url = readBlockUrl(payload);
    block.caption = readCaption(payload);
  }
  if (type === "equation") {
    block.expression = typeof payload.expression === "string" ? payload.expression : "";
  }
  if (type === "table") {
    block.table = {
      hasColumnHeader: payload.has_column_header === true,
      hasRowHeader: payload.has_row_header === true,
    };
  }
  if (type === "table_row") block.cells = readTableCells(payload);
  if (type === "child_page" || type === "child_database") {
    block.title = typeof payload.title === "string" ? payload.title : "";
  }
  if (type === "unsupported") block.unsupportedType = raw.type;

  return block;
};

export interface ReadBlockTreeOptions {
  maxDepth?: number;
}

/** 递归读取完整块树；共享请求队列负责总速率，独立子树可安全并行。 */
export const readNotionBlockTree = async (
  client: NotionClient,
  parentId: string,
  options: ReadBlockTreeOptions = {},
): Promise<ContentBlock[]> => {
  const maxDepth = options.maxDepth ?? 24;
  const visited = new Set<string>();

  /** 深度优先读取子块，并防止异常数据造成循环或无限递归。 */
  const readChildren = async (blockId: string, depth: number): Promise<ContentBlock[]> => {
    if (depth > maxDepth) throw new Error(`Notion 内容嵌套超过 ${maxDepth} 层：${blockId}`);
    const rawBlocks = await client.listBlockChildren(blockId);
    return Promise.all(
      rawBlocks.map(async (raw) => {
        if (visited.has(raw.id)) throw new Error(`Notion 块出现循环引用：${raw.id}`);
        visited.add(raw.id);
        const children = raw.has_children ? await readChildren(raw.id, depth + 1) : [];
        return normalizeNotionBlock(raw, children);
      }),
    );
  };

  return readChildren(parentId, 0);
};

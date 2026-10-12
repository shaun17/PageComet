import type { ContentBlock } from "../lib/notion";

const DIRECT_ATTACHMENT_TYPES = new Set<ContentBlock["type"]>([
  "image",
  "video",
  "audio",
  "embed",
]);

const ATTACHMENT_CONTAINER_TYPES = new Set<ContentBlock["type"]>([
  "column_list",
  "column",
  "synced_block",
]);

export interface JournalContentParts {
  textBlocks: ContentBlock[];
  attachmentBlocks: ContentBlock[];
}

/**
 * 识别直接媒体和纯媒体分栏；混合文字的容器仍保留在文字区，避免破坏作者原有顺序。
 */
export const isJournalAttachmentBlock = (block: ContentBlock): boolean => {
  if (DIRECT_ATTACHMENT_TYPES.has(block.type)) return true;
  return (
    ATTACHMENT_CONTAINER_TYPES.has(block.type) &&
    block.children.length > 0 &&
    block.children.every(isJournalAttachmentBlock)
  );
};

/** 将一条流水账拆成可折叠文字与始终可见的素材，并保持各自原有顺序。 */
export const partitionJournalContent = (blocks: ContentBlock[]): JournalContentParts => {
  const textBlocks: ContentBlock[] = [];
  const attachmentBlocks: ContentBlock[] = [];

  for (const block of blocks) {
    (isJournalAttachmentBlock(block) ? attachmentBlocks : textBlocks).push(block);
  }

  return { textBlocks, attachmentBlocks };
};

/** 流水账条目在时间流中的锚点 id，首页目录和时间流共用同一规则。 */
export const getJournalAnchorId = (entryId: string): string =>
  `journal-time-${entryId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;

/** 首页目录只需要一句话的提示，按字符截断，避免整段正文进入首页 HTML。 */
const JOURNAL_EXCERPT_LENGTH = 40;

/** 取一条流水账里第一段非空文字作为摘录，跳过图片、视频等素材块。 */
export const getJournalExcerpt = (blocks: ContentBlock[]): string | null => {
  for (const block of blocks) {
    if (isJournalAttachmentBlock(block)) continue;
    const text = block.richText
      .map((item) => item.plainText)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      // 用码点切分，避免把 emoji 等代理对截成乱码。
      const characters = Array.from(text);
      return characters.length > JOURNAL_EXCERPT_LENGTH
        ? `${characters.slice(0, JOURNAL_EXCERPT_LENGTH).join("")}…`
        : text;
    }
    const nested = getJournalExcerpt(block.children);
    if (nested) return nested;
  }
  return null;
};

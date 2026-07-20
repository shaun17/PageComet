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

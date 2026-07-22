import type { NotionPageResponse, NotionPropertyValue } from "./api-types";
import type {
  ContentFileAttachment,
  ContentImage,
  ContentMedia,
  ContentRichText,
} from "./types";

/** 将未知 JSON 值安全收窄为普通对象。 */
export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/** 读取布尔值并提供明确默认值。 */
const readBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

/** 将单个 Notion 富文本对象标准化，屏蔽 mention/equation 的结构差异。 */
const normalizeRichTextItem = (value: unknown): ContentRichText | null => {
  const item = asRecord(value);
  if (!item) return null;

  const type = item.type;
  const normalizedType =
    type === "text" || type === "mention" || type === "equation" ? type : "unknown";
  const text = asRecord(item.text);
  const link = asRecord(text?.link);
  const annotations = asRecord(item.annotations);
  const equation = asRecord(item.equation);
  const fallbackText =
    (typeof text?.content === "string" && text.content) ||
    (typeof equation?.expression === "string" && equation.expression) ||
    "";

  return {
    type: normalizedType,
    plainText: typeof item.plain_text === "string" ? item.plain_text : fallbackText,
    href:
      typeof item.href === "string"
        ? item.href
        : typeof link?.url === "string"
          ? link.url
          : null,
    annotations: {
      bold: readBoolean(annotations?.bold),
      italic: readBoolean(annotations?.italic),
      strikethrough: readBoolean(annotations?.strikethrough),
      underline: readBoolean(annotations?.underline),
      code: readBoolean(annotations?.code),
      color: typeof annotations?.color === "string" ? annotations.color : "default",
    },
  };
};

/** 标准化 Notion 富文本数组，并过滤无效条目。 */
export const readRichText = (value: unknown): ContentRichText[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRichTextItem)
    .filter((item): item is ContentRichText => item !== null);
};

/** 将标准化富文本合并为纯文本，用于标题、摘要和图片说明。 */
export const richTextToPlainText = (richText: ContentRichText[]): string =>
  richText.map((item) => item.plainText).join("");

/** 按名称读取页面属性，字段缺失时给出包含页面 ID 的错误。 */
export const getPageProperty = (
  page: NotionPageResponse,
  propertyName: string,
): NotionPropertyValue => {
  const property = page.properties[propertyName];
  if (!property) {
    throw new Error(`Notion 页面 ${page.id} 缺少字段「${propertyName}」`);
  }
  return property;
};

/** 读取 TITLE 属性。 */
export const readTitleProperty = (property: NotionPropertyValue): string =>
  richTextToPlainText(readRichText(property.title)).trim();

/** 读取 TITLE 属性的完整富文本，流水账可保留行内链接和样式。 */
export const readTitleRichTextProperty = (
  property: NotionPropertyValue,
): ContentRichText[] => readRichText(property.title);

/** 读取 RICH_TEXT 属性。 */
export const readRichTextProperty = (property: NotionPropertyValue): string =>
  richTextToPlainText(readRichText(property.rich_text)).trim();

/** 读取 RICH_TEXT 属性的完整富文本，避免 Form 内容退化为纯文本。 */
export const readRichTextPropertyItems = (
  property: NotionPropertyValue,
): ContentRichText[] => readRichText(property.rich_text);

/** 读取 SELECT 或 STATUS 属性的选项名称。 */
export const readSelectProperty = (property: NotionPropertyValue): string | null => {
  const option = asRecord(property[property.type]);
  return typeof option?.name === "string" ? option.name : null;
};

/** 读取 DATE 属性的开始时间。 */
export const readDateProperty = (property: NotionPropertyValue): string | null => {
  const date = asRecord(property.date);
  return typeof date?.start === "string" ? date.start : null;
};

/** 读取 NUMBER 属性，并过滤 NaN 和无穷值。 */
export const readNumberProperty = (property: NotionPropertyValue): number | null => {
  const value = property.number;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** 读取 CHECKBOX 属性。 */
export const readCheckboxProperty = (property: NotionPropertyValue): boolean =>
  readBoolean(property.checkbox);

/** 读取 URL 属性，空值保持为 null。 */
export const readUrlProperty = (property: NotionPropertyValue): string | null =>
  typeof property.url === "string" && property.url.trim() ? property.url.trim() : null;

/** 读取 MULTI_SELECT 属性的标签名称。 */
export const readMultiSelectProperty = (property: NotionPropertyValue): string[] => {
  if (!Array.isArray(property.multi_select)) return [];
  return property.multi_select.flatMap((value) => {
    const option = asRecord(value);
    return typeof option?.name === "string" ? [option.name] : [];
  });
};

/** 从 Notion 文件对象解析可访问 URL；已挂载的 file_upload 会由 API 作为 file 返回。 */
export const readFileMedia = (
  value: unknown,
  cacheKey?: string,
): ContentMedia | null => {
  const file = asRecord(value);
  if (!file || typeof file.type !== "string") return null;

  if (file.type === "file") {
    const source = asRecord(file.file);
    if (typeof source?.url !== "string") return null;
    return {
      url: source.url,
      source: "notion",
      expiryTime: typeof source.expiry_time === "string" ? source.expiry_time : null,
      localized: false,
      ...(cacheKey ? { cacheKey } : {}),
    };
  }

  if (file.type === "external") {
    const source = asRecord(file.external);
    if (typeof source?.url !== "string") return null;
    return {
      url: source.url,
      source: "external",
      expiryTime: null,
      localized: false,
    };
  }

  return null;
};

/** 图片复用通用媒体解析，并补充页面渲染所需的替代文本。 */
export const readFileImage = (
  value: unknown,
  alt: string,
  cacheKey?: string,
): ContentImage | null => {
  const media = readFileMedia(value, cacheKey);
  return media ? { ...media, alt } : null;
};

/** 读取 FILES 属性中的第一张封面图。 */
export const readFilesProperty = (
  property: NotionPropertyValue,
  alt: string,
  cacheKey?: string,
): ContentImage | null => {
  if (!Array.isArray(property.files)) return null;
  const first = property.files[0];
  return first ? readFileImage(first, alt, cacheKey) : null;
};

/** 读取 FILES 属性中的全部附件；任何损坏项都明确失败，避免发布时静默丢素材。 */
export const readFileAttachmentsProperty = (
  property: NotionPropertyValue,
  createCacheKey?: (index: number) => string,
): ContentFileAttachment[] => {
  if (!Array.isArray(property.files)) return [];
  return property.files.map((value, index) => {
    const file = asRecord(value);
    const media = readFileMedia(value, createCacheKey?.(index));
    if (!file || !media) {
      throw new Error(`Notion 文件属性中的第 ${index + 1} 个附件无法读取`);
    }
    const name = typeof file.name === "string" ? file.name.trim() : "";
    if (!name) throw new Error(`Notion 文件属性中的第 ${index + 1} 个附件缺少文件名`);
    return { name, media };
  });
};

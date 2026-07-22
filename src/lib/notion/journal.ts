import { readJournalCalendarDate } from "../journal-time";
import type { NotionDataSourceResponse, NotionPageResponse } from "./api-types";
import { localizeContentEntriesMedia } from "./assets";
import { NotionClient } from "./client";
import { MEDIA_FORMAT_EXTENSIONS } from "./media-format-extensions.mjs";
import type {
  ContentBlock,
  ContentFileAttachment,
  ContentRichText,
  JournalEntry,
  JournalPropertyNames,
  MediaLocalizationOptions,
} from "./types";
import {
  getPageProperty,
  readCheckboxProperty,
  readDateProperty,
  readFileAttachmentsProperty,
  readRichTextPropertyItems,
  readTitleRichTextProperty,
  readUrlProperty,
  richTextToPlainText,
} from "./values";

/** 与独立“流水账”数据库保持一致的默认字段名。 */
export const DEFAULT_JOURNAL_PROPERTIES: Readonly<JournalPropertyNames> = {
  content: "内容",
  additionalContent: "补充内容",
  media: "素材",
  embedUrl: "嵌入链接",
  publishedAt: "发布时间",
  createdAt: "创建时间",
  hidden: "隐藏",
};

export interface LoadJournalContentOptions {
  token?: string;
  dataSourceId?: string;
  client?: NotionClient;
  properties?: Partial<JournalPropertyNames>;
  media?: false | MediaLocalizationOptions;
  timeZone?: string;
}

const IMAGE_EXTENSIONS = new Set<string>(MEDIA_FORMAT_EXTENSIONS.image);
const VIDEO_EXTENSIONS = new Set<string>(MEDIA_FORMAT_EXTENSIONS.video);
const AUDIO_EXTENSIONS = new Set<string>(MEDIA_FORMAT_EXTENSIONS.audio);

/** 合并自定义字段名，同时保留 Form 数据库的安全默认值。 */
export const resolveJournalPropertyNames = (
  overrides: Partial<JournalPropertyNames> = {},
): JournalPropertyNames => ({ ...DEFAULT_JOURNAL_PROPERTIES, ...overrides });

/** 校验流水账字段类型，数据库被误改名时立即阻止错误发布。 */
export const validateJournalSchema = (
  dataSource: NotionDataSourceResponse,
  names: JournalPropertyNames,
): void => {
  const expectedTypes: Array<[string, string]> = [
    [names.content, "title"],
    [names.additionalContent, "rich_text"],
    [names.media, "files"],
    [names.embedUrl, "url"],
    [names.publishedAt, "date"],
    [names.createdAt, "created_time"],
    [names.hidden, "checkbox"],
  ];
  for (const [name, expectedType] of expectedTypes) {
    const property = dataSource.properties[name];
    if (!property) throw new Error(`流水账数据源缺少字段「${name}」`);
    if (property.type !== expectedType) {
      throw new Error(`流水账字段「${name}」应为 ${expectedType}，实际为 ${property.type}`);
    }
  }
};

/** 只读取未隐藏记录；最终顺序仍在本地稳定计算，避免空日期排序差异。 */
export const createVisibleJournalQuery = (
  names: JournalPropertyNames,
): Record<string, unknown> => ({
  page_size: 100,
  result_type: "page",
  filter: { property: names.hidden, checkbox: { equals: false } },
  sorts: [
    { property: names.publishedAt, direction: "descending" },
    { timestamp: "created_time", direction: "descending" },
  ],
});

/** 将富文本中的换行拆成独立段落，同时保留每段的链接与标注。 */
const splitRichTextIntoParagraphs = (
  items: ContentRichText[],
): ContentRichText[][] => {
  const paragraphs: ContentRichText[][] = [[]];
  for (const item of items) {
    const lines = item.plainText.replaceAll("\r\n", "\n").split("\n");
    lines.forEach((line, index) => {
      if (line) paragraphs.at(-1)!.push({ ...item, plainText: line });
      if (index < lines.length - 1) paragraphs.push([]);
    });
  }
  return paragraphs.filter((paragraph) => richTextToPlainText(paragraph).trim().length > 0);
};

/** 为属性型文本创建普通段落，流水账不会把 TITLE 字段渲染成文章标题。 */
const createTextBlocks = (
  pageId: string,
  content: ContentRichText[],
  additionalContent: ContentRichText[],
): ContentBlock[] =>
  [...splitRichTextIntoParagraphs(content), ...splitRichTextIntoParagraphs(additionalContent)]
    .map((richText, index) => ({
      id: `${pageId}-form-text-${index + 1}`,
      type: "paragraph" as const,
      richText,
      children: [],
    }));

/** 优先使用原文件名判断类型，URL 只作为旧数据缺少后缀时的补充来源。 */
const readAttachmentExtension = (attachment: ContentFileAttachment): string => {
  const candidates = [attachment.name];
  try {
    candidates.push(decodeURIComponent(new URL(attachment.media.url).pathname));
  } catch {
    // 媒体地址的完整合法性会在本地化阶段校验；这里只尝试提取后缀。
  }
  for (const candidate of candidates) {
    const match = candidate.toLowerCase().match(/\.[a-z0-9]+$/);
    if (match) return match[0];
  }
  return "";
};

/** 从文件后缀判断展示组件；WebM 无法区分音视频时明确要求换容器。 */
const readAttachmentKind = (
  attachment: ContentFileAttachment,
): "image" | "video" | "audio" => {
  const extension = readAttachmentExtension(attachment);
  const image = IMAGE_EXTENSIONS.has(extension);
  const video = VIDEO_EXTENSIONS.has(extension);
  const audio = AUDIO_EXTENSIONS.has(extension);
  if (video && audio) {
    throw new Error(
      `流水账素材「${attachment.name}」无法区分音频或视频；视频请改用 MP4，音频请改用 MP3、M4A、Ogg、WAV、AAC 或 FLAC`,
    );
  }
  if (image) return "image";
  if (video) return "video";
  if (audio) return "audio";
  throw new Error(
    `流水账素材「${attachment.name}」格式不受支持；请使用图片、MP4 视频或常见音频格式`,
  );
};

/** 将 Form 的 FILES 属性按上传顺序转换成现有媒体块模型。 */
const createMediaBlocks = (
  pageId: string,
  attachments: ContentFileAttachment[],
): ContentBlock[] =>
  attachments.map((attachment, index) => {
    const kind = readAttachmentKind(attachment);
    const base = {
      id: `${pageId}-form-media-${index + 1}`,
      type: kind,
      richText: [],
      children: [],
    };
    if (kind === "image") {
      return { ...base, type: kind, image: { ...attachment.media, alt: attachment.name } };
    }
    if (kind === "video") return { ...base, type: kind, video: attachment.media };
    return { ...base, type: kind, audio: attachment.media };
  });

/** 嵌入地址只允许不带账号信息的 HTTPS，避免任意协议进入最终页面。 */
const normalizeEmbedUrl = (
  value: string | null,
  pageId: string,
  propertyName: string,
): string | null => {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`流水账记录 ${pageId} 的「${propertyName}」不是有效网址`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`流水账记录 ${pageId} 的「${propertyName}」必须是安全的 HTTPS 地址`);
  }
  return parsed.toString();
};

/** 将单条 Form 记录转换成时间流条目，完全不依赖页面正文。 */
export const normalizeJournalPage = (
  page: NotionPageResponse,
  names: JournalPropertyNames,
): JournalEntry => {
  const content = readTitleRichTextProperty(getPageProperty(page, names.content));
  const plainContent = richTextToPlainText(content).trim();
  if (!plainContent) throw new Error(`流水账记录 ${page.id} 的内容不能为空`);
  const additionalContent = readRichTextPropertyItems(
    getPageProperty(page, names.additionalContent),
  );
  const attachments = readFileAttachmentsProperty(
    getPageProperty(page, names.media),
    (index) => `page:${page.id}:journal-media:${index}:${page.last_edited_time}`,
  );
  const embedUrl = normalizeEmbedUrl(
    readUrlProperty(getPageProperty(page, names.embedUrl)),
    page.id,
    names.embedUrl,
  );
  const blocks = [
    ...createTextBlocks(page.id, content, additionalContent),
    ...createMediaBlocks(page.id, attachments),
    ...(embedUrl
      ? [{
          id: `${page.id}-form-embed`,
          type: "embed" as const,
          richText: [],
          children: [],
          url: embedUrl,
        }]
      : []),
  ];

  return {
    id: page.id,
    title: plainContent.slice(0, 100),
    category: "journal",
    publishedAt: readDateProperty(getPageProperty(page, names.publishedAt)),
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    notionUrl: page.url,
    route: "/journal",
    cover: null,
    blocks,
  };
};

/** 按展示时区划分日历日期，同一天再按真实创建时间倒序。 */
const sortJournalEntries = (
  entries: JournalEntry[],
  timeZone: string,
): JournalEntry[] =>
  entries.sort((left, right) => {
    const leftDate = readJournalCalendarDate(
      left.publishedAt ?? left.createdAt,
      timeZone,
    );
    const rightDate = readJournalCalendarDate(
      right.publishedAt ?? right.createdAt,
      timeZone,
    );
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return createdDifference || left.id.localeCompare(right.id);
  });

/** 创建流水账客户端；显式参数优先，缺失时读取第二数据源环境变量。 */
const resolveJournalClient = (options: LoadJournalContentOptions): NotionClient => {
  if (options.client) return options.client;
  return new NotionClient({
    token: options.token ?? process.env.NOTION_TOKEN ?? "",
    dataSourceId:
      options.dataSourceId ?? process.env.NOTION_JOURNAL_DATA_SOURCE_ID ?? "",
  });
};

/** 构建时读取独立流水账字段并本地化素材；空流水账不会阻止文章站发布。 */
export const loadJournalContent = async (
  options: LoadJournalContentOptions = {},
): Promise<JournalEntry[]> => {
  const client = resolveJournalClient(options);
  const names = resolveJournalPropertyNames(options.properties);
  validateJournalSchema(await client.retrieveDataSource(), names);
  const pages = await client.queryDataSource(createVisibleJournalQuery(names));
  const entries = pages
    .filter((page) => !readCheckboxProperty(getPageProperty(page, names.hidden)))
    .map((page) => normalizeJournalPage(page, names));
  const localizedEntries =
    options.media === false
      ? entries
      : await localizeContentEntriesMedia(entries, options.media);
  return sortJournalEntries(localizedEntries, options.timeZone ?? "UTC");
};

import { CONTENT_CATEGORY_KEYS } from "../../config/content-category-keys.mjs";

/** 网站内容在代码中的稳定分类，避免页面层依赖 Notion 里的中文选项。 */
export type ContentCategory = (typeof CONTENT_CATEGORY_KEYS)[number];

/** 构建阶段解析出的公开网页信息，用于生成静态链接摘要。 */
export interface ContentLinkPreview {
  title: string;
  description: string | null;
  siteName: string;
}

/** Notion 富文本经过标准化后的格式，页面层只需关心展示语义。 */
export interface ContentRichText {
  type: "text" | "mention" | "equation" | "unknown";
  plainText: string;
  href: string | null;
  linkPreview?: ContentLinkPreview;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

/** 媒体来源信息；Notion 托管链接在构建阶段会被改写为本地地址。 */
export interface ContentMedia {
  url: string;
  source: "notion" | "external";
  expiryTime: string | null;
  localized: boolean;
}

/** 图片额外保留替代文本与实际展示尺寸，供页面稳定判断横竖方向。 */
export interface ContentImage extends ContentMedia {
  alt: string;
  width?: number;
  height?: number;
}

/** 页面正文支持的块类型，未知类型会保留为 unsupported，避免构建直接丢失结构。 */
export type ContentBlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "image"
  | "bookmark"
  | "link_preview"
  | "embed"
  | "video"
  | "audio"
  | "file"
  | "pdf"
  | "equation"
  | "divider"
  | "table"
  | "table_row"
  | "column_list"
  | "column"
  | "child_page"
  | "child_database"
  | "table_of_contents"
  | "breadcrumb"
  | "synced_block"
  | "unsupported";

/** 统一的正文块模型，兼顾常用内容和 Notion 的嵌套结构。 */
export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  richText: ContentRichText[];
  children: ContentBlock[];
  color?: string;
  checked?: boolean;
  language?: string;
  caption?: ContentRichText[];
  expression?: string;
  icon?: string;
  image?: ContentImage;
  video?: ContentMedia;
  url?: string;
  linkPreview?: ContentLinkPreview;
  title?: string;
  cells?: ContentRichText[][];
  table?: {
    hasColumnHeader: boolean;
    hasRowHeader: boolean;
  };
  unsupportedType?: string;
}

/** Astro 页面消费的完整文章对象。 */
export interface ContentEntry {
  id: string;
  title: string;
  slug: string;
  category: ContentCategory;
  status: "published";
  summary: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
  featured: boolean;
  tags: string[];
  externalUrl: string | null;
  repositoryUrl: string | null;
  notionUrl: string;
  route: string;
  cover: ContentImage | null;
  blocks: ContentBlock[];
}

/** Notion 数据源字段名集中定义，便于未来安全重命名。 */
export interface ContentPropertyNames {
  title: string;
  slug: string;
  category: string;
  status: string;
  summary: string;
  publishedAt: string;
  order: string;
  featured: string;
  externalUrl: string;
  repositoryUrl: string;
  tags: string;
  cover: string;
}

/** 媒体本地化参数；生产构建写入 dist，开发模式写入 public。 */
export interface MediaLocalizationOptions {
  outputDirectory?: string;
  publicPath?: string;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  localizeExternalImages?: boolean;
  localizeExternalVideos?: boolean;
  maxRedirects?: number;
  requestTimeoutMs?: number;
}

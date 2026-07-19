import type {
  ContentBlock,
  ContentEntry,
  ContentLinkPreview,
  ContentRichText,
} from "../lib/notion";
import { CONTENT_SNAPSHOT } from "./content-snapshot";

const EXAMPLE_CAREER_URL =
  "https://www.notion.so/a1111111111141118111111111111111";

const PRODUCT_LINK_PREVIEW: ContentLinkPreview = {
  title: "示例产品",
  description: "用于验证正文链接摘要、站点名称和安全外链属性的构建夹具。",
  siteName: "Example",
};

const REFERENCE_LINK_PREVIEW: ContentLinkPreview = {
  title: "一个普通网页书签",
  description: "独立链接会像 Notion 一样直接展示标题、来源与简短摘要。",
  siteName: "Example",
};

/** 创建无额外格式的富文本片段，让测试正文保持可读。 */
const text = (
  plainText: string,
  href: string | null = null,
  linkPreview?: ContentLinkPreview,
): ContentRichText => ({
  type: "text",
  plainText,
  href,
  ...(linkPreview ? { linkPreview } : {}),
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
  },
});

/** 创建正文块的稳定测试模型，覆盖常用 Notion 内容样式。 */
const block = (
  id: string,
  type: ContentBlock["type"],
  richText: ContentRichText[] = [],
  children: ContentBlock[] = [],
): ContentBlock => ({ id, type, richText, children });

/** 创建竖屏截图夹具，用真实双栏结构验证图片不会突破各自栏位。 */
const portraitScreenshot = (id: string, alt: string): ContentBlock => ({
  ...block(id, "image"),
  image: {
    url: "/notion-assets/ecd0cd4178539f17f752b77ff7ae77fcec37da042bebd8ca274cbea71d4d4205.png",
    alt,
    source: "notion",
    expiryTime: null,
    localized: true,
    width: 360,
    height: 780,
  },
  caption: [text(alt)],
});

const INTERNAL_ARTICLE: ContentEntry = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "用 Notion 写一篇文章",
  slug: "writing-with-notion",
  category: "journal",
  status: "published",
  summary: "这篇构建夹具验证 Notion 正文会生成完整的站内静态页面。",
  publishedAt: "2026-07-18",
  createdAt: "2026-07-18T08:00:00.000Z",
  updatedAt: "2026-07-18T09:00:00.000Z",
  order: 20,
  featured: false,
  tags: ["随笔", "技术"],
  externalUrl: null,
  notionUrl: "https://www.notion.so/11111111222233334444555555555555",
  route: "/journal/writing-with-notion",
  cover: null,
  blocks: [
    block("intro", "paragraph", [
      text("文章正文来自 Notion，构建后成为不依赖 Notion 页面模板的静态 HTML。"),
    ]),
    block("self-link", "paragraph", [
      text("站内链接也会改写："),
      text("本文", "https://www.notion.so/11111111222233334444555555555555"),
    ]),
    block("related-entry-link", "paragraph", [
      text("相关内容会改写为站内链接："),
      text("Northstar Studio", EXAMPLE_CAREER_URL),
    ]),
    block("external-url-link", "paragraph", [
      text("外部链接也会显示为 mention："),
      text(
        "https://example.com/product?source=notion",
        "https://example.com/product?source=notion",
        PRODUCT_LINK_PREVIEW,
      ),
    ]),
    block("external-standalone-link", "paragraph", [
      text(
        "https://example.com/product?source=standalone",
        "https://example.com/product?source=standalone",
        PRODUCT_LINK_PREVIEW,
      ),
    ]),
    {
      ...block("internal-bookmark", "bookmark"),
      url: EXAMPLE_CAREER_URL,
      caption: [text("Northstar Studio 静态详情")],
    },
    {
      ...block("internal-table", "table", [], [
        {
          ...block("internal-table-row", "table_row"),
          cells: [[text("相关经历")], [text("Northstar Studio", EXAMPLE_CAREER_URL)]],
        },
      ]),
      table: { hasColumnHeader: false, hasRowHeader: false },
    },
    block("heading", "heading_2", [text("内容如何更新")]),
    block("paragraph-link", "paragraph", [
      text("在数据库里编辑完成后，将状态改为“已发布”，再触发一次 Cloudflare Pages 构建。"),
    ]),
    block("list-one", "bulleted_list_item", [text("正文、标题和摘要都会在构建时读取。")]),
    block("list-two", "bulleted_list_item", [text("草稿不会进入网站，也不会生成公开地址。")]),
    block("quote", "quote", [text("Notion 负责写作，静态网站负责最终呈现。")]),
    {
      ...block("animated-gif", "image"),
      image: {
        url: "/notion-assets/8550ce349fe18c2784edf8e4c798ede1e4062dca7607cd79a3bc00a63afa54a6.gif",
        alt: "动态操作演示",
        source: "notion",
        expiryTime: null,
        localized: true,
      },
      caption: [text("GIF 动画演示")],
    },
    block("portrait-columns", "column_list", [], [
      block("portrait-column-one", "column", [], [
        portraitScreenshot("portrait-screenshot-one", "竖屏截图一"),
      ]),
      block("portrait-column-two", "column", [], [
        portraitScreenshot("portrait-screenshot-two", "竖屏截图二"),
      ]),
    ]),
    {
      ...block("uploaded-video", "video"),
      video: {
        url: "/notion-assets/7e2817c0d96668fedb7bafd028b897d8ab82d81a433250f25452a4c818796f70.mp4",
        source: "notion",
        expiryTime: null,
        localized: true,
      },
      caption: [text("Notion 上传视频")],
    },
    {
      ...block("youtube-video", "video"),
      video: {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        source: "external",
        expiryTime: null,
        localized: false,
      },
      caption: [text("YouTube 视频")],
    },
    {
      ...block("vimeo-embed", "embed"),
      url: "https://player.vimeo.com/video/226053498?h=a1599a8ee9",
      caption: [text("Vimeo 视频")],
    },
    {
      ...block("bookmark", "bookmark"),
      url: "https://example.com/reference",
      caption: [text("一个普通网页书签")],
      linkPreview: REFERENCE_LINK_PREVIEW,
    },
    {
      ...block("code", "code", [text("CONTENT_SOURCE=notion npm run build")]),
      language: "shell",
      caption: [text("一次完整的内容构建")],
    },
    block("escaped", "paragraph", [
      text('安全转义示例：<script>alert("xss")</script>', "javascript:alert(1)"),
    ]),
    block("divider", "divider"),
    block("toggle", "toggle", [text("为什么需要重新构建？")], [
      block("toggle-answer", "paragraph", [
        text("因为线上只保留已经生成好的静态文件，访问时不再请求 Notion。"),
      ]),
    ]),
  ],
};

/** 仅在 CONTENT_SOURCE=fixture 时使用，绝不会被正式发布脚本读取。 */
export const TEST_CONTENT: ContentEntry[] = [...CONTENT_SNAPSHOT, INTERNAL_ARTICLE];

import type { ContentBlock, ContentEntry, ContentRichText } from "../lib/notion";
import { CONTENT_SNAPSHOT } from "./content-snapshot";

const LEGACY_QTRADE_URL =
  "https://wenmsg.notion.site/QTrade-3a1f211130e4800d8a5bc3fb3ffeaaf2";

/** 创建无额外格式的富文本片段，让测试正文保持可读。 */
const text = (plainText: string, href: string | null = null): ContentRichText => ({
  type: "text",
  plainText,
  href,
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
    block("external-entry-link", "paragraph", [
      text("旧内容链接会继续前往："),
      text("QTrade", LEGACY_QTRADE_URL),
    ]),
    {
      ...block("internal-bookmark", "bookmark"),
      url: LEGACY_QTRADE_URL,
      caption: [text("QTrade 静态详情")],
    },
    {
      ...block("internal-table", "table", [], [
        {
          ...block("internal-table-row", "table_row"),
          cells: [[text("相关经历")], [text("QTrade", LEGACY_QTRADE_URL)]],
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
    block("quote", "quote", [text("Notion 负责写作，wenren.cc 负责最终呈现。")]),
    {
      ...block("bookmark", "bookmark"),
      url: "https://example.com/reference",
      caption: [text("一个普通网页书签")],
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

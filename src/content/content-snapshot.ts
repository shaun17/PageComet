import type { ContentBlock, ContentCategory, ContentEntry } from "../lib/notion";

const SNAPSHOT_TIME = "2026-07-18T08:00:00.000Z";

interface MigratedEntryInput {
  id: string;
  title: string;
  slug: string;
  category: ContentCategory;
  summary: string;
  order: number;
  legacyUrl: string;
}

/** 为迁移后的条目生成最小正文，确保测试数据遵守正式内容约束。 */
const createSnapshotBody = (slug: string, summary: string): ContentBlock[] => [
  {
    id: `${slug}-body`,
    type: "paragraph",
    richText: [
      {
        type: "text",
        plainText: summary,
        href: null,
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
      },
    ],
    children: [],
  },
];

/** 生成已迁移为站内详情页的静态快照，测试构建不需要读取真实账户。 */
const createMigratedEntry = ({
  legacyUrl,
  ...input
}: MigratedEntryInput): ContentEntry => ({
    ...input,
    status: "published",
    publishedAt: "2026-07-18",
    createdAt: SNAPSHOT_TIME,
    updatedAt: SNAPSHOT_TIME,
    featured: false,
    tags: [],
    externalUrl: null,
    notionUrl: legacyUrl,
    route: `/${input.category}/${input.slug}`,
    cover: null,
    blocks: createSnapshotBody(input.slug, input.summary),
  });

/** 已迁移到“网站内容”数据库的原站内容，只用于离线测试。 */
export const CONTENT_SNAPSHOT: ContentEntry[] = [
  createMigratedEntry({
    id: "3a1f2111-30e4-81f6-b2ae-c459c7e41857",
    title: "QTrade",
    slug: "qtrade",
    category: "career",
    summary: "软件工程与交易系统相关的职业经历。",
    order: 10,
    legacyUrl:
      "https://wenmsg.notion.site/QTrade-3a1f211130e4800d8a5bc3fb3ffeaaf2?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-81a6-88cc-ec93825080f9",
    title: "Kingdee",
    slug: "kingdee",
    category: "career",
    summary: "企业软件开发相关的职业经历。",
    order: 20,
    legacyUrl:
      "https://wenmsg.notion.site/Kingdee-3a1f211130e480608e16f7a50c77c42b?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-81ec-b370-d708b2b1a657",
    title: "CoolBox",
    slug: "coolbox",
    category: "career",
    summary: "早期软件开发与产品实践。",
    order: 30,
    legacyUrl:
      "https://wenmsg.notion.site/CoolBox-3a1f211130e48038a132d55dbbfcc6e3?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-8151-95c6-c61a72db49b2",
    title: "客户端开发的尝试",
    slug: "client-development-experiments",
    category: "works",
    summary: "客户端方向的开发尝试与记录。",
    order: 10,
    legacyUrl: "https://wenmsg.notion.site/1c0f211130e480218e58e66af61f09e2?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-8198-8573-e031629a61d8",
    title: "Petly Care",
    slug: "petly-care",
    category: "works",
    summary: "围绕宠物健康管理的产品实践。",
    order: 20,
    legacyUrl:
      "https://wenmsg.notion.site/Petly-Care-2c8f211130e480918bdfec198e501273?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-81a3-a408-cf59ba211572",
    title: "retimeber 计时器",
    slug: "retimeber",
    category: "works",
    summary: "一款专注记录与时间感知的计时器。",
    order: 30,
    legacyUrl:
      "https://wenmsg.notion.site/retimeber-1aff211130e4808d9511f5cddb8d8a30?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-81cb-9ecb-e77c6416c7df",
    title: "IDPhotoMaker",
    slug: "id-photo-maker",
    category: "works",
    summary: "面向 iOS 的证件照制作工具。",
    order: 40,
    legacyUrl:
      "https://wenmsg.notion.site/IDPhotoMaker-IOS-APP-133f211130e4808d9df7ecb870a4ca84?pvs=25",
  }),
  createMigratedEntry({
    id: "3a1f2111-30e4-8111-8eb2-f1660f52d6e8",
    title: "流水账",
    slug: "journal",
    category: "journal",
    summary: "偶尔记录生活、想法和正在发生的事。",
    order: 10,
    legacyUrl: "https://wenmsg.notion.site/3a1f211130e480b0b3e1c8c30b902517",
  }),
];

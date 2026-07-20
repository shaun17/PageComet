import type { ContentBlock, ContentCategory, ContentEntry } from "../lib/notion";

const SNAPSHOT_TIME = "2026-01-15T08:00:00.000Z";

interface ExampleEntryInput {
  id: string;
  title: string;
  slug: string;
  category: ContentCategory;
  summary: string;
  order: number;
  externalUrl?: string;
  repositoryUrl?: string;
}

/** 为示例条目生成最小正文，确保离线预览与正式内容使用同一数据模型。 */
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

/** 生成完全虚构的 Alice 示例条目，不依赖任何真实 Notion 账户。 */
const createExampleEntry = (input: ExampleEntryInput): ContentEntry => ({
  ...input,
  status: "published",
  publishedAt: "2026-01-15",
  createdAt: SNAPSHOT_TIME,
  updatedAt: SNAPSHOT_TIME,
  featured: false,
  tags: [],
  externalUrl: input.externalUrl ?? null,
  repositoryUrl: input.repositoryUrl ?? null,
  notionUrl: `https://www.notion.so/${input.id.replaceAll("-", "")}`,
  route: `/${input.category}/${input.slug}`,
  cover: null,
  blocks: createSnapshotBody(input.slug, input.summary),
});

/** 默认首页和分类页使用的 Alice 示例内容，供无密钥开发与 CI 构建。 */
export const CONTENT_SNAPSHOT: ContentEntry[] = [
  createExampleEntry({
    id: "a1111111-1111-4111-8111-111111111111",
    title: "Northstar Studio",
    slug: "northstar-studio",
    category: "career",
    summary: "负责设计系统与核心产品体验的职业经历。",
    order: 10,
  }),
  createExampleEntry({
    id: "a2222222-2222-4222-8222-222222222222",
    title: "Beacon Labs",
    slug: "beacon-labs",
    category: "career",
    summary: "参与早期产品探索与跨职能协作。",
    order: 20,
  }),
  createExampleEntry({
    id: "b1111111-1111-4111-8111-111111111111",
    title: "Atlas Notes",
    slug: "atlas-notes",
    category: "works",
    summary: "一款帮助创作者整理研究资料的笔记工具。",
    order: 10,
    externalUrl: "https://atlas-notes.example.com/",
    repositoryUrl: "https://github.com/example/atlas-notes/",
  }),
  createExampleEntry({
    id: "b2222222-2222-4222-8222-222222222222",
    title: "Focus Timer",
    slug: "focus-timer",
    category: "works",
    summary: "保持克制的专注计时器。",
    order: 20,
    repositoryUrl: "https://github.com/example/focus-timer/",
  }),
  createExampleEntry({
    id: "b3333333-3333-4333-8333-333333333333",
    title: "Pocket Gallery",
    slug: "pocket-gallery",
    category: "works",
    summary: "为个人作品打造的轻量展示工具。",
    order: 30,
    externalUrl: "https://pocket-gallery.example.com/",
  }),
  createExampleEntry({
    id: "b4444444-4444-4444-8444-444444444444",
    title: "Shared Link",
    slug: "shared-link",
    category: "works",
    summary: "用于验证误填相同地址时只展示一个源码入口。",
    order: 40,
    externalUrl: "https://github.com/example/shared-link/",
    repositoryUrl: "https://github.com/example/shared-link/",
  }),
];

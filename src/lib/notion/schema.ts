import type { NotionDataSourceResponse, NotionPageResponse } from "./api-types";
import { siteConfig } from "../../config/runtime-site-config";
import type {
  ContentBlock,
  ContentCategory,
  ContentEntry,
  ContentPropertyNames,
} from "./types";
import {
  asRecord,
  getPageProperty,
  readCheckboxProperty,
  readDateProperty,
  readFileImage,
  readFilesProperty,
  readMultiSelectProperty,
  readNumberProperty,
  readRichTextProperty,
  readSelectProperty,
  readTitleProperty,
  readUrlProperty,
} from "./values";

/** 与“网站内容”数据库保持一致的默认字段名。 */
export const DEFAULT_CONTENT_PROPERTIES: Readonly<ContentPropertyNames> = {
  title: "标题",
  slug: "Slug",
  category: "分类",
  status: "状态",
  summary: "摘要",
  publishedAt: "发布日期",
  order: "排序",
  featured: "置顶",
  externalUrl: "外部链接",
  tags: "标签",
  cover: "封面",
};

const CATEGORY_MAP: Readonly<Record<string, ContentCategory>> = Object.fromEntries(
  siteConfig.categories.map((category) => [category.notionOption, category.key]),
) as Record<string, ContentCategory>;
const REQUIRED_CATEGORY_OPTIONS = siteConfig.categories.map(
  (category) => category.notionOption,
);

/** 读取 SELECT schema 的选项名称，供构建前验证固定枚举。 */
const readSchemaOptionNames = (value: unknown): Set<string> => {
  const property = asRecord(value);
  const propertyType = typeof property?.type === "string" ? property.type : "";
  const configuration = asRecord(property?.[propertyType]);
  const options = Array.isArray(configuration?.options) ? configuration.options : [];
  return new Set(
    options.flatMap((option) => {
      const record = asRecord(option);
      return typeof record?.name === "string" ? [record.name] : [];
    }),
  );
};

/** 确认固定枚举没有被误删或改名，避免查询成功但站点内容被清空。 */
const assertSchemaOptions = (
  dataSource: NotionDataSourceResponse,
  propertyName: string,
  requiredOptions: string[],
): void => {
  const options = readSchemaOptionNames(dataSource.properties[propertyName]);
  const missing = requiredOptions.filter((option) => !options.has(option));
  if (missing.length > 0) {
    throw new Error(`Notion 字段「${propertyName}」缺少固定选项：${missing.join("、")}`);
  }
};

/** 合并自定义字段名，同时保留数据库契约的安全默认值。 */
export const resolvePropertyNames = (
  overrides: Partial<ContentPropertyNames> = {},
): ContentPropertyNames => ({ ...DEFAULT_CONTENT_PROPERTIES, ...overrides });

/** 创建只查询“已发布”内容的服务端过滤和稳定排序。 */
export const createPublishedContentQuery = (
  names: ContentPropertyNames,
): Record<string, unknown> => ({
  page_size: 100,
  result_type: "page",
  filter: { property: names.status, select: { equals: "已发布" } },
  sorts: [
    { property: names.featured, direction: "descending" },
    { property: names.order, direction: "ascending" },
    { property: names.publishedAt, direction: "descending" },
    { timestamp: "last_edited_time", direction: "descending" },
  ],
});

/** 校验数据源字段类型，避免数据库被改名后悄悄生成错误页面。 */
export const validateContentSchema = (
  dataSource: NotionDataSourceResponse,
  names: ContentPropertyNames,
): void => {
  const expectedTypes: Array<[string, string]> = [
    [names.title, "title"],
    [names.slug, "rich_text"],
    [names.category, "select"],
    [names.status, "select"],
    [names.summary, "rich_text"],
    [names.publishedAt, "date"],
    [names.order, "number"],
    [names.featured, "checkbox"],
    [names.externalUrl, "url"],
    [names.tags, "multi_select"],
    [names.cover, "files"],
  ];

  for (const [name, expectedType] of expectedTypes) {
    const property = dataSource.properties[name];
    if (!property) throw new Error(`Notion 数据源缺少字段「${name}」`);
    if (property.type !== expectedType) {
      throw new Error(`Notion 字段「${name}」应为 ${expectedType}，实际为 ${property.type}`);
    }
  }

  assertSchemaOptions(dataSource, names.category, REQUIRED_CATEGORY_OPTIONS);
  assertSchemaOptions(dataSource, names.status, ["草稿", "已发布", "归档"]);
};

/** 规范化并校验 slug，阻止路径穿越和不可预测的文章地址。 */
const normalizeSlug = (value: string, pageId: string): string => {
  const slug = value.normalize("NFKC").trim();
  const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (slug.length > 80 || !validSlug.test(slug)) {
    throw new Error(`Notion 页面 ${pageId} 的 Slug「${value}」格式无效`);
  }
  return slug;
};

/** 排序只能是有限范围内的整数，空值统一放到人工排序项之后。 */
const normalizeOrder = (value: number | null, pageId: string): number => {
  if (value === null) return 1_000;
  if (!Number.isInteger(value) || value < 0 || value > 9_999) {
    throw new Error(`Notion 页面 ${pageId} 的排序必须是 0 到 9999 之间的整数`);
  }
  return value;
};

/** 校验外部链接仅使用网页协议，避免内容层注入危险 scheme。 */
const normalizeExternalUrl = (value: string | null, pageId: string): string | null => {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Notion 页面 ${pageId} 的外部链接仅支持 http/https`);
  }
  return parsed.toString();
};

/** 将单个已发布 Notion 页面转换为站点 ContentEntry。 */
export const normalizeContentPage = (
  page: NotionPageResponse,
  blocks: ContentBlock[],
  names: ContentPropertyNames,
): ContentEntry => {
  const title = readTitleProperty(getPageProperty(page, names.title));
  if (!title) throw new Error(`Notion 页面 ${page.id} 的标题不能为空`);
  if (title.length > 100) throw new Error(`Notion 页面 ${page.id} 的标题不能超过 100 个字符`);

  const categoryName = readSelectProperty(getPageProperty(page, names.category));
  const category = categoryName ? CATEGORY_MAP[categoryName] : undefined;
  if (!category) throw new Error(`Notion 页面 ${page.id} 的分类「${categoryName ?? "空"}」无效`);

  const status = readSelectProperty(getPageProperty(page, names.status));
  if (status !== "已发布") throw new Error(`Notion 页面 ${page.id} 并非已发布状态`);

  const slug = normalizeSlug(readRichTextProperty(getPageProperty(page, names.slug)), page.id);
  const summary = readRichTextProperty(getPageProperty(page, names.summary));
  if (!summary || summary.length > 200) {
    throw new Error(`Notion 页面 ${page.id} 的摘要必须为 1 到 200 个字符`);
  }
  const publishedAt = readDateProperty(getPageProperty(page, names.publishedAt));
  const externalUrl = normalizeExternalUrl(
    readUrlProperty(getPageProperty(page, names.externalUrl)),
    page.id,
  );
  if (!publishedAt) throw new Error(`文章「${title}」必须填写发布日期`);
  const propertyCover = readFilesProperty(getPageProperty(page, names.cover), title);
  const cover = propertyCover ?? readFileImage(page.cover, title);

  return {
    id: page.id,
    title,
    slug,
    category,
    status: "published",
    summary,
    publishedAt,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    order: normalizeOrder(readNumberProperty(getPageProperty(page, names.order)), page.id),
    featured: readCheckboxProperty(getPageProperty(page, names.featured)),
    tags: readMultiSelectProperty(getPageProperty(page, names.tags)),
    externalUrl,
    notionUrl: page.url,
    route: `/${category}/${encodeURIComponent(slug)}`,
    cover,
    blocks,
  };
};

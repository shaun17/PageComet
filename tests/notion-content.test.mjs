import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { siteConfig } from "../src/config/site-config.mjs";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let loadPublishedContent;
let normalizeContentPage;
let resolvePropertyNames;
let validateContentSchema;

/** 使用项目自身编译链加载内容模块，确保环境变量判断与 Astro 构建一致。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ loadPublishedContent } = await vite.ssrLoadModule("/src/lib/notion/content.ts"));
  ({ normalizeContentPage, resolvePropertyNames, validateContentSchema } =
    await vite.ssrLoadModule("/src/lib/notion/schema.ts"));
});

/** 测试完成后关闭 Vite 文件监听器。 */
after(async () => {
  await vite?.close();
});

/** 构造包含当前配置分类的最小合法 Notion 数据源。 */
const createDataSource = () => ({
  object: "data_source",
  id: "empty-data-source",
  properties: {
    标题: { type: "title", title: {} },
    Slug: { type: "rich_text", rich_text: {} },
    分类: {
      type: "select",
      select: {
        options: siteConfig.categories.map(({ notionOption: name }) => ({ name })),
      },
    },
    状态: {
      type: "select",
      select: { options: ["草稿", "已发布", "归档"].map((name) => ({ name })) },
    },
    摘要: { type: "rich_text", rich_text: {} },
    发布日期: { type: "date", date: {} },
    排序: { type: "number", number: {} },
    置顶: { type: "checkbox", checkbox: {} },
    外部链接: { type: "url", url: {} },
    "GitHub 仓库": { type: "url", url: {} },
    标签: { type: "multi_select", multi_select: {} },
    封面: { type: "files", files: {} },
  },
});

/** 构造查询结果为空的客户端，专门验证空站发布边界。 */
const createEmptyClient = () => ({
  retrieveDataSource: async () => createDataSource(),
  queryDataSource: async () => [],
});

/** 构造标准富文本属性，验证真实 Notion 页面字段到站点模型的映射。 */
const richTextProperty = (type, value) => ({
  type,
  [type]: value
    ? [
        {
          type: "text",
          plain_text: value,
          text: { content: value, link: null },
          annotations: {},
        },
      ]
    : [],
});

/** 构造同时包含项目地址和仓库地址的最小已发布页面。 */
const createPublishedPage = (repositoryUrl) => ({
  object: "page",
  id: "project-entry",
  created_time: "2026-07-19T00:00:00.000Z",
  last_edited_time: "2026-07-19T01:00:00.000Z",
  url: "https://www.notion.so/project-entry",
  cover: null,
  properties: {
    标题: richTextProperty("title", "Atlas Notes"),
    Slug: richTextProperty("rich_text", "atlas-notes"),
    分类: { type: "select", select: { name: "个人作品" } },
    状态: { type: "select", select: { name: "已发布" } },
    摘要: richTextProperty("rich_text", "一个开源 Web 项目。"),
    发布日期: { type: "date", date: { start: "2026-07-19" } },
    排序: { type: "number", number: 10 },
    置顶: { type: "checkbox", checkbox: false },
    外部链接: { type: "url", url: "https://atlas-notes.example.com" },
    "GitHub 仓库": { type: "url", url: repositoryUrl },
    标签: { type: "multi_select", multi_select: [] },
    封面: { type: "files", files: [] },
  },
});

/** 临时设置空站开关并在断言后恢复，避免污染其他测试。 */
const withAllowEmptySite = async (value, callback) => {
  const previous = process.env.ALLOW_EMPTY_SITE;
  if (value === undefined) delete process.env.ALLOW_EMPTY_SITE;
  else process.env.ALLOW_EMPTY_SITE = value;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.ALLOW_EMPTY_SITE;
    else process.env.ALLOW_EMPTY_SITE = previous;
  }
};

test("fails closed when Notion has no published content", async () => {
  await withAllowEmptySite(undefined, async () => {
    await assert.rejects(
      loadPublishedContent({ client: createEmptyClient(), media: false }),
      /没有查询到任何已发布内容，已阻止生成空站/,
    );
  });
});

test("allows an empty site only through an explicit option or environment flag", async () => {
  await withAllowEmptySite(undefined, async () => {
    assert.deepEqual(
      await loadPublishedContent({
        client: createEmptyClient(),
        media: false,
        allowEmptySite: true,
      }),
      [],
    );
  });

  await withAllowEmptySite("true", async () => {
    assert.deepEqual(
      await loadPublishedContent({ client: createEmptyClient(), media: false }),
      [],
    );
  });
});

test("rejects malformed empty-site environment values", async () => {
  await withAllowEmptySite("yes", async () => {
    await assert.rejects(
      loadPublishedContent({ client: createEmptyClient(), media: false }),
      /ALLOW_EMPTY_SITE 仅支持 true 或 false/,
    );
  });
});

test("maps project and repository URLs from Notion into one content entry", () => {
  const entry = normalizeContentPage(
    createPublishedPage("https://github.com/example/atlas-notes"),
    [],
    resolvePropertyNames(),
  );

  assert.equal(entry.externalUrl, "https://atlas-notes.example.com/");
  assert.equal(entry.repositoryUrl, "https://github.com/example/atlas-notes");
});

test("keeps an empty repository property as null", () => {
  const entry = normalizeContentPage(
    createPublishedPage(null),
    [],
    resolvePropertyNames(),
  );

  assert.equal(entry.repositoryUrl, null);
});

test("rejects an unsafe repository URL before rendering article actions", () => {
  assert.throws(
    () =>
      normalizeContentPage(
        createPublishedPage("https://gitlab.com/example/atlas-notes"),
        [],
        resolvePropertyNames(),
      ),
    /GitHub 仓库.*必须是完整的 GitHub 仓库地址/,
  );
});

test("requires the GitHub repository field in the Notion schema", () => {
  const source = createDataSource();
  delete source.properties["GitHub 仓库"];

  assert.throws(
    () => validateContentSchema(source, resolvePropertyNames()),
    /缺少字段「GitHub 仓库」/,
  );
});

test("rejects the wrong GitHub repository property type", () => {
  const source = createDataSource();
  source.properties["GitHub 仓库"] = { type: "rich_text", rich_text: {} };

  assert.throws(
    () => validateContentSchema(source, resolvePropertyNames()),
    /GitHub 仓库.*应为 url，实际为 rich_text/,
  );
});

test("reports malformed project URLs with their Notion field name", () => {
  const page = createPublishedPage(null);
  page.properties.外部链接.url = "not-a-url";

  assert.throws(
    () => normalizeContentPage(page, [], resolvePropertyNames()),
    /外部链接.*不是有效网址/,
  );
});

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { siteConfig } from "../src/config/site-config.mjs";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let loadPublishedContent;

/** 使用项目自身编译链加载内容模块，确保环境变量判断与 Astro 构建一致。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ loadPublishedContent } = await vite.ssrLoadModule("/src/lib/notion/content.ts"));
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
    标签: { type: "multi_select", multi_select: {} },
    封面: { type: "files", files: {} },
  },
});

/** 构造查询结果为空的客户端，专门验证空站发布边界。 */
const createEmptyClient = () => ({
  retrieveDataSource: async () => createDataSource(),
  queryDataSource: async () => [],
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

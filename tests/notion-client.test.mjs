import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let NotionClient;
let createPublishedContentQuery;
let resolvePropertyNames;

/** 通过项目自身的 Vite 编译链加载 TypeScript 模块，避免测试使用另一套转译规则。 */
before(async () => {
  vite = await createServer({
    root: projectRoot,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
  });

  ({ NotionClient } = await vite.ssrLoadModule("/src/lib/notion/client.ts"));
  ({ createPublishedContentQuery, resolvePropertyNames } =
    await vite.ssrLoadModule("/src/lib/notion/schema.ts"));
});

/** 每轮测试后关闭 Vite，避免文件监听器阻止 Node 测试进程退出。 */
after(async () => {
  await vite?.close();
});

/** 构造满足客户端分页协议的 JSON 响应。 */
const jsonResponse = (results) =>
  new Response(
    JSON.stringify({
      object: "list",
      type: "page_or_data_source",
      page_or_data_source: {},
      results,
      has_more: false,
      next_cursor: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

/** 构造客户端过滤所需的最小页面对象。 */
const page = (id, flags = {}) => ({ object: "page", id, ...flags });

/** 构造客户端过滤所需的最小内容块对象。 */
const block = (id, flags = {}) => ({
  object: "block",
  id,
  type: "paragraph",
  has_children: false,
  ...flags,
});

test("omits false in_trash and excludes trashed or archived pages", async () => {
  const requests = [];
  const query = createPublishedContentQuery(resolvePropertyNames());
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    maxRetries: 0,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse([
        page("published"),
        page("trashed", { in_trash: true }),
        page("archived-new", { is_archived: true }),
        page("archived-legacy", { archived: true }),
        { object: "data_source", id: "nested-data-source" },
      ]);
    },
  });

  const pages = await client.queryDataSource(query);

  assert.deepEqual(pages.map(({ id }) => id), ["published"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.endsWith("/data_sources/test-data-source/query"), true);
  assert.equal(Object.hasOwn(requests[0].body, "in_trash"), false);
  assert.equal(requests[0].body.result_type, "page");
});

test("excludes trashed or archived blocks from article content", async () => {
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    maxRetries: 0,
    fetchImpl: async () =>
      jsonResponse([
        block("visible"),
        block("trashed", { in_trash: true }),
        block("archived-new", { is_archived: true }),
        block("archived-legacy", { archived: true }),
      ]),
  });

  const blocks = await client.listBlockChildren("article-page");

  assert.deepEqual(blocks.map(({ id }) => id), ["visible"]);
});

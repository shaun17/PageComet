import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let NotionClient;
let createNotionRequestScheduler;
let createPublishedContentQuery;
let resolvePropertyNames;

/** 通过项目自身的 Vite 编译链加载 TypeScript 模块，避免测试使用另一套转译规则。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);

  ({ NotionClient, createNotionRequestScheduler } =
    await vite.ssrLoadModule("/src/lib/notion/client.ts"));
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

/** 模拟 Node 全局 Fetch 对 Undici 建连超时的 TypeError 包装结构。 */
const connectTimeoutError = (attempt) => {
  const cause = Object.assign(new Error(`Connect Timeout Error ${attempt}`), {
    name: "ConnectTimeoutError",
    code: "UND_ERR_CONNECT_TIMEOUT",
  });
  return new TypeError("fetch failed", { cause });
};

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

test("immediately retries two Notion connection timeouts and succeeds on the third attempt", async () => {
  let attemptCount = 0;
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    scheduler: createNotionRequestScheduler({ intervalMs: 0, concurrency: 1 }),
    fetchImpl: async () => {
      attemptCount += 1;
      if (attemptCount <= 2) throw connectTimeoutError(attemptCount);
      return new Response(JSON.stringify({ object: "data_source", id: "test-data-source" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const dataSource = await client.retrieveDataSource();

  assert.equal(attemptCount, 3);
  assert.equal(dataSource.id, "test-data-source");
});

test("stops after two Notion connection-timeout retries and preserves the final error", async () => {
  const errors = [1, 2, 3].map(connectTimeoutError);
  let attemptCount = 0;
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    scheduler: createNotionRequestScheduler({ intervalMs: 0, concurrency: 1 }),
    fetchImpl: async () => {
      const error = errors[attemptCount];
      attemptCount += 1;
      throw error;
    },
  });

  await assert.rejects(client.retrieveDataSource(), (error) => error === errors[2]);
  assert.equal(attemptCount, 3);
});

test("does not retry unrelated Notion network failures", async () => {
  const socketError = new TypeError("fetch failed", {
    cause: Object.assign(new Error("socket disconnected"), { code: "UND_ERR_SOCKET" }),
  });
  let attemptCount = 0;
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    scheduler: createNotionRequestScheduler({ intervalMs: 0, concurrency: 1 }),
    fetchImpl: async () => {
      attemptCount += 1;
      throw socketError;
    },
  });

  await assert.rejects(client.retrieveDataSource(), (error) => error === socketError);
  assert.equal(attemptCount, 1);
});

test("keeps connection-timeout and HTTP response retry budgets independent", async () => {
  let attemptCount = 0;
  const client = new NotionClient({
    token: "test-token",
    dataSourceId: "test-data-source",
    maxRetries: 1,
    scheduler: createNotionRequestScheduler({ intervalMs: 0, concurrency: 1 }),
    fetchImpl: async () => {
      attemptCount += 1;
      if (attemptCount === 1 || attemptCount === 3) {
        throw connectTimeoutError(attemptCount);
      }
      if (attemptCount === 2) {
        return new Response("temporary failure", {
          status: 503,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ object: "data_source", id: "test-data-source" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const dataSource = await client.retrieveDataSource();

  assert.equal(attemptCount, 4);
  assert.equal(dataSource.id, "test-data-source");
});

test("shared Notion scheduler enforces its global concurrency limit", async () => {
  const scheduler = createNotionRequestScheduler({ intervalMs: 0, concurrency: 2 });
  const started = [];
  const releases = [];

  /** 创建受测试控制的请求，用于精确观察队列何时启动下一项。 */
  const createTask = (id) =>
    scheduler.schedule(
      () =>
        new Promise((resolve) => {
          started.push(id);
          releases.push(resolve);
        }),
    );

  const tasks = [createTask(1), createTask(2), createTask(3), createTask(4)];
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2]);

  releases.shift()(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]);

  releases.shift()(2);
  releases.shift()(3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3, 4]);
  releases.shift()(4);
  assert.deepEqual(await Promise.all(tasks), [1, 2, 3, 4]);
});

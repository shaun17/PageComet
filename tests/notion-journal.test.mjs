import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let createVisibleJournalQuery;
let loadJournalContent;
let normalizeJournalPage;
let resolveJournalPropertyNames;
let validateJournalSchema;

/** 通过项目自身编译链加载流水账模块，确保测试和 Astro 构建行为一致。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({
    createVisibleJournalQuery,
    loadJournalContent,
    normalizeJournalPage,
    resolveJournalPropertyNames,
    validateJournalSchema,
  } = await vite.ssrLoadModule("/src/lib/notion/journal.ts"));
});

/** 测试完成后关闭 Vite 文件监听器。 */
after(async () => {
  await vite?.close();
});

/** 构造独立流水账数据库的最小合法 schema。 */
const createDataSource = () => ({
  object: "data_source",
  id: "journal-source",
  properties: {
    内容: { type: "title" },
    补充内容: { type: "rich_text" },
    素材: { type: "files" },
    嵌入链接: { type: "url" },
    发布时间: { type: "date" },
    创建时间: { type: "created_time" },
    隐藏: { type: "checkbox" },
  },
});

/** 构造带链接和换行的标准 Notion 富文本属性。 */
const richTextProperty = (type, values) => ({
  type,
  [type]: values.map(({ text, href = null }) => ({
    type: "text",
    plain_text: text,
    href,
    text: { content: text, link: href ? { url: href } : null },
    annotations: {},
  })),
});

/** 构造 Form 提交后的页面，允许覆盖隐藏、时间和素材。 */
const createPage = ({
  id = "journal-page",
  createdTime = "2026-07-20T01:00:00.000Z",
  hidden = false,
  files = [],
  embedUrl = "https://www.youtube.com/shorts/hHbEbYAwW0s",
  publishedAt = "2026-07-20",
} = {}) => ({
  object: "page",
  id,
  created_time: createdTime,
  last_edited_time: createdTime,
  url: `https://www.notion.so/${id}`,
  cover: null,
  properties: {
    内容: richTextProperty("title", [{ text: "今天把流水账改成了 Form" }]),
    补充内容: richTextProperty("rich_text", [
      { text: "第二行\n" },
      { text: "第三行", href: "https://example.com/details" },
    ]),
    素材: { type: "files", files },
    嵌入链接: { type: "url", url: embedUrl },
    发布时间: {
      type: "date",
      date: publishedAt ? { start: publishedAt } : null,
    },
    创建时间: { type: "created_time", created_time: createdTime },
    隐藏: { type: "checkbox", checkbox: hidden },
  },
});

/** 构造 Notion 托管的 Form 附件。 */
const file = (name) => ({
  name,
  type: "file",
  file: {
    url: `https://files.example/${encodeURIComponent(name)}?signature=temporary`,
    expiry_time: "2026-07-20T02:00:00.000Z",
  },
});

test("validates the dedicated journal schema and hidden-record query", () => {
  const names = resolveJournalPropertyNames();
  assert.doesNotThrow(() => validateJournalSchema(createDataSource(), names));
  assert.deepEqual(createVisibleJournalQuery(names).filter, {
    property: "隐藏",
    checkbox: { equals: false },
  });

  const malformed = createDataSource();
  malformed.properties.素材.type = "url";
  assert.throws(
    () => validateJournalSchema(malformed, names),
    /素材.*应为 files，实际为 url/,
  );
});

test("maps Form text, ordered media, and embed URL into flat feed blocks", () => {
  const entry = normalizeJournalPage(
    createPage({ files: [file("photo.png"), file("clip.mp4"), file("voice.mp3")] }),
    resolveJournalPropertyNames(),
  );

  assert.deepEqual(entry.blocks.map(({ type }) => type), [
    "paragraph",
    "paragraph",
    "paragraph",
    "image",
    "video",
    "audio",
    "embed",
  ]);
  assert.equal(entry.blocks[2].richText[0].href, "https://example.com/details");
  assert.equal(entry.blocks[3].image.alt, "photo.png");
  assert.equal(
    entry.blocks[3].image.cacheKey,
    "page:journal-page:journal-media:0:2026-07-20T01:00:00.000Z",
  );
  assert.equal(entry.blocks[4].video.source, "notion");
  assert.equal(entry.blocks[5].audio.expiryTime, "2026-07-20T02:00:00.000Z");
  assert.equal(entry.blocks[6].url, "https://www.youtube.com/shorts/hHbEbYAwW0s");
  assert.equal(entry.route, "/journal");
});

test("filters hidden records without ever requesting page blocks", async () => {
  let queryBody;
  const client = {
    retrieveDataSource: async () => createDataSource(),
    queryDataSource: async (body) => {
      queryBody = body;
      return [
        createPage({ id: "hidden", hidden: true }),
        createPage({ id: "visible-new", createdTime: "2026-07-20T03:00:00.000Z" }),
        createPage({ id: "visible-old", createdTime: "2026-07-20T01:00:00.000Z" }),
      ];
    },
  };

  const entries = await loadJournalContent({ client, media: false });
  assert.deepEqual(entries.map(({ id }) => id), ["visible-new", "visible-old"]);
  assert.deepEqual(queryBody.filter, {
    property: "隐藏",
    checkbox: { equals: false },
  });
});

test("sorts a Shanghai-after-midnight Form entry by its displayed date", async () => {
  const client = {
    retrieveDataSource: async () => createDataSource(),
    queryDataSource: async () => [
      createPage({
        id: "published-previous-day",
        createdTime: "2026-07-19T23:00:00.000Z",
        publishedAt: "2026-07-19",
      }),
      createPage({
        id: "form-next-day",
        createdTime: "2026-07-19T16:30:00.000Z",
        publishedAt: null,
      }),
    ],
  };

  const entries = await loadJournalContent({
    client,
    media: false,
    timeZone: "Asia/Shanghai",
  });
  assert.deepEqual(entries.map(({ id }) => id), [
    "form-next-day",
    "published-previous-day",
  ]);
});

test("allows an empty journal while the article loader keeps its fail-closed rule", async () => {
  const entries = await loadJournalContent({
    client: {
      retrieveDataSource: async () => createDataSource(),
      queryDataSource: async () => [],
    },
    media: false,
  });
  assert.deepEqual(entries, []);
});

test("rejects unsupported and ambiguous Form media with the original filename", () => {
  assert.throws(
    () =>
      normalizeJournalPage(
        createPage({ files: [file("archive.zip")] }),
        resolveJournalPropertyNames(),
      ),
    /archive\.zip.*格式不受支持/,
  );
  assert.throws(
    () =>
      normalizeJournalPage(
        createPage({ files: [file("recording.webm")] }),
        resolveJournalPropertyNames(),
      ),
    /recording\.webm.*无法区分音频或视频/,
  );
});

test("rejects unsafe embed URLs before rendering", () => {
  assert.throws(
    () =>
      normalizeJournalPage(
        createPage({ embedUrl: "http://example.com/embed" }),
        resolveJournalPropertyNames(),
      ),
    /嵌入链接.*必须是安全的 HTTPS 地址/,
  );
});

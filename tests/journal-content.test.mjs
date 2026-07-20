import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let getEntryHref;
let partitionJournalContent;

/** 通过项目自身的 Vite 编译链加载流水账内容模块。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ partitionJournalContent } = await vite.ssrLoadModule(
    "/src/content/journal-content.ts",
  ));
  ({ getEntryHref } = await vite.ssrLoadModule("/src/content/entry-href.ts"));
});

/** 测试结束后关闭文件监听器。 */
after(async () => {
  await vite?.close();
});

/** 构造只关心类型与子节点的最小内容块。 */
const block = (id, type, children = []) => ({
  id,
  type,
  richText: [],
  children,
});

test("separates journal text from direct and column media attachments", () => {
  const paragraph = block("paragraph", "paragraph");
  const image = block("image", "image");
  const gallery = block("gallery", "column_list", [
    block("column-one", "column", [block("column-image", "image")]),
    block("column-two", "column", [block("column-video", "video")]),
  ]);
  const mixedColumns = block("mixed", "column_list", [
    block("text-column", "column", [block("column-text", "paragraph")]),
    block("media-column", "column", [block("column-audio", "audio")]),
  ]);

  const result = partitionJournalContent([paragraph, image, gallery, mixedColumns]);

  assert.deepEqual(result.textBlocks.map(({ id }) => id), ["paragraph", "mixed"]);
  assert.deepEqual(result.attachmentBlocks.map(({ id }) => id), ["image", "gallery"]);
});

test("keeps one public feed URL for every journal entry", () => {
  assert.equal(getEntryHref({ category: "journal", route: "/journal/private-thought" }), "/journal/");
  assert.equal(getEntryHref({ category: "works", route: "/works/example" }), "/works/example/");
});

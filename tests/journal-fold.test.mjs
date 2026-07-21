import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let groupJournalTextRects;
let measureJournalTextCollapse;

/** 通过项目编译链读取浏览器和服务端共用的折叠计算。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ groupJournalTextRects, measureJournalTextCollapse } = await vite.ssrLoadModule(
    "/src/lib/journal-fold.ts",
  ));
});

/** 测试完成后关闭 Vite 文件监听器。 */
after(async () => {
  await vite?.close();
});

/** 创建只包含折叠计算所需坐标的文字片段。 */
const rect = (top, bottom, width = 80) => ({
  top,
  bottom,
  width,
  height: bottom - top,
});

test("merges rich-text fragments that share one visual line", () => {
  assert.deepEqual(
    groupJournalTextRects([
      rect(10, 28, 40),
      rect(11, 27, 35),
      rect(42, 60, 70),
      rect(42, 60, 0),
    ]),
    [
      { top: 10, bottom: 28 },
      { top: 42, bottom: 60 },
    ],
  );
});

test("keeps three or fewer visual lines fully expanded", () => {
  const result = measureJournalTextCollapse(
    [rect(110, 128), rect(146, 164), rect(200, 218)],
    100,
  );

  assert.deepEqual(result, {
    lineCount: 3,
    shouldCollapse: false,
    collapsedHeight: 0,
    fadeHeight: 0,
  });
});

test("clips after the third visual line even when paragraphs have uneven gaps", () => {
  const result = measureJournalTextCollapse(
    [rect(110, 128), rect(152, 170), rect(214, 234), rect(250, 268)],
    100,
  );

  assert.deepEqual(result, {
    lineCount: 4,
    shouldCollapse: true,
    collapsedHeight: 134,
    fadeHeight: 20,
  });
});

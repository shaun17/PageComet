import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTORY_PREVIEW_LIMIT,
  getDirectoryTitle,
  selectDirectoryPreviewEntries,
} from "../src/content/directory-preview.mjs";

/** 生成带稳定编号的目录条目，便于同时检查数量、顺序与输入不可变。 */
const createEntries = (count) =>
  Array.from({ length: count }, (_, index) => ({ id: `entry-${index + 1}` }));

test("keeps at most four ordered entries in every directory preview", () => {
  assert.equal(DIRECTORY_PREVIEW_LIMIT, 4);

  for (const count of [0, 1, 4, 5, 6]) {
    const entries = createEntries(count);
    const original = structuredClone(entries);
    const preview = selectDirectoryPreviewEntries(entries);

    assert.equal(preview.length, Math.min(count, DIRECTORY_PREVIEW_LIMIT));
    assert.deepEqual(
      preview.map((entry) => entry.id),
      entries.slice(0, DIRECTORY_PREVIEW_LIMIT).map((entry) => entry.id),
    );
    assert.deepEqual(entries, original, "生成目录预览不得修改内容源顺序");
  }
});

test("shows only the lead title before a subtitle colon in narrow directories", () => {
  assert.equal(getDirectoryTitle("Mirage：把图片素材带进 macOS 文件选择器"), "Mirage");
  assert.equal(getDirectoryTitle("memoLite 架构解析：SQLite 与向量检索"), "memoLite 架构解析");
  assert.equal(getDirectoryTitle("PageComet: a ready-made site"), "PageComet");
  // 没有副标题、主标题过短或冒号不是分隔符时保持原样。
  assert.equal(getDirectoryTitle("Atlas Notes"), "Atlas Notes");
  assert.equal(getDirectoryTitle("A：短"), "A：短");
  assert.equal(getDirectoryTitle("10:30 的会议"), "10:30 的会议");
});

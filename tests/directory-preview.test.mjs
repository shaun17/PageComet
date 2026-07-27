import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTORY_PREVIEW_LIMIT,
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

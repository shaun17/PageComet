import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let formatJournalTimestamp;
let readJournalCalendarDate;

/** 通过项目编译链读取 TypeScript 时间工具，避免测试复制实现。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ formatJournalTimestamp, readJournalCalendarDate } = await vite.ssrLoadModule(
    "/src/lib/journal-time.ts",
  ));
});

/** 测试完成后关闭 Vite 文件监听器。 */
after(async () => {
  await vite?.close();
});

test("keeps a date-only journal value on its original calendar day", () => {
  assert.equal(
    formatJournalTimestamp("2026-07-19", "zh-CN", "Asia/Shanghai"),
    "2026.07.19",
  );
});

test("converts a Form created_time across the Shanghai date boundary", () => {
  assert.equal(
    formatJournalTimestamp("2026-07-19T16:30:00.000Z", "zh-CN", "Asia/Shanghai"),
    "2026.07.20 00:30",
  );
});

test("uses the same Shanghai calendar date for sorting and display", () => {
  assert.equal(
    readJournalCalendarDate("2026-07-19T16:30:00.000Z", "Asia/Shanghai"),
    "2026-07-20",
  );
});

test("rejects malformed timestamp values", () => {
  assert.throws(
    () => formatJournalTimestamp("not-a-time", "zh-CN", "Asia/Shanghai"),
    /格式无效/,
  );
});

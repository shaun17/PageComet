import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesUrl = new URL("../src/styles/article.css", import.meta.url);

/** 正文栏精确放宽 25%，并让文章各层级继续共享同一条阅读轴。 */
test("keeps the wider article reading column visually unified", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const shellRule = styles.match(/\.article-shell\s*\{([\s\S]*?)\n\}/)?.[1];
  const headerRule = styles.match(/\.article-header\s*\{([\s\S]*?)\n\}/)?.[1];
  const titleRule = styles.match(
    /\.article-header h1\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  const summaryRule = styles.match(
    /\.article-summary\s*\{([\s\S]*?)\n\}/,
  )?.[1];

  assert.ok(shellRule);
  assert.ok(headerRule);
  assert.ok(titleRule);
  assert.ok(summaryRule);
  assert.match(shellRule, /--article-content-width:\s*57\.5rem;/);
  assert.match(shellRule, /--article-header-width:\s*60rem;/);
  assert.match(headerRule, /width:\s*100%;/);
  assert.match(headerRule, /max-width:\s*var\(--article-header-width\);/);
  assert.match(titleRule, /max-width:\s*min\(100%, 18em\);/);
  assert.match(titleRule, /font-size:\s*clamp\(2\.5rem, 4vw, 4rem\);/);
  assert.match(titleRule, /line-height:\s*1\.08;/);
  assert.match(titleRule, /text-wrap:\s*balance;/);
  assert.doesNotMatch(titleRule, /max-width:[^;]*ch;/);
  assert.match(summaryRule, /max-width:\s*min\(100%, 36em\);/);
  assert.match(summaryRule, /line-height:\s*1\.72;/);
  assert.match(summaryRule, /text-wrap:\s*pretty;/);
  assert.doesNotMatch(summaryRule, /max-width:[^;]*ch;/);
  /* 分隔线、项目入口、媒体、正文与返回导航必须整体加宽，避免再次出现局部半栏。 */
  for (const selector of [
    ".article-divider",
    ".project-links",
    ".article-cover",
    ".notion-content",
    ".article-return",
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      styles,
      new RegExp(
        `${escapedSelector}\\s*\\{[^}]*max-width:\\s*var\\(--article-content-width\\);`,
        "s",
      ),
      `${selector} 应共享放宽后的文章阅读宽度`,
    );
  }

  const compactRules = styles.match(
    /@media \(max-width: 600px\)\s*\{([\s\S]*)\n\}/,
  )?.[1];
  assert.ok(compactRules);
  assert.match(
    compactRules,
    /\.article-header h1\s*\{[^}]*font-size:\s*clamp\(2\.25rem, 9\.5vw, 2\.5rem\);[^}]*line-height:\s*1\.1;/s,
  );
});

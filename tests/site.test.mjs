import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const buildRoot = new URL("../dist/", import.meta.url);
const expectedNotionUrls = [
  "https://wenmsg.notion.site/2c8f211130e480698093c9f3e459cf19",
  "https://wenmsg.notion.site/3a1f211130e48082bf84ec966fa08140",
  "https://wenmsg.notion.site/3a1f211130e480b0b3e1c8c30b902517",
  "https://wenmsg.notion.site/QTrade-3a1f211130e4800d8a5bc3fb3ffeaaf2?pvs=25",
  "https://wenmsg.notion.site/Kingdee-3a1f211130e480608e16f7a50c77c42b?pvs=25",
  "https://wenmsg.notion.site/CoolBox-3a1f211130e48038a132d55dbbfcc6e3?pvs=25",
  "https://wenmsg.notion.site/1c0f211130e480218e58e66af61f09e2?pvs=25",
  "https://wenmsg.notion.site/Petly-Care-2c8f211130e480918bdfec198e501273?pvs=25",
  "https://wenmsg.notion.site/retimeber-1aff211130e4808d9511f5cddb8d8a30?pvs=25",
  "https://wenmsg.notion.site/IDPhotoMaker-IOS-APP-133f211130e4808d9df7ecb870a4ca84?pvs=25",
];

// 读取真实构建产物，避免只验证未经处理的源码。
async function loadBuild() {
  const [html, headers, assetNames] = await Promise.all([
    readFile(new URL("index.html", buildRoot), "utf8"),
    readFile(new URL("_headers", buildRoot), "utf8"),
    readdir(new URL("assets/", buildRoot)),
  ]);
  const cssName = assetNames.find((name) => name.endsWith(".css"));
  assert.ok(cssName, "构建结果应包含 CSS 文件");

  return {
    html,
    headers,
    css: await readFile(new URL(`assets/${cssName}`, buildRoot), "utf8"),
  };
}

// 提取完整的 Notion 链接标签，逐项验证地址与新窗口安全属性。
function extractNotionAnchors(html) {
  return (html.match(/<a\b[^>]*>/gi) ?? []).filter((tag) =>
    tag.includes("https://wenmsg.notion.site/"),
  );
}

// 首页必须保留完整内容、三列语义以及安全的 Notion 外链。
test("builds the complete personal homepage", async () => {
  const { html, css } = await loadBuild();

  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>Wenren — 软件工程师与独立开发者<\/title>/i);
  assert.match(html, /Wenren 在做/);
  assert.match(html, /职业经历/);
  assert.match(html, /个人作品/);
  assert.match(html, /流水账/);
  assert.match(html, /QTrade/);
  assert.match(html, /Kingdee/);
  assert.match(html, /CoolBox/);
  assert.match(html, /Petly Care/);
  assert.match(html, /IDPhotoMaker/);
  const notionAnchors = extractNotionAnchors(html);
  assert.equal(notionAnchors.length, 14);
  for (const anchor of notionAnchors) {
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }

  const actualUrls = [
    ...new Set(
      notionAnchors.map((anchor) => anchor.match(/href="([^"]+)"/)?.[1]),
    ),
  ].filter(Boolean);
  assert.deepEqual(actualUrls.sort(), expectedNotionUrls.toSorted());
  assert.doesNotMatch(html, /_next|vinext|codex-preview|react-loading-skeleton/i);
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /font-family:Geist/);
});

// Pages 配置和响应头必须随构建结果一起交付。
test("keeps Cloudflare Pages configuration deployable", async () => {
  const [{ headers }, wrangler] = await Promise.all([
    loadBuild(),
    readFile(new URL("wrangler.jsonc", projectRoot), "utf8"),
    access(new URL("favicon.svg", buildRoot)),
    access(new URL("fonts/geist-98bbbccb.woff2", buildRoot)),
    access(new URL("fonts/geist-mono-013b2f2f.woff2", buildRoot)),
  ]);

  assert.match(wrangler, /"name": "wenren-home"/);
  assert.match(wrangler, /"pages_build_output_dir": "\.\/dist"/);
  assert.match(wrangler, /"compatibility_date": "2026-07-18"/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/fonts\/\*/);
});

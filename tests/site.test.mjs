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

// 按目标地址找到完整链接标签，确保联系入口不会在构建中丢失属性。
function extractAnchorByHref(html, href) {
  return (html.match(/<a\b[^>]*>/gi) ?? []).find((tag) =>
    tag.includes(`href="${href}"`),
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
  assert.match(html, /<nav class="contact-links" aria-label="联系方式">/i);
  const contactMarkup = html.match(
    /<nav class="contact-links"[^>]*>([\s\S]*?)<\/nav>/i,
  )?.[1];
  assert.ok(contactMarkup, "页面应包含完整的联系导航");
  assert.equal((contactMarkup.match(/<a\b[^>]*>/gi) ?? []).length, 2);
  assert.match(contactMarkup, />X<\/a>/);
  assert.match(contactMarkup, />Mail<\/a>/);
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

  const xAnchor = extractAnchorByHref(html, "https://x.com/thisiswenren");
  const mailAnchor = extractAnchorByHref(html, "mailto:wenrencc@gmail.com");
  assert.ok(xAnchor, "页面应包含 X 联系按钮");
  assert.match(xAnchor, /target="_blank"/);
  assert.match(xAnchor, /rel="noopener noreferrer"/);
  assert.match(xAnchor, /aria-label="在 X 上查看 Wenren"/);
  assert.ok(mailAnchor, "页面应包含 Mail 联系按钮");
  assert.match(mailAnchor, /aria-label="发送邮件至 wenrencc@gmail.com"/);
  assert.doesNotMatch(mailAnchor, /target=/);
  assert.match(html, /<!--email_off-->\s*<a href="mailto:wenrencc@gmail.com"/);
  assert.match(html, /Mail<\/a>\s*<!--\/email_off-->/);
  assert.doesNotMatch(html, /_next|vinext|codex-preview|react-loading-skeleton/i);
  assert.match(css, /prefers-color-scheme:dark/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /font-family:Geist/);
  assert.match(css, /\.contact-links a\{/);
  assert.match(css, /min-height:2\.75rem/);
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

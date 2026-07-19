import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const buildRoot = new URL("../dist/", import.meta.url);
const legacyExternalUrls = [
  "https://wenmsg.notion.site/QTrade-3a1f211130e4800d8a5bc3fb3ffeaaf2?pvs=25",
  "https://wenmsg.notion.site/Kingdee-3a1f211130e480608e16f7a50c77c42b?pvs=25",
  "https://wenmsg.notion.site/CoolBox-3a1f211130e48038a132d55dbbfcc6e3?pvs=25",
  "https://wenmsg.notion.site/1c0f211130e480218e58e66af61f09e2?pvs=25",
  "https://wenmsg.notion.site/Petly-Care-2c8f211130e480918bdfec198e501273?pvs=25",
  "https://wenmsg.notion.site/retimeber-1aff211130e4808d9511f5cddb8d8a30?pvs=25",
  "https://wenmsg.notion.site/IDPhotoMaker-IOS-APP-133f211130e4808d9df7ecb870a4ca84?pvs=25",
  "https://wenmsg.notion.site/3a1f211130e480b0b3e1c8c30b902517",
];
const expectedInternalRoutes = [
  "/career/qtrade/",
  "/career/kingdee/",
  "/career/coolbox/",
  "/works/client-development-experiments/",
  "/works/petly-care/",
  "/works/retimeber/",
  "/works/id-photo-maker/",
  "/journal/journal/",
];

/** 读取某个静态路由的最终 HTML，而不是只验证 Astro 源码。 */
const readRoute = (path = "index.html") => readFile(new URL(path, buildRoot), "utf8");

/** 从压缩后的页面中提取锚点，逐项验证链接安全属性。 */
const extractAnchors = (html) => html.match(/<a\b[^>]*>/gi) ?? [];

/** 按 href 精确查找构建后的链接标签。 */
const findAnchor = (html, href) =>
  extractAnchors(html).find((anchor) => anchor.includes(`href="${href}"`));

/** 首页保持极简三列，并且原有内容和联系入口没有丢失。 */
test("builds the complete three-column homepage", async () => {
  const html = await readRoute();

  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>WENREN<\/title>/);
  assert.match(html, /WENRENHAO \/ Software Engineer/);
  assert.match(html, /wenren 在做/);
  assert.match(html, /<section class="home-information" aria-label="个人信息">/);
  assert.doesNotMatch(html, /class="hero-details"/);
  assert.match(
    html,
    /<div class="hero-meta" aria-label="个人简介"><p>软件工程师，正在成为独立开发者。写代码，做产品，也记录日常。<\/p><p>喜欢运动与健身。也在结识更多有趣的朋友。<\/p><\/div>/,
  );
  assert.match(html, /class="decimal-year" data-decimal-year/);
  assert.match(html, /YEAR \/ /);
  assert.match(html, /data-decimal-year-value[^>]*>\d{4}\.\d{18}</);
  assert.match(html, /<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(html, /偶尔记录生活、想法和正在发生的事。/);
  assert.equal((html.match(/class="directory-column"/g) ?? []).length, 3);
  assert.ok(findAnchor(html, "/career/"));
  assert.ok(findAnchor(html, "/works/"));
  assert.ok(findAnchor(html, "/journal/"));

  for (const href of expectedInternalRoutes) {
    const anchor = findAnchor(html, href);
    assert.ok(anchor, `首页应指向站内静态详情页：${href}`);
    assert.doesNotMatch(anchor, /target=/);
  }

  for (const href of legacyExternalUrls) {
    assert.equal(findAnchor(html, href), undefined, `首页不应继续跳转旧 Notion 地址：${href}`);
  }

  const xAnchor = findAnchor(html, "https://x.com/thisiswenren");
  const mailAnchor = findAnchor(html, "mailto:wenrencc@gmail.com");
  assert.ok(xAnchor);
  assert.match(xAnchor, /target="_blank"/);
  assert.ok(mailAnchor);
  assert.doesNotMatch(mailAnchor, /target=/);
  assert.match(html, /<!--email_off--><a href="mailto:wenrencc@gmail.com"/);
  assert.match(html, /Mail<\/a><!--\/email_off-->/);
});

/** 三个分类页统一由内容数据生成，全部条目都具有站内静态详情页。 */
test("builds category indexes and an internal article", async () => {
  await Promise.all(
    expectedInternalRoutes.map((route) =>
      access(new URL(`${route.slice(1)}index.html`, buildRoot)),
    ),
  );

  const [career, works, journal, article, migratedCareer, migratedWork, migratedJournal] =
    await Promise.all([
      readRoute("career/index.html"),
      readRoute("works/index.html"),
      readRoute("journal/index.html"),
      readRoute("journal/writing-with-notion/index.html"),
      readRoute("career/qtrade/index.html"),
      readRoute("works/petly-care/index.html"),
      readRoute("journal/journal/index.html"),
    ]);

  for (const html of [career, works, journal, article, migratedCareer, migratedWork, migratedJournal]) {
    assert.match(html, /<title>WENREN<\/title>/);
  }

  assert.match(career, /01 \/ CAREER/);
  assert.match(career, /QTrade/);
  assert.match(career, /Kingdee/);
  assert.match(career, /CoolBox/);
  assert.match(works, /02 \/ WORKS/);
  assert.match(works, /Petly Care/);
  assert.match(works, /IDPhotoMaker/);
  assert.match(journal, /03 \/ JOURNAL/);
  assert.ok(findAnchor(journal, "/journal/writing-with-notion/"));
  assert.ok(findAnchor(career, "/career/qtrade/"));
  assert.ok(findAnchor(works, "/works/petly-care/"));
  assert.ok(findAnchor(journal, "/journal/journal/"));

  assert.match(migratedCareer, /<h1>QTrade<\/h1>/);
  assert.match(migratedCareer, /软件工程与交易系统相关的职业经历。/);
  assert.match(migratedWork, /<h1>Petly Care<\/h1>/);
  assert.match(migratedJournal, /<h1>流水账<\/h1>/);

  assert.match(article, /<h1>用 Notion 写一篇文章<\/h1>/);
  assert.match(article, /class="notion-content"/);
  assert.match(article, /<ul><li>/);
  assert.match(article, /<blockquote>/);
  const bookmarkAnchor = findAnchor(article, "https://example.com/reference");
  assert.ok(bookmarkAnchor);
  assert.match(bookmarkAnchor, /target="_blank"/);
  assert.match(article, /<pre><code data-language="shell">/);
  assert.match(article, /<details><summary>/);
  assert.match(
    article,
    /<img src="\/notion-assets\/8550ce349fe18c2784edf8e4c798ede1e4062dca7607cd79a3bc00a63afa54a6\.gif" alt="动态操作演示" loading="lazy" decoding="async">/,
  );
  assert.match(
    article,
    /<video src="\/notion-assets\/7e2817c0d96668fedb7bafd028b897d8ab82d81a433250f25452a4c818796f70\.mp4" controls playsinline preload="none" aria-label="Notion 上传视频"[^>]*>/,
  );
  assert.match(article, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(article, /src="https:\/\/player\.vimeo\.com\/video\/226053498\?h=a1599a8ee9"/);
  assert.equal((article.match(/allowfullscreen/g) ?? []).length, 2);
  assert.match(article, /href="https:\/\/wenren\.cc\/journal\/writing-with-notion\/"/);
  const internalArticleAnchor = findAnchor(article, "/journal/writing-with-notion/");
  assert.ok(internalArticleAnchor);
  assert.doesNotMatch(internalArticleAnchor, /target=/);
  assert.doesNotMatch(article, /www\.notion\.so\/11111111222233334444555555555555/);
  const migratedEntryAnchor = findAnchor(article, "/career/qtrade/");
  assert.ok(migratedEntryAnchor);
  assert.doesNotMatch(migratedEntryAnchor, /target=/);
  assert.equal(
    extractAnchors(article).filter((anchor) => anchor.includes('href="/career/qtrade/"')).length,
    3,
  );
  assert.doesNotMatch(article, /wenmsg\.notion\.site/);
  assert.doesNotMatch(article, /<script>alert\("xss"\)<\/script>/);
  assert.match(article, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(article, /javascript:alert/);
  await assert.rejects(access(new URL("journal/start-here/index.html", buildRoot)));
});

/** 正式产物不能泄漏 Notion 凭据或一小时后失效的临时资源地址。 */
test("keeps generated files static and credential-free", async () => {
  const names = await readdir(buildRoot, { recursive: true });
  const readableNames = names.filter((name) => /\.(?:html|css|js)$/i.test(name));
  const contents = await Promise.all(
    readableNames.map((name) => readFile(new URL(name, buildRoot), "utf8")),
  );
  const output = contents.join("\n");

  assert.doesNotMatch(output, /NOTION_TOKEN|Bearer\s+secret_/i);
  assert.doesNotMatch(output, /X-Amz-(?:Algorithm|Credential|Signature)/i);
  assert.doesNotMatch(output, /secure\.notion-static\.com|notionusercontent\.com/i);
  assert.doesNotMatch(output, /https:\/\/[^/"']+\.notion\.site\//i);
  assert.doesNotMatch(output, /_next|codex-preview|react-loading-skeleton/i);
});

/** Cloudflare Pages 配置、缓存响应头和本地字体随构建一起交付。 */
test("keeps Cloudflare Pages configuration deployable", async () => {
  const [headers, wrangler, packageJson, cssNames] = await Promise.all([
    readRoute("_headers"),
    readFile(new URL("wrangler.jsonc", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
    readdir(new URL("_astro/", buildRoot)),
    access(new URL("favicon.svg", buildRoot)),
    access(new URL("fonts/geist-98bbbccb.woff2", buildRoot)),
    access(new URL("fonts/geist-mono-013b2f2f.woff2", buildRoot)),
  ]);
  const cssFile = cssNames.find((name) => name.endsWith(".css"));
  assert.ok(cssFile);
  const css = await readFile(new URL(`_astro/${cssFile}`, buildRoot), "utf8");

  assert.match(wrangler, /"name": "wenren-home"/);
  assert.match(wrangler, /"pages_build_output_dir": "\.\/dist"/);
  assert.match(packageJson, /"build": "CONTENT_SOURCE=notion astro build"/);
  assert.match(packageJson, /wrangler pages deploy dist/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /script-src 'self' https:\/\/static\.cloudflareinsights\.com/);
  assert.match(headers, /connect-src 'self' https:\/\/cloudflareinsights\.com/);
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/_astro\/\*/);
  assert.match(headers, /\/notion-assets\/\*/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /--surface-subtle:/);
  assert.match(css, /prefers-color-scheme:dark/);
});

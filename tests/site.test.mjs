import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { siteConfig } from "../src/config/site-config.mjs";

const projectRoot = new URL("../", import.meta.url);
const buildRoot = new URL("../dist/", import.meta.url);
const expectedInternalRoutes = [
  "/career/northstar-studio/",
  "/career/beacon-labs/",
  "/works/atlas-notes/",
  "/works/focus-timer/",
  "/works/pocket-gallery/",
  "/journal/a-city-walk/",
];

/** 读取某个静态路由的最终 HTML，而不是只验证 Astro 源码。 */
const readRoute = (path = "index.html") => readFile(new URL(path, buildRoot), "utf8");

/** 从压缩后的页面中提取锚点，逐项验证链接安全属性。 */
const extractAnchors = (html) => html.match(/<a\b[^>]*>/gi) ?? [];

/** 按 href 精确查找构建后的链接标签。 */
const findAnchor = (html, href) =>
  extractAnchors(html).find((anchor) => anchor.includes(`href="${href}"`));

/** 把公开配置文字转换为 HTML 文本节点中的安全表示。 */
const escapeHtmlText = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** 首页保持极简三列，并且原有内容和联系入口没有丢失。 */
test("builds the complete three-column homepage", async () => {
  const html = await readRoute();

  assert.ok(html.includes(`<html lang="${siteConfig.locale}">`));
  assert.ok(html.includes(`<title>${escapeHtmlText(siteConfig.brand.browserTitle)}</title>`));
  assert.ok(html.includes(escapeHtmlText(siteConfig.brand.kicker)));
  assert.ok(html.includes(escapeHtmlText(siteConfig.home.headline.prefix)));
  assert.match(html, /<section class="home-information" aria-label="个人信息">/);
  assert.doesNotMatch(html, /class="hero-details"/);
  for (const paragraph of siteConfig.home.biography) {
    assert.ok(html.includes(escapeHtmlText(paragraph)));
  }
  assert.match(html, /class="decimal-year" data-decimal-year tabindex="0"/);
  assert.match(html, /YEAR \/ /);
  assert.match(html, /data-decimal-year-value[^>]*>\d{4}\.\d{18}</);
  assert.match(html, /data-decimal-year-remaining[^>]*>\s*\d{18,19}\.\d{4}\s*</);
  assert.match(html, /距离 \d{4} 年还有 \d+\.\d{2}%/);
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

  for (const contact of siteConfig.contacts) {
    const anchor = findAnchor(html, contact.href);
    assert.ok(anchor, `首页应包含联系方式：${contact.key}`);
    if (contact.external) assert.match(anchor, /target="_blank"/);
    else assert.doesNotMatch(anchor, /target=/);
  }
  const inspirationAnchor = findAnchor(html, siteConfig.designCredit.href);
  assert.ok(inspirationAnchor);
  assert.match(inspirationAnchor, /target="_blank"/);
  assert.match(inspirationAnchor, /rel="noopener noreferrer"/);
  assert.ok(html.includes(escapeHtmlText(siteConfig.designCredit.prefix)));
  assert.ok(html.includes(escapeHtmlText(siteConfig.designCredit.label)));
  assert.match(html, /<!--email_off-->/);
  assert.match(html, /<!--\/email_off-->/);
});

/** 三个分类页统一由内容数据生成，全部条目都具有站内静态详情页。 */
test("builds category indexes and an internal article", async () => {
  await Promise.all(
    expectedInternalRoutes.map((route) =>
      access(new URL(`${route.slice(1)}index.html`, buildRoot)),
    ),
  );

  const [career, works, journal, article, exampleCareer, exampleWork, exampleJournal] =
    await Promise.all([
      readRoute("career/index.html"),
      readRoute("works/index.html"),
      readRoute("journal/index.html"),
      readRoute("journal/writing-with-notion/index.html"),
      readRoute("career/northstar-studio/index.html"),
      readRoute("works/atlas-notes/index.html"),
      readRoute("journal/a-city-walk/index.html"),
    ]);

  for (const html of [career, works, journal, article, exampleCareer, exampleWork, exampleJournal]) {
    assert.ok(html.includes(`<title>${escapeHtmlText(siteConfig.brand.browserTitle)}</title>`));
    assert.ok(findAnchor(html, siteConfig.designCredit.href));
  }

  assert.match(career, /01 \/ CAREER/);
  assert.match(career, /Northstar Studio/);
  assert.match(career, /Beacon Labs/);
  assert.match(works, /02 \/ WORKS/);
  assert.match(works, /Atlas Notes/);
  assert.match(works, /Focus Timer/);
  assert.match(works, /Pocket Gallery/);
  assert.match(journal, /03 \/ JOURNAL/);
  assert.ok(findAnchor(journal, "/journal/writing-with-notion/"));
  assert.ok(findAnchor(career, "/career/northstar-studio/"));
  assert.ok(findAnchor(works, "/works/atlas-notes/"));
  assert.ok(findAnchor(journal, "/journal/a-city-walk/"));

  assert.match(exampleCareer, /<h1>Northstar Studio<\/h1>/);
  assert.match(exampleCareer, /负责设计系统与核心产品体验的职业经历。/);
  assert.match(exampleWork, /<h1>Atlas Notes<\/h1>/);
  assert.match(exampleJournal, /<h1>一段城市散步<\/h1>/);

  assert.match(article, /<h1>用 Notion 写一篇文章<\/h1>/);
  assert.match(article, /class="notion-content"/);
  assert.match(article, /<ul><li>/);
  assert.match(article, /<blockquote>/);
  const bookmarkAnchor = findAnchor(article, "https://example.com/reference");
  assert.ok(bookmarkAnchor);
  assert.match(bookmarkAnchor, /target="_blank"/);
  assert.match(bookmarkAnchor, /class="notion-mention notion-mention-external"/);
  assert.match(article, /<pre><code data-language="shell">/);
  assert.match(article, /<details><summary>/);
  assert.match(
    article,
    /<img src="\/notion-assets\/8550ce349fe18c2784edf8e4c798ede1e4062dca7607cd79a3bc00a63afa54a6\.gif" alt="动态操作演示" loading="lazy" decoding="async" data-notion-image-unmeasured>/,
  );
  assert.match(
    article,
    /<div class="notion-columns"><section><figure class="notion-image notion-image-portrait"><a class="notion-image-link"[^>]*><img src="\/notion-assets\/ecd0cd4178539f17f752b77ff7ae77fcec37da042bebd8ca274cbea71d4d4205\.png" alt="竖屏截图一" width="360" height="780"/,
  );
  assert.equal(
    (article.match(/class="notion-image notion-image-portrait"/g) ?? []).length,
    2,
  );
  assert.match(
    article,
    /<video src="\/notion-assets\/7e2817c0d96668fedb7bafd028b897d8ab82d81a433250f25452a4c818796f70\.mp4" controls playsinline preload="none" aria-label="Notion 上传视频"[^>]*>/,
  );
  assert.match(article, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(article, /src="https:\/\/player\.vimeo\.com\/video\/226053498\?h=a1599a8ee9"/);
  assert.equal((article.match(/allowfullscreen/g) ?? []).length, 2);
  assert.ok(
    article.includes(
      `href="${siteConfig.origin}/journal/writing-with-notion/"`,
    ),
  );
  const internalArticleAnchor = findAnchor(article, "/journal/writing-with-notion/");
  assert.ok(internalArticleAnchor);
  assert.doesNotMatch(internalArticleAnchor, /target=/);
  assert.match(internalArticleAnchor, /class="notion-mention notion-mention-internal"/);
  assert.doesNotMatch(article, /www\.notion\.so\/11111111222233334444555555555555/);
  const relatedEntryAnchor = findAnchor(article, "/career/northstar-studio/");
  assert.ok(relatedEntryAnchor);
  assert.doesNotMatch(relatedEntryAnchor, /target=/);
  assert.match(relatedEntryAnchor, /class="notion-mention notion-mention-internal"/);
  const externalMentionAnchor = findAnchor(
    article,
    "https://example.com/product?source=notion",
  );
  assert.ok(externalMentionAnchor);
  assert.match(externalMentionAnchor, /class="notion-mention notion-mention-external"/);
  assert.match(externalMentionAnchor, /target="_blank"/);
  assert.match(externalMentionAnchor, /rel="noopener noreferrer"/);
  assert.match(externalMentionAnchor, /aria-describedby="notion-link-preview-\d+-1"/);
  assert.match(
    article,
    /<span class="notion-mention-mark" aria-hidden="true">↗<\/span><span class="notion-mention-label">示例产品<\/span>/,
  );
  assert.match(
    article,
    /class="notion-link-preview-a11y" hidden>Example。用于验证正文链接摘要/,
  );
  assert.match(article, /class="notion-link-preview" aria-hidden="true"/);
  assert.doesNotMatch(article, /role="tooltip"/);
  assert.match(article, /用于验证正文链接摘要、站点名称和安全外链属性的构建夹具。/);
  const standalonePreviewAnchor = findAnchor(
    article,
    "https://example.com/product?source=standalone",
  );
  assert.ok(standalonePreviewAnchor);
  assert.match(standalonePreviewAnchor, /aria-describedby="notion-link-preview-external-standalone-link"/);
  assert.equal((article.match(/class="notion-link notion-link-card"/g) ?? []).length, 2);
  assert.match(article, /独立链接会像 Notion 一样直接展示标题、来源与简短摘要。/);
  assert.equal(
    extractAnchors(article).filter((anchor) => anchor.includes('href="/career/northstar-studio/"')).length,
    3,
  );
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
test("keeps Cloudflare Pages Direct Upload configuration deployable", async () => {
  const [headers, packageJson, deployScript, license, cssNames] = await Promise.all([
    readRoute("_headers"),
    readFile(new URL("package.json", projectRoot), "utf8"),
    readFile(new URL("scripts/deploy.mjs", projectRoot), "utf8"),
    readFile(new URL("LICENSE", projectRoot), "utf8"),
    readdir(new URL("_astro/", buildRoot)),
    access(new URL("favicon.svg", buildRoot)),
    access(new URL("fonts/geist-98bbbccb.woff2", buildRoot)),
    access(new URL("fonts/geist-mono-013b2f2f.woff2", buildRoot)),
  ]);
  const cssFile = cssNames.find((name) => name.endsWith(".css"));
  assert.ok(cssFile);
  const css = await readFile(new URL(`_astro/${cssFile}`, buildRoot), "utf8");

  assert.match(packageJson, /"build": "cross-env CONTENT_SOURCE=notion astro build"/);
  assert.match(packageJson, /"deploy": "node --env-file-if-exists=\.env scripts\/deploy\.mjs"/);
  assert.match(deployScript, /"pages",\s*"deploy"/);
  assert.match(deployScript, /deployment\.pagesProject/);
  assert.doesNotMatch(deployScript, /--env-file/);
  assert.match(license, /^MIT License/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /script-src 'self' https:\/\/static\.cloudflareinsights\.com/);
  assert.match(headers, /connect-src 'self' https:\/\/cloudflareinsights\.com/);
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/_astro\/\*/);
  assert.match(headers, /\/notion-assets\/\*/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /border-block:1px solid var\(--line-strong\)/);
  assert.match(css, /content:"→"/);
  assert.doesNotMatch(css, /\.decimal-year:hover\{color:/);
  assert.match(css, /\.decimal-year:hover \.decimal-year-progress\{opacity:0\}/);
  assert.match(css, /\.decimal-year:hover \.decimal-year-remaining\{opacity:1\}/);
  assert.match(
    css,
    /\.hero h1 a:hover,\.hero h1 a:focus-visible\{color:var\(--text-muted\)\}/,
  );
  assert.match(
    css,
    /\.hero h1 a:hover:after,\.hero h1 a:focus-visible:after\{transform-origin:100%;transform:scaleX\(0\)\}/,
  );
  assert.match(css, /--surface-subtle:/);
  const mentionRule = css.match(/\.notion-content \.notion-mention\{([^}]*)\}/)?.[1];
  assert.ok(mentionRule);
  assert.match(mentionRule, /display:inline-flex/);
  assert.match(mentionRule, /max-width:100%/);
  assert.match(mentionRule, /background:var\(--surface-subtle\)/);
  const mentionLabelRule = css.match(
    /\.notion-content \.notion-mention-label\{([^}]*)\}/,
  )?.[1];
  assert.ok(mentionLabelRule);
  assert.match(mentionLabelRule, /min-width:0/);
  assert.match(mentionLabelRule, /overflow-wrap:anywhere/);
  assert.match(
    css,
    /\.notion-content a\.notion-mention:hover\{border-color:var\(--line-strong\);/,
  );
  const linkRule = css.match(/\.notion-content \.notion-link\{([^}]*)\}/)?.[1];
  assert.ok(linkRule);
  assert.match(linkRule, /display:grid/);
  assert.match(linkRule, /width:min\(22rem,100%\)/);
  const linkCardRule = css.match(/\.notion-content \.notion-link-card\{([^}]*)\}/)?.[1];
  assert.ok(linkCardRule);
  assert.match(linkCardRule, /display:grid/);
  assert.match(linkCardRule, /width:min\(34rem,100%\)/);
  const linkPreviewRule = css.match(
    /\.notion-content \.notion-link-preview\{([^}]*)\}/,
  )?.[1];
  assert.ok(linkPreviewRule);
  assert.match(linkPreviewRule, /display:grid/);
  assert.match(css, /\.notion-content \.notion-link-preview-summary\{/);
  assert.match(css, /not\(\[data-preview-dismissed\]\):focus-within \.notion-link-preview\{/);
  assert.match(css, /pointer-events:auto/);
  assert.match(css, /--notion-link-preview-shift/);
  assert.match(css, /\.notion-content \.notion-image-portrait\{width:min\(24rem,100%\);margin-inline:auto\}/);
  assert.match(css, /max-height:min\(75svh,46rem\)/);
  assert.match(css, /\.notion-columns>section\{min-width:0\}/);
  assert.match(css, /\.notion-columns \.notion-image,\.notion-columns \.notion-media\{width:100%\}/);
  const columnImageLinkRule = css.match(/\.notion-columns \.notion-image-link\{([^}]*)\}/)?.[1];
  assert.ok(columnImageLinkRule);
  assert.match(columnImageLinkRule, /display:flex/);
  assert.match(columnImageLinkRule, /width:100%/);
  assert.match(columnImageLinkRule, /justify-content:center/);
  const columnPortraitRule = css.match(
    /\.notion-columns \.notion-image-portrait img\{([^}]*)\}/,
  )?.[1];
  assert.ok(columnPortraitRule);
  assert.match(columnPortraitRule, /max-width:min\(100%,18\.5rem\)/);
  assert.match(columnPortraitRule, /max-height:min\(70svh,40rem\)/);
  assert.match(css, /prefers-color-scheme:dark/);
});

import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PROJECT_META } from "../src/config/project-meta.mjs";
import { siteConfig } from "../src/config/site-config.mjs";

const projectRoot = new URL("../", import.meta.url);
const buildRoot = new URL("../dist/", import.meta.url);
const expectedArticleRoutes = [
  "/career/northstar-studio/",
  "/career/beacon-labs/",
  "/works/atlas-notes/",
  "/works/focus-timer/",
  "/works/pocket-gallery/",
  "/writing/writing-with-notion/",
];

/** 读取某个静态路由的最终 HTML，而不是只验证 Astro 源码。 */
const readRoute = (path = "index.html") => readFile(new URL(path, buildRoot), "utf8");

/** 从压缩后的页面中提取锚点，逐项验证链接安全属性。 */
const extractAnchors = (html) => html.match(/<a\b[^>]*>/gi) ?? [];

/** 按 href 精确查找构建后的链接标签。 */
const findAnchor = (html, href) =>
  extractAnchors(html).find((anchor) => anchor.includes(`href="${href}"`));

/** 从最终首页依次提取目录编号、链接与标题，锁定用户看到的真实顺序。 */
const extractDirectoryColumns = (html) =>
  [...html.matchAll(
    /<section class="[^"]*directory-column[^"]*"[^>]*>[\s\S]*?<span class="column-index"[^>]*>([^<]+)<\/span>[\s\S]*?<h2[^>]*><a href="([^"]+)">([^<]+)<\/a>/g,
  )].map((match) => ({ index: match[1], href: match[2], label: match[3] }));

/** 只提取文章标题区的项目入口，避免页脚 GitHub 声明干扰组合断言。 */
const extractProjectLinks = (html) =>
  html.match(/<nav class="project-links"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";

/** 只提取首页指定分类的一列，验证流水账没有再次展开条目目录。 */
const extractDirectoryColumn = (html, category) =>
  html.match(
    new RegExp(
      `<section class="[^"]*directory-column[^"]*" aria-labelledby="directory-${category}">[\\s\\S]*?<\\/section>`,
    ),
  )?.[0] ?? "";

/** 把公开配置文字转换为 HTML 文本节点中的安全表示。 */
const escapeHtmlText = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** 首页保持极简四列，流水账只留下二级页面入口。 */
test("builds the four-column homepage with a single journal entry point", async () => {
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
  assert.equal((html.match(/class="directory-column(?: |")/g) ?? []).length, 4);
  assert.deepEqual(extractDirectoryColumns(html), [
    { index: "01", href: "/career/", label: "职业经历" },
    { index: "02", href: "/works/", label: "个人作品" },
    { index: "03", href: "/writing/", label: "文稿" },
    { index: "04", href: "/journal/", label: "流水账" },
  ]);
  assert.ok(findAnchor(html, "/career/"));
  assert.ok(findAnchor(html, "/works/"));
  assert.ok(findAnchor(html, "/writing/"));
  assert.ok(findAnchor(html, "/journal/"));

  for (const href of expectedArticleRoutes) {
    const anchor = findAnchor(html, href);
    assert.ok(anchor, `首页应指向站内静态详情页：${href}`);
    assert.doesNotMatch(anchor, /target=/);
  }

  const journalColumn = extractDirectoryColumn(html, "journal");
  assert.match(journalColumn, /directory-column-entry-only/);
  assert.ok(findAnchor(journalColumn, "/journal/"));
  assert.doesNotMatch(journalColumn, /class="directory-links"/);
  assert.doesNotMatch(journalColumn, /一段城市散步|用 Notion 写一篇文章|更多/);
  assert.equal((journalColumn.match(/<a\b/g) ?? []).length, 1);

  for (const contact of siteConfig.contacts) {
    const anchor = findAnchor(html, contact.href);
    assert.ok(anchor, `首页应包含联系方式：${contact.key}`);
    if (contact.external) assert.match(anchor, /target="_blank"/);
    else assert.doesNotMatch(anchor, /target=/);
  }
  const inspirationAnchor = findAnchor(html, siteConfig.designCredit.href);
  assert.ok(inspirationAnchor);
  assert.match(inspirationAnchor, /class="animated-underline"/);
  assert.match(inspirationAnchor, /target="_blank"/);
  assert.match(inspirationAnchor, /rel="noopener noreferrer"/);
  assert.ok(html.includes(escapeHtmlText(siteConfig.designCredit.prefix)));
  assert.ok(html.includes(escapeHtmlText(siteConfig.designCredit.label)));
  const projectRepositoryAnchor = findAnchor(html, PROJECT_META.repositoryUrl);
  assert.ok(projectRepositoryAnchor);
  assert.match(projectRepositoryAnchor, /class="project-repository animated-underline"/);
  assert.match(projectRepositoryAnchor, /target="_blank"/);
  assert.match(projectRepositoryAnchor, /rel="noopener noreferrer"/);
  assert.ok(html.includes(`Created by ${escapeHtmlText(PROJECT_META.creatorName)}`));
  assert.ok(
    html.indexOf('class="design-credit"') < html.indexOf('class="project-credit"'),
  );
  assert.ok(
    html.indexOf('class="project-credit"') <
      html.indexOf(`href="${PROJECT_META.repositoryUrl}"`),
  );
  assert.match(html, /<!--email_off-->/);
  assert.match(html, /<!--\/email_off-->/);
});

/** 文章型分类保留详情页，流水账改为唯一的多媒体时间流。 */
test("builds article indexes and the journal feed", async () => {
  await Promise.all(
    expectedArticleRoutes.map((route) =>
      access(new URL(`${route.slice(1)}index.html`, buildRoot)),
    ),
  );

  const [
    career,
    works,
    writing,
    journal,
    exampleWriting,
    exampleCareer,
    exampleWork,
    repositoryOnlyWork,
    projectOnlyWork,
    duplicateLinkWork,
    notFound,
  ] = await Promise.all([
    readRoute("career/index.html"),
    readRoute("works/index.html"),
    readRoute("writing/index.html"),
    readRoute("journal/index.html"),
    readRoute("writing/writing-with-notion/index.html"),
    readRoute("career/northstar-studio/index.html"),
    readRoute("works/atlas-notes/index.html"),
    readRoute("works/focus-timer/index.html"),
    readRoute("works/pocket-gallery/index.html"),
    readRoute("works/shared-link/index.html"),
    readRoute("404.html"),
  ]);

  for (const html of [
    career,
    works,
    writing,
    journal,
    exampleWriting,
    exampleCareer,
    exampleWork,
    repositoryOnlyWork,
    projectOnlyWork,
    duplicateLinkWork,
    notFound,
  ]) {
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
  assert.match(writing, /03 \/ WRITING/);
  assert.ok(findAnchor(writing, "/writing/writing-with-notion/"));
  assert.match(journal, /04 \/ JOURNAL/);
  assert.ok(findAnchor(career, "/career/northstar-studio/"));
  assert.ok(findAnchor(works, "/works/atlas-notes/"));
  for (const html of [career, works, writing, journal]) {
    assert.match(html, /class="back-link"/);
    assert.match(
      html,
      /class="back-link-arrow" aria-hidden="true">←<\/span><span>首页<\/span>/,
    );
  }
  assert.equal((exampleCareer.match(/class="back-link"/g) ?? []).length, 2);
  assert.equal(
    (exampleCareer.match(/class="back-link-arrow" aria-hidden="true">←<\/span>/g) ?? [])
      .length,
    2,
  );
  assert.match(
    notFound,
    /class="back-link not-found-return"[^>]*>[\s\S]*?class="back-link-arrow" aria-hidden="true">←<\/span><span>返回首页<\/span>/,
  );

  assert.match(exampleCareer, /<h1>Northstar Studio<\/h1>/);
  assert.match(exampleCareer, /负责设计系统与核心产品体验的职业经历。/);
  assert.match(exampleWork, /<h1>Atlas Notes<\/h1>/);
  assert.match(exampleWriting, /<h1>用 Notion 写一篇文章<\/h1>/);
  assert.match(
    writing,
    /<ul class="writing-tags writing-tags-list" aria-label="文章标签">/,
  );
  assert.match(
    exampleWriting,
    /<ul class="writing-tags writing-tags-article" aria-label="文章标签">/,
  );
  for (const tag of ["随笔", "技术"]) {
    assert.match(writing, new RegExp(`<li>${tag}</li>`));
    assert.match(exampleWriting, new RegExp(`<li>${tag}</li>`));
  }
  for (const html of [career, works, exampleCareer, exampleWork]) {
    assert.doesNotMatch(html, /class="writing-tags/);
  }
  for (const html of [exampleCareer, exampleWork, exampleWriting]) {
    assert.equal(
      (html.match(/class="article-divider"/g) ?? []).length,
      1,
      "文章型详情页都应具有同一个标题区分隔线",
    );
    assert.equal(
      (html.match(/class="article-end-marker"/g) ?? []).length,
      1,
      "文章型详情页都应具有明确的 END 收尾标记",
    );
  }
  assert.doesNotMatch(journal, /class="article-divider"|class="article-end-marker"/);

  const projectAnchor = findAnchor(exampleWork, "https://atlas-notes.example.com/");
  const repositoryAnchor = findAnchor(
    exampleWork,
    "https://github.com/example/atlas-notes/",
  );
  assert.match(exampleWork, /<nav class="project-links" aria-label="项目链接">/);
  assert.doesNotMatch(exampleWork, /project-links-label/);
  assert.ok(
    exampleWork.indexOf('class="article-divider"') <
      exampleWork.indexOf('class="project-links"'),
  );
  for (const anchor of [projectAnchor, repositoryAnchor]) {
    assert.ok(anchor);
    assert.match(anchor, /class="animated-underline"/);
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
  assert.ok(
    exampleWork.indexOf("https://atlas-notes.example.com/") <
      exampleWork.indexOf("https://github.com/example/atlas-notes/"),
  );
  const repositoryOnlyAnchor = findAnchor(
    repositoryOnlyWork,
    "https://github.com/example/focus-timer/",
  );
  assert.ok(repositoryOnlyAnchor);
  assert.match(repositoryOnlyWork, /<nav class="project-links" aria-label="项目链接">/);
  assert.doesNotMatch(extractProjectLinks(repositoryOnlyWork), /<span>访问项目<\/span>/);
  const projectOnlyAnchor = findAnchor(
    projectOnlyWork,
    "https://pocket-gallery.example.com/",
  );
  assert.ok(projectOnlyAnchor);
  assert.match(projectOnlyWork, /<nav class="project-links" aria-label="项目链接">/);
  assert.doesNotMatch(extractProjectLinks(projectOnlyWork), /<span>GitHub<\/span>/);
  const duplicateLinkNav = extractProjectLinks(duplicateLinkWork);
  assert.equal(
    (duplicateLinkNav.match(/href="https:\/\/github\.com\/example\/shared-link\/"/g) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(duplicateLinkNav, /<span>访问项目<\/span>/);
  assert.match(duplicateLinkNav, /<span>GitHub<\/span>/);
  assert.doesNotMatch(exampleWriting, /class="project-links"/);
  assert.match(exampleWriting, /class="notion-content"/);
  const internalWritingAnchor = findAnchor(
    exampleWriting,
    "/writing/writing-with-notion/",
  );
  assert.ok(internalWritingAnchor);
  assert.doesNotMatch(internalWritingAnchor, /target=/);

  assert.match(journal, /<section class="journal-feed" aria-label="流水账时间流">/);
  assert.equal((journal.match(/class="journal-entry"/g) ?? []).length, 1);
  assert.match(journal, /2026\.07\.19/);
  assert.doesNotMatch(journal, /2026\.01\.15|关于周末、街道与慢下来的一段记录。/);
  assert.doesNotMatch(journal, /一条包含多媒体的长流水账|一段城市散步/);
  assert.equal((journal.match(/data-journal-text/g) ?? []).length, 1);
  assert.equal((journal.match(/data-journal-a11y-preview hidden/g) ?? []).length, 1);
  assert.equal((journal.match(/data-journal-toggle hidden/g) ?? []).length, 1);
  assert.equal(
    (journal.match(/class="journal-entry-attachments notion-content"/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(journal, /class="project-links"/);
  assert.match(journal, /<script type="module" src="\/_astro\/[^\"]+\.js"><\/script>/);
  assert.doesNotMatch(journal, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);

  const journalScriptPaths = [
    ...journal.matchAll(/<script type="module" src="([^\"]+\.js)"><\/script>/g),
  ].map((match) => match[1]);
  assert.ok(journalScriptPaths.length > 0);
  const journalScripts = (
    await Promise.all(
      journalScriptPaths.map((path) =>
        readFile(new URL(path.slice(1), buildRoot), "utf8"),
      ),
    )
  ).join("\n");
  assert.match(journalScripts, /data-journal-a11y-preview/);
  assert.match(journalScripts, /toggleAttribute\(["'`]inert["'`]/);
  assert.match(
    journalScripts,
    /setAttribute\(["'`]aria-hidden["'`],["'`]true["'`]\)/,
  );
  assert.match(journalScripts, /addEventListener\(["'`]toggle["'`]/);

  assert.match(journal, /<ul><li>/);
  assert.match(journal, /<blockquote>/);
  const bookmarkAnchor = findAnchor(journal, "https://example.com/reference");
  assert.ok(bookmarkAnchor);
  assert.match(bookmarkAnchor, /target="_blank"/);
  assert.match(bookmarkAnchor, /class="notion-mention notion-mention-external"/);
  assert.match(journal, /<pre><code data-language="shell">/);
  assert.match(journal, /<details><summary>/);
  assert.match(
    journal,
    /<div class="notion-divider" role="separator"><span aria-hidden="true">·—·<\/span><\/div>/,
  );
  assert.match(
    journal,
    /<img src="\/notion-assets\/8550ce349fe18c2784edf8e4c798ede1e4062dca7607cd79a3bc00a63afa54a6\.gif" alt="动态操作演示" loading="lazy" decoding="async" data-notion-image-unmeasured>/,
  );
  assert.match(
    journal,
    /<div class="notion-columns"><section><figure class="notion-image notion-image-portrait"><a class="notion-image-link"[^>]*><img src="\/notion-assets\/ecd0cd4178539f17f752b77ff7ae77fcec37da042bebd8ca274cbea71d4d4205\.png" alt="竖屏截图一" width="360" height="780"/,
  );
  assert.equal(
    (journal.match(/class="notion-image notion-image-portrait"/g) ?? []).length,
    2,
  );
  assert.match(
    journal,
    /<video src="\/notion-assets\/7e2817c0d96668fedb7bafd028b897d8ab82d81a433250f25452a4c818796f70\.mp4" controls playsinline preload="none" aria-label="Notion 上传视频"[^>]*>/,
  );
  assert.match(
    journal,
    /<audio src="\/notion-assets\/4f8734c5e13ac599e168cf247a51c1dd0758537ce00bf16d7fed1a3d14d07041\.wav" controls preload="none" aria-label="Notion 上传音频"[^>]*>/,
  );
  assert.match(journal, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(journal, /src="https:\/\/player\.vimeo\.com\/video\/226053498\?h=a1599a8ee9"/);
  assert.equal((journal.match(/allowfullscreen/g) ?? []).length, 2);
  assert.ok(journal.includes(`href="${siteConfig.origin}/journal/"`));

  const internalJournalAnchor = findAnchor(journal, "/journal/");
  assert.ok(internalJournalAnchor);
  assert.doesNotMatch(internalJournalAnchor, /target=/);
  assert.match(internalJournalAnchor, /class="notion-mention notion-mention-internal"/);
  assert.doesNotMatch(journal, /www\.notion\.so\/d1111111111141118111111111111111/);
  const relatedEntryAnchor = findAnchor(journal, "/career/northstar-studio/");
  assert.ok(relatedEntryAnchor);
  assert.doesNotMatch(relatedEntryAnchor, /target=/);
  assert.match(relatedEntryAnchor, /class="notion-mention notion-mention-internal"/);
  const externalMentionAnchor = findAnchor(
    journal,
    "https://example.com/product?source=notion",
  );
  assert.ok(externalMentionAnchor);
  assert.match(externalMentionAnchor, /class="notion-mention notion-mention-external"/);
  assert.match(externalMentionAnchor, /target="_blank"/);
  assert.match(externalMentionAnchor, /rel="noopener noreferrer"/);
  assert.match(externalMentionAnchor, /aria-describedby="notion-link-preview-\d+-1"/);
  assert.match(
    journal,
    /<span class="notion-mention-mark" aria-hidden="true">↗<\/span><span class="notion-mention-label">示例产品<\/span>/,
  );
  assert.match(
    journal,
    /class="notion-link-preview-a11y" hidden>Example。用于验证正文链接摘要/,
  );
  assert.match(journal, /class="notion-link-preview" aria-hidden="true"/);
  assert.doesNotMatch(journal, /role="tooltip"/);
  assert.match(journal, /用于验证正文链接摘要、站点名称和安全外链属性的构建夹具。/);
  const standalonePreviewAnchor = findAnchor(
    journal,
    "https://example.com/product?source=standalone",
  );
  assert.ok(standalonePreviewAnchor);
  assert.match(
    standalonePreviewAnchor,
    /aria-describedby="notion-link-preview-external-standalone-link"/,
  );
  assert.equal((journal.match(/class="notion-link notion-link-card"/g) ?? []).length, 2);
  assert.match(journal, /独立链接会像 Notion 一样直接展示标题、来源与简短摘要。/);
  assert.equal(
    extractAnchors(journal).filter((anchor) =>
      anchor.includes('href="/career/northstar-studio/"'),
    ).length,
    3,
  );
  assert.doesNotMatch(journal, /<script>alert\("xss"\)<\/script>/);
  assert.match(journal, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(journal, /javascript:alert/);
  await assert.rejects(access(new URL("writing/start-here/index.html", buildRoot)));

  for (const route of [
    "journal/a-city-walk/index.html",
    "journal/multimedia-journal/index.html",
    "journal/start-here/index.html",
  ]) {
    await assert.rejects(access(new URL(route, buildRoot)));
  }
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
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /border-block:1px solid var\(--line-strong\)/);
  assert.match(css, /content:"→"/);
  const journalDirectoryRule = css.match(
    /\.directory-column-entry-only \.column-heading\{([^}]*)\}/,
  )?.[1];
  assert.ok(journalDirectoryRule);
  assert.match(journalDirectoryRule, /margin-bottom:0/);
  const journalFeedRule = css.match(/\.journal-feed\{([^}]*)\}/)?.[1];
  assert.ok(journalFeedRule);
  assert.match(journalFeedRule, /width:min\(100%,\s*var\(--journal-feed-width\)\)/);
  assert.match(journalFeedRule, /border-top:1px solid var\(--text-primary\)/);
  const journalCollapsedRule = css.match(
    /\.journal-entry-copy\[data-collapsed\]\{([^}]*)\}/,
  )?.[1];
  assert.ok(journalCollapsedRule);
  assert.match(journalCollapsedRule, /max-height:var\(--journal-collapsed-height\)/);
  assert.match(journalCollapsedRule, /overflow:hidden/);
  assert.match(journalCollapsedRule, /mask-image:linear-gradient/);
  assert.match(journalCollapsedRule, /var\(--journal-fade-height\)/);
  assert.doesNotMatch(css, /--journal-collapsed-height:(?:11|12)rem/);
  const journalCopyRule = css.match(/\.journal-entry-copy\{([^}]*)\}/)?.[1];
  assert.ok(journalCopyRule);
  assert.match(journalCopyRule, /display:flow-root/);
  assert.match(journalCopyRule, /position:relative/);
  assert.match(journalCopyRule, /line-height:1\.5/);
  const journalCopyParagraphRule = css.match(
    /\.journal-entry-copy>p\{([^}]*)\}/,
  )?.[1];
  assert.ok(journalCopyParagraphRule);
  assert.match(journalCopyParagraphRule, /margin-bottom:\.4em/);
  const journalA11yPreviewRule = css.match(
    /\.journal-entry-a11y-preview\{([^}]*)\}/,
  )?.[1];
  assert.ok(journalA11yPreviewRule);
  assert.match(journalA11yPreviewRule, /position:absolute/);
  assert.match(journalA11yPreviewRule, /clip-path:inset\(50%\)/);
  assert.match(css, /\.journal-entry-copy\[inert\]\{pointer-events:none;user-select:none\}/);
  const journalAttachmentMediaRule = css.match(
    /\.journal-entry-attachments \.notion-image,\.journal-entry-attachments \.notion-media\{([^}]*)\}/,
  )?.[1];
  assert.ok(journalAttachmentMediaRule);
  assert.match(journalAttachmentMediaRule, /width:100%/);
  const audioRule = css.match(/\.notion-media audio\{([^}]*)\}/)?.[1];
  assert.ok(audioRule);
  assert.match(audioRule, /display:block/);
  assert.match(audioRule, /width:100%/);
  assert.doesNotMatch(css, /\.decimal-year:hover\{color:/);
  assert.match(css, /\.decimal-year:hover \.decimal-year-progress\{opacity:0\}/);
  assert.match(css, /\.decimal-year:hover \.decimal-year-remaining\{opacity:1\}/);
  const animatedUnderlineRule = css.match(/\.animated-underline\{([^}]*)\}/)?.[1];
  assert.ok(animatedUnderlineRule);
  assert.match(animatedUnderlineRule, /transition:color \.22s/);
  assert.match(
    css,
    /\.animated-underline:hover,\.animated-underline:focus-visible\{color:var\(--text-muted\)\}/,
  );
  const animatedUnderlineHoverRule = css.match(
    /\.animated-underline:hover:after,\.animated-underline:focus-visible:after\{([^}]*)\}/,
  )?.[1];
  assert.ok(animatedUnderlineHoverRule);
  assert.match(animatedUnderlineHoverRule, /transform:scaleX\(0\)/);
  assert.match(animatedUnderlineHoverRule, /transform-origin:100%/);
  const contentShellRule = css.match(/\.content-shell\{([^}]*)\}/)?.[1];
  assert.ok(contentShellRule);
  assert.match(
    contentShellRule,
    /--page-content-start-gap:clamp\(2\.25rem,\s*3\.5vw,\s*3rem\)/,
  );
  assert.match(contentShellRule, /display:flex/);
  assert.match(contentShellRule, /min-height:100svh/);
  assert.match(contentShellRule, /flex-direction:column/);
  const pageFooterRule = css.match(/\.page-footer\{([^}]*)\}/)?.[1];
  assert.ok(pageFooterRule);
  assert.match(pageFooterRule, /margin-top:auto/);
  assert.match(pageFooterRule, /padding-top:clamp\(5rem,10vw,10rem\)/);
  const backLinkRule = css.match(/\.back-link\{([^}]*)\}/)?.[1];
  assert.ok(backLinkRule);
  assert.match(backLinkRule, /display:inline-flex/);
  assert.match(backLinkRule, /align-items:baseline/);
  assert.match(backLinkRule, /gap:\.42em/);
  const backLinkArrowRule = css.match(/\.back-link-arrow\{([^}]*)\}/)?.[1];
  assert.ok(backLinkArrowRule);
  assert.match(backLinkArrowRule, /display:inline-block/);
  assert.match(backLinkArrowRule, /transition:transform \.22s cubic-bezier\(\.16,1,\.3,1\)/);
  assert.match(
    css,
    /\.back-link:focus-visible \.back-link-arrow\{transform:translate(?:X)?\(-\.22rem\)\}/,
  );
  assert.match(
    css,
    /\.back-link:hover \.back-link-arrow\{transform:translate(?:X)?\(-\.22rem\)\}/,
  );
  const articleShellRule = css.match(/\.article-shell\{([^}]*)\}/)?.[1];
  assert.ok(articleShellRule);
  assert.match(articleShellRule, /--article-content-width:46rem/);
  const articleBodyRule = css.match(/\.article-shell article\{([^}]*)\}/)?.[1];
  assert.ok(articleBodyRule);
  assert.match(articleBodyRule, /margin-top:var\(--page-content-start-gap\)/);
  const articleHeaderRule = css.match(/\.article-header\{([^}]*)\}/)?.[1];
  assert.ok(articleHeaderRule);
  assert.doesNotMatch(articleHeaderRule, /padding-top/);
  const categoryHeaderRule = css.match(/\.category-header\{([^}]*)\}/)?.[1];
  assert.ok(categoryHeaderRule);
  assert.match(categoryHeaderRule, /margin-top:var\(--page-content-start-gap\)/);
  assert.match(categoryHeaderRule, /padding-bottom:clamp\(2\.75rem,5vw,4rem\)/);
  assert.doesNotMatch(categoryHeaderRule, /padding-top|(?:^|;)padding:/);
  const projectLinksRule = css.match(/\.project-links\{([^}]*)\}/)?.[1];
  assert.ok(projectLinksRule);
  assert.match(projectLinksRule, /display:flex/);
  assert.match(projectLinksRule, /max-width:var\(--article-content-width\)/);
  assert.match(projectLinksRule, /margin-top:1rem/);
  assert.doesNotMatch(projectLinksRule, /border/);
  assert.match(projectLinksRule, /flex-wrap:wrap/);
  const articleDividerRule = css.match(/\.article-divider\{([^}]*)\}/)?.[1];
  assert.ok(articleDividerRule);
  assert.match(articleDividerRule, /max-width:var\(--article-content-width\)/);
  assert.match(articleDividerRule, /border-top:1px solid var\(--line\)/);
  const articleReturnRule = css.match(/\.article-return\{([^}]*)\}/)?.[1];
  assert.ok(articleReturnRule);
  assert.doesNotMatch(articleReturnRule, /border/);
  assert.match(articleReturnRule, /margin-top:clamp\(2\.5rem,4vw,3rem\)/);
  const articleEndMarkerRule = css.match(/\.article-end-marker\{([^}]*)\}/)?.[1];
  assert.ok(articleEndMarkerRule);
  assert.match(articleEndMarkerRule, /display:flex/);
  assert.match(articleEndMarkerRule, /width:fit-content/);
  assert.match(articleEndMarkerRule, /font-size:\.65rem/);
  assert.match(articleEndMarkerRule, /margin-bottom:\.875rem/);
  const articleEndMarkerLineRule = css.match(
    /\.article-end-marker:after\{([^}]*)\}/,
  )?.[1];
  assert.ok(articleEndMarkerLineRule);
  assert.match(articleEndMarkerLineRule, /width:8rem/);
  assert.match(articleEndMarkerLineRule, /height:1px/);
  assert.match(articleEndMarkerLineRule, /background:var\(--line-strong\)/);
  const projectLinkAnchorRule = css.match(/\.project-links a\{([^}]*)\}/)?.[1];
  assert.ok(projectLinkAnchorRule);
  assert.match(projectLinkAnchorRule, /font-family:var\(--font-sans\)/);
  assert.match(projectLinkAnchorRule, /font-size:1rem/);
  const notionDividerRule = css.match(
    /\.notion-content \.notion-divider\{([^}]*)\}/,
  )?.[1];
  assert.ok(notionDividerRule);
  assert.match(notionDividerRule, /margin:1\.25rem 0/);
  assert.match(notionDividerRule, /font-family:var\(--font-mono\)/);
  assert.match(notionDividerRule, /text-align:center/);
  assert.doesNotMatch(css, /\.notion-content hr\{/);
  assert.match(css, /margin:0 0 1\.05em/);
  const articleFooterRule = css.match(
    /\.article-shell \.page-footer\{([^}]*)\}/,
  )?.[1];
  assert.ok(articleFooterRule);
  assert.match(articleFooterRule, /padding-top:clamp\(3rem,5vw,4rem\)/);
  const articleCoverRule = css.match(/\.article-cover\{([^}]*)\}/)?.[1];
  assert.ok(articleCoverRule);
  assert.match(articleCoverRule, /max-width:var\(--article-content-width\)/);
  const notionContentRule = css.match(/\.notion-content\{([^}]*)\}/)?.[1];
  assert.ok(notionContentRule);
  assert.match(notionContentRule, /max-width:var\(--article-content-width\)/);
  const articleMediaRule = css.match(
    /\.notion-image,\.notion-media\{([^}]*)\}/,
  )?.[1];
  assert.ok(articleMediaRule);
  assert.match(articleMediaRule, /width:100%/);
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

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, readRichText, renderRichText;

/** 使用项目自身的 Vite 配置加载 TypeScript 富文本渲染器。 */
before(async () => {
  vite = await createServer({
    root: projectRoot,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
  });
  ({ renderRichText } = await vite.ssrLoadModule("/src/content/render-rich-text.ts"));
  ({ readRichText } = await vite.ssrLoadModule("/src/lib/notion/values.ts"));
});

/** 测试完成后关闭文件监听器，避免 Node 进程无法退出。 */
after(async () => {
  await vite?.close();
});

/** 构造单个富文本片段，集中验证链接类别与安全属性。 */
const richText = (plainText, href, type = "text") => ({
  type,
  plainText,
  href,
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
  },
});

test("renders external URLs as safe mention links", () => {
  const html = renderRichText([
    richText("https://example.com/a-long-path", "https://example.com/a-long-path"),
  ]);

  assert.match(html, /^<a class="notion-mention notion-mention-external"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<span class="notion-mention-mark" aria-hidden="true">↗<\/span>/);
  assert.match(html, /<span class="notion-mention-label">https:\/\/example\.com\/a-long-path<\/span>/);
});

test("renders fetched metadata as an escaped link preview", () => {
  const item = richText(
    "https://example.com/product",
    "https://example.com/product",
  );
  item.linkPreview = {
    title: "产品 <script>alert(1)</script>",
    description: '摘要里包含 <img src=x onerror="alert(2)">',
    siteName: "Example & Co.",
  };

  const html = renderRichText([item]);

  assert.match(html, /^<span class="notion-link">/);
  assert.match(html, /aria-describedby="notion-link-preview-\d+-0"/);
  assert.match(
    html,
    /<span class="notion-mention-label">产品 &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/span>/,
  );
  assert.match(
    html,
    /<span id="notion-link-preview-\d+-0" class="notion-link-preview-a11y" hidden>Example &amp; Co\.。摘要里包含/,
  );
  assert.match(html, /<span class="notion-link-preview" aria-hidden="true">/);
  assert.doesNotMatch(html, /role="tooltip"/);
  assert.match(html, /Example &amp; Co\./);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(2\)&quot;&gt;/);
  assert.doesNotMatch(html, /<script>|<img\b|onerror="/);

  const customLabelItem = richText("了解更多", "https://example.com/product");
  customLabelItem.linkPreview = item.linkPreview;
  const customLabelHtml = renderRichText([customLabelItem]);
  assert.match(
    customLabelHtml,
    /class="notion-link-preview-a11y" hidden>产品 &lt;script&gt;alert\(1\)&lt;\/script&gt;。Example &amp; Co\./,
  );
});

test("keeps headings and disclosure labels compact when previews are disabled", () => {
  const item = richText("产品说明", "https://example.com/product");
  item.linkPreview = {
    title: "产品标题",
    description: "不应嵌入标题或折叠控件的摘要。",
    siteName: "Example",
  };

  const html = renderRichText([item], { previewMode: "mention" });

  assert.match(html, /^<a class="notion-mention notion-mention-external"/);
  assert.match(html, /<span class="notion-mention-label">产品说明<\/span>/);
  assert.doesNotMatch(html, /notion-link-preview|不应嵌入/);
});

test("distinguishes internal, email, and native Notion mentions", () => {
  const internal = renderRichText([richText("站内文章", "/journal/article/")]);
  const email = renderRichText([richText("写邮件", "mailto:hello@example.com")]);
  const nativeMention = renderRichText([
    richText("关联页面", "https://wenren.cc/works/project/", "mention"),
  ]);

  assert.match(internal, /class="notion-mention notion-mention-internal"/);
  assert.match(internal, />→<\/span>/);
  assert.doesNotMatch(internal, /target=/);
  assert.match(email, /class="notion-mention notion-mention-email"/);
  assert.match(email, />@<\/span>/);
  assert.doesNotMatch(email, /target=/);
  assert.match(
    nativeMention,
    /class="notion-mention notion-mention-internal notion-mention-native"/,
  );
  assert.match(nativeMention, />→<\/span>/);
});

test("preserves native mention semantics from the Notion API", () => {
  const [linkedMention, passiveMention] = readRichText([
    {
      type: "mention",
      plain_text: "关联作品",
      href: "https://wenren.cc/works/project/",
      mention: { type: "page", page: { id: "11111111-2222-3333-4444-555555555555" } },
      annotations: {},
    },
    {
      type: "mention",
      plain_text: "2026-07-19",
      href: null,
      mention: { type: "date", date: { start: "2026-07-19" } },
      annotations: {},
    },
  ]);

  assert.equal(linkedMention.type, "mention");
  assert.equal(passiveMention.type, "mention");
  assert.match(
    renderRichText([linkedMention]),
    /^<a class="notion-mention notion-mention-internal notion-mention-native"/,
  );
  assert.equal(
    renderRichText([passiveMention]),
    '<span class="notion-mention notion-mention-native"><span class="notion-mention-mark" aria-hidden="true">@</span><span class="notion-mention-label">2026-07-19</span></span>',
  );
});

test("keeps unsupported link protocols as escaped plain text", () => {
  const html = renderRichText([
    richText('<script>alert("xss")</script>', "javascript:alert(1)"),
  ]);

  assert.equal(html, "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  assert.doesNotMatch(html, /<a\b|javascript:/);
});

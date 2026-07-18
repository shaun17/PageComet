import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

// 直接调用构建后的 Worker，验证服务端真实输出而不是源码字符串。
async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

// 首页必须服务端输出完整的个人信息与三组 Notion 入口。
test("server-renders the personal site and its Notion directory", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>Wenren — 软件工程师与独立开发者<\/title>/i);
  assert.match(html, /Wenren 在做/);
  assert.match(html, /独立产品/);
  assert.match(html, /职业经历/);
  assert.match(html, /个人作品/);
  assert.match(html, /流水账/);
  assert.match(html, /QTrade/);
  assert.match(html, /Kingdee/);
  assert.match(html, /CoolBox/);
  assert.match(html, /Petly Care/);
  assert.match(html, /IDPhotoMaker/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/);
});

// 成品不能继续携带模板骨架组件或只为骨架服务的依赖。
test("removes the disposable starter preview", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});

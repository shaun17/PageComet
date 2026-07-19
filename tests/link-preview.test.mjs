import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { MockAgent } from "undici";
import { siteConfig } from "../src/config/site-config.mjs";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let createCachedLinkPreviewResolverForTest;
let createPublicRemoteFetcherForTest;
let createUnsafeTestRemoteFetcher;
let enrichContentLinkPreviews;
let fetchPublicResource;

/** 使用项目自身的 Vite 配置加载 TypeScript，保证测试和实际构建走同一套模块解析。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ enrichContentLinkPreviews } = await vite.ssrLoadModule(
    "/src/content/link-preview.ts",
  ));
  ({ createCachedLinkPreviewResolverForTest } = await vite.ssrLoadModule(
    "/src/content/link-preview-resolver.ts",
  ));
  ({
    createPublicRemoteFetcherForTest,
    createUnsafeTestRemoteFetcher,
    fetchPublicResource,
  } = await vite.ssrLoadModule("/src/lib/network/public-remote-fetch.ts"));
});

/** 测试完成后关闭文件监听器，避免 Node 进程无法退出。 */
after(async () => {
  await vite?.close();
});

/** 构造无样式的最小富文本片段。 */
const richText = (plainText, href = null) => ({
  type: "text",
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

/** 构造满足正文预览处理所需字段的最小文章。 */
const createEntry = (blocks) => ({
  id: "link-preview-entry",
  title: "链接摘要测试",
  slug: "link-preview-entry",
  category: "journal",
  status: "published",
  summary: "",
  publishedAt: null,
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
  order: 1,
  featured: false,
  tags: [],
  externalUrl: null,
  repositoryUrl: null,
  notionUrl: "https://www.notion.so/link-preview-entry",
  route: "/journal/link-preview-entry",
  cover: null,
  blocks,
});

/** 构造通用正文块，允许测试嵌套块、书签、表格与媒体字段。 */
const block = (id, type, overrides = {}) => ({
  id,
  type,
  richText: [],
  children: [],
  ...overrides,
});

/** 构造一份只含 head 元数据的离线 HTML 响应。 */
const htmlResponse = (html, status = 200) =>
  new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

test("deduplicates external links and immutably attaches one preview across block shapes", async () => {
  const externalUrl = "https://example.com/product?from=notion#section";
  const normalizedUrl = "https://example.com/product?from=notion";
  const preview = {
    title: "示例产品",
    description: "用于验证同一外链只抓取一次。",
    siteName: "Example",
  };
  const original = createEntry([
    block("paragraph", "paragraph", {
      richText: [
        richText("查看产品", externalUrl),
        richText("站内相对链接", "/works/petly-care/"),
        richText("站内绝对链接", `${siteConfig.origin}/works/petly-care/`),
        richText("邮件", "mailto:hello@example.com"),
      ],
      caption: [richText("图注里的同一产品", normalizedUrl)],
      children: [
        block("nested", "paragraph", {
          richText: [richText("同一产品", normalizedUrl)],
        }),
      ],
    }),
    block("bookmark", "bookmark", { url: externalUrl }),
    block("table", "table_row", {
      cells: [[richText("表格里的同一产品", normalizedUrl)]],
    }),
    block("video", "video", {
      video: {
        url: "https://media.example.com/demo.mp4",
        source: "external",
        expiryTime: null,
        localized: false,
      },
    }),
    block("image", "image", {
      image: {
        url: "https://media.example.com/poster.png",
        alt: "海报",
        source: "external",
        expiryTime: null,
        localized: false,
      },
    }),
  ]);
  const originalSnapshot = structuredClone(original);
  const requestedUrls = [];

  const [enriched] = await enrichContentLinkPreviews(
    [original],
    async (url) => {
      requestedUrls.push(url);
      return preview;
    },
    { concurrency: 2 },
  );

  assert.deepEqual(requestedUrls, [normalizedUrl]);
  assert.deepEqual(original, originalSnapshot, "原始文章不能被原地改写");
  assert.notStrictEqual(enriched, original);
  assert.notStrictEqual(enriched.blocks, original.blocks);
  assert.notStrictEqual(enriched.blocks[0], original.blocks[0]);
  assert.deepEqual(enriched.blocks[0].richText[0].linkPreview, preview);
  assert.deepEqual(enriched.blocks[0].caption[0].linkPreview, preview);
  assert.equal(enriched.blocks[0].richText[1].linkPreview, undefined);
  assert.equal(enriched.blocks[0].richText[2].linkPreview, undefined);
  assert.equal(enriched.blocks[0].richText[3].linkPreview, undefined);
  assert.deepEqual(enriched.blocks[0].children[0].richText[0].linkPreview, preview);
  assert.deepEqual(enriched.blocks[1].linkPreview, preview);
  assert.deepEqual(enriched.blocks[2].cells[0][0].linkPreview, preview);
  assert.equal(enriched.blocks[3].linkPreview, undefined);
  assert.equal(enriched.blocks[4].linkPreview, undefined);
});

test("degrades only the failed external link and reports the failure", async () => {
  const failedUrl = "https://failure.example/article";
  const original = createEntry([
    block("failed", "paragraph", {
      richText: [richText("无法读取的链接", failedUrl)],
    }),
  ]);
  const failures = [];

  const [enriched] = await enrichContentLinkPreviews(
    [original],
    async () => {
      throw new Error("离线抓取失败");
    },
    {
      onFailure: (url, error) => failures.push({ url, error }),
    },
  );

  assert.equal(enriched.blocks[0].richText[0].linkPreview, undefined);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].url, failedUrl);
  assert.match(String(failures[0].error), /离线抓取失败/);
});

test("parses metadata while keeping hostile HTML-looking values as plain strings", async () => {
  const requestedUrl = "https://metadata.example/article";
  const resolver = createCachedLinkPreviewResolverForTest({
    cacheDirectory: false,
    fetchImpl: async () =>
      htmlResponse(`<!doctype html>
        <html><head>
          <meta property="og:title" content="&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;">
          <meta property="og:description" content="&lt;img src=x onerror=alert(1)&gt;\u202E  安全摘要">
          <meta property="og:site_name" content="恶意&lt;b&gt;站点&lt;/b&gt;">
          <title>不会覆盖 Open Graph 标题</title>
        </head><body></body></html>`),
  });

  try {
    const result = await resolver.resolve(requestedUrl);

    assert.deepEqual(result, {
      title: "<script>alert('x')</script>",
      description: "<img src=x onerror=alert(1)> 安全摘要",
      siteName: "恶意<b>站点</b>",
    });
    assert.equal(typeof result.title, "string");
    assert.equal(typeof result.description, "string");
    assert.equal(typeof result.siteName, "string");
  } finally {
    await resolver.close();
  }
});

test("rejects literal private IPs before invoking the injected fetch", async () => {
  let requestCount = 0;
  const resolver = createCachedLinkPreviewResolverForTest({
    cacheDirectory: false,
    fetchImpl: async () => {
      requestCount += 1;
      return htmlResponse("<title>不应请求</title>");
    },
  });

  try {
    await assert.rejects(
      resolver.resolve("http://127.0.0.1/internal"),
      /private|internal|私有|本机/i,
    );
    assert.equal(requestCount, 0);
  } finally {
    await resolver.close();
  }
});

test("validates every redirect and refuses a redirect to a private IP", async () => {
  const requestedUrls = [];
  const remoteFetcher = createUnsafeTestRemoteFetcher(async (input) => {
      requestedUrls.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/secrets" },
      });
  });

  try {
    await assert.rejects(
      fetchPublicResource("https://public.example/start", {
        fetchImpl: remoteFetcher.fetch,
        maxRedirects: 3,
      }),
      /private|internal|私有|本机/i,
    );
    assert.deepEqual(requestedUrls, ["https://public.example/start"]);
  } finally {
    await remoteFetcher.close();
  }
});

test("rejects a public hostname when DNS resolves to a private address", async () => {
  const resolvedHosts = [];
  const remoteFetcher = createPublicRemoteFetcherForTest({
    resolveAddresses: async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: "192.168.1.20", family: 4 }];
    },
  });

  try {
    await assert.rejects(
      remoteFetcher.fetch("https://public.example/secret"),
      (error) => {
        assert.match(String(error), /fetch failed/i);
        assert.match(String(error.cause), /私有|本机网络/);
        return true;
      },
    );
    assert.deepEqual(resolvedHosts, ["public.example"]);
  } finally {
    await remoteFetcher.close();
  }
});

test("keeps validated DNS records alive and consistently prefers IPv4", async () => {
  const publicIpv4 = "93.184.216.34";
  const publicIpv6 = "2606:2800:220:1:248:1893:25c8:1946";
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  const ipv4Pool = mockAgent.get(`https://${publicIpv4}`);
  ipv4Pool
    .intercept({ path: "/preview", method: "GET" })
    .reply(200, "公网响应-v4");
  ipv4Pool
    .intercept({ path: "/preview", method: "GET" })
    .reply(200, "公网响应-v4");
  mockAgent
    .get(`https://[${publicIpv6}]`)
    .intercept({ path: "/preview", method: "GET" })
    .reply(200, "公网响应-v6");
  const remoteFetcher = createPublicRemoteFetcherForTest({
    dispatcher: mockAgent,
    resolveAddresses: async () => [
      { address: publicIpv4, family: 4 },
      { address: publicIpv6, family: 6 },
    ],
  });
  const originalNow = Date.now;
  let timestamp = 1_000_000;
  Date.now = () => {
    timestamp += 1;
    return timestamp;
  };

  try {
    const firstResponse = await remoteFetcher.fetch("https://public.example/preview");
    const secondResponse = await remoteFetcher.fetch("https://public.example/preview");
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal(await firstResponse.text(), "公网响应-v4");
    assert.equal(await secondResponse.text(), "公网响应-v4");
  } finally {
    Date.now = originalNow;
    await remoteFetcher.close();
  }
});

test("reuses a fresh disk cache across resolver instances without another request", async () => {
  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "notion-site-link-preview-"));
  const requestedUrl = "https://cache.example/article";
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return htmlResponse(`<!doctype html><html><head>
      <meta property="og:title" content="缓存标题">
      <meta property="og:description" content="缓存摘要">
      <meta property="og:site_name" content="缓存站点">
    </head></html>`);
  };
  const firstResolver = createCachedLinkPreviewResolverForTest({
    cacheDirectory,
    fetchImpl,
  });

  try {
    const firstResult = await firstResolver.resolve(requestedUrl);
    await firstResolver.close();

    const secondResolver = createCachedLinkPreviewResolverForTest({
      cacheDirectory,
      fetchImpl: async () => {
        requestCount += 1;
        throw new Error("缓存命中时不应再次请求");
      },
    });
    try {
      const cachedResult = await secondResolver.resolve(requestedUrl);
      assert.deepEqual(cachedResult, firstResult);
      assert.equal(requestCount, 1);
    } finally {
      await secondResolver.close();
    }
  } finally {
    await firstResolver.close();
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

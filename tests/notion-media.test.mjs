import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createServer } from "vite";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, localizeContentEntryMediaForTest, normalizeNotionBlock;
/** 使用项目自身的 Vite 配置加载 TypeScript，确保测试与 Astro 构建采用同一规则。 */
before(async () => {
  vite = await createServer({
    root: projectRoot,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true },
  });
  ({ localizeContentEntryMediaForTest } = await vite.ssrLoadModule(
    "/src/lib/notion/assets.ts",
  ));
  ({ normalizeNotionBlock } = await vite.ssrLoadModule("/src/lib/notion/blocks.ts"));
});
/** 测试完成后关闭文件监听器，避免 Node 进程无法退出。 */
after(async () => {
  await vite?.close();
});
/** 构造资源本地化所需的最小文章模型。 */
const createEntry = (blocks) => ({
  id: "media-entry",
  title: "媒体文章",
  slug: "media-entry",
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
  notionUrl: "https://www.notion.so/media-entry",
  route: "/journal/media-entry",
  cover: null,
  blocks,
});
test("preserves Notion video source and expiry metadata during normalization", () => {
  const block = normalizeNotionBlock(
    {
      object: "block",
      id: "video-block",
      type: "video",
      has_children: false,
      video: {
        type: "file",
        file: {
          url: "https://prod-files-secure.example/demo.mp4?X-Amz-Signature=temporary",
          expiry_time: "2026-07-19T01:00:00.000Z",
        },
        caption: [],
      },
    },
    [],
  );

  assert.deepEqual(block.video, {
    url: "https://prod-files-secure.example/demo.mp4?X-Amz-Signature=temporary",
    source: "notion",
    expiryTime: "2026-07-19T01:00:00.000Z",
    localized: false,
  });
  assert.equal(block.url, undefined);
});
test("localizes GIF and uploaded video without changing their bytes", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-notion-media-"));
  // 最小 GIF 头声明 1×2 画布，足以验证下载过程会保留字节并提取固有尺寸。
  const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  const videoBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3]);
  const entry = createEntry([
    {
      id: "gif",
      type: "image",
      richText: [],
      children: [],
      image: {
        url: "https://files.example/demo.gif?X-Amz-Signature=gif",
        alt: "GIF",
        source: "notion",
        expiryTime: "2026-07-19T01:00:00.000Z",
        localized: false,
      },
    },
    {
      id: "video",
      type: "video",
      richText: [],
      children: [],
      video: {
        url: "https://files.example/demo.mp4?X-Amz-Signature=video",
        source: "notion",
        expiryTime: "2026-07-19T01:00:00.000Z",
        localized: false,
      },
    },
  ]);

  try {
    const localized = await localizeContentEntryMediaForTest(entry, {
      outputDirectory,
      publicPath: "/notion-assets",
      fetchImpl: async (input) =>
        String(input).includes(".gif")
          ? new Response(gifBytes, { headers: { "Content-Type": "image/gif" } })
          : new Response(videoBytes, { headers: { "Content-Type": "video/mp4" } }),
    });
    const [gif, video] = localized.blocks;

    assert.match(gif.image.url, /^\/notion-assets\/[a-f0-9]{64}\.gif$/);
    assert.match(video.video.url, /^\/notion-assets\/[a-f0-9]{64}\.mp4$/);
    assert.equal(gif.image.localized, true);
    assert.equal(gif.image.width, 1);
    assert.equal(gif.image.height, 2);
    assert.equal(video.video.localized, true);
    assert.equal(gif.image.expiryTime, null);
    assert.equal(video.video.expiryTime, null);

    const files = await readdir(outputDirectory);
    assert.equal(files.length, 2);
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(outputDirectory, path.basename(gif.image.url)))),
      gifBytes,
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(outputDirectory, path.basename(video.video.url)))),
      videoBytes,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
test("rejects video larger than the configured Pages asset limit", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-large-video-"));
  const entry = createEntry([{
    id: "large-video",
    type: "video",
    richText: [],
    children: [],
    video: {
      url: "https://files.example/large.mp4",
      source: "notion",
      expiryTime: null,
      localized: false,
    },
  }]);

  try {
    await assert.rejects(
      localizeContentEntryMediaForTest(entry, {
        outputDirectory,
        maxVideoBytes: 3,
        fetchImpl: async () =>
          new Response(Uint8Array.from([1, 2, 3, 4]), {
            headers: { "Content-Type": "video/mp4", "Content-Length": "4" },
          }),
      }),
      /Notion 视频声明大小超过 3 字节/,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("rejects media whose bytes do not match the declared type", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-invalid-media-"));
  const entry = createEntry([{
    id: "fake-gif",
    type: "image",
    richText: [],
    children: [],
    image: {
      url: "https://files.example/fake.gif",
      alt: "伪装图片",
      source: "notion",
      expiryTime: null,
      localized: false,
    },
  }]);

  try {
    await assert.rejects(
      localizeContentEntryMediaForTest(entry, {
        outputDirectory,
        fetchImpl: async () =>
          new Response("<html>not an image</html>", {
            headers: { "Content-Type": "image/gif" },
          }),
      }),
      /Notion 图片内容与 \.gif 格式不匹配/,
    );
    assert.deepEqual(await readdir(outputDirectory), []);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

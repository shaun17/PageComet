import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let localizeContentEntriesMediaForTest;
let localizeContentEntryMediaForTest;
let normalizeNotionBlock;
/** 使用项目自身的 Vite 配置加载 TypeScript，确保测试与 Astro 构建采用同一规则。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ localizeContentEntriesMediaForTest, localizeContentEntryMediaForTest } =
    await vite.ssrLoadModule("/src/lib/notion/assets.ts"));
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
  repositoryUrl: null,
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

test("preserves Notion audio source and expiry metadata during normalization", () => {
  const block = normalizeNotionBlock(
    {
      object: "block",
      id: "audio-block",
      type: "audio",
      has_children: false,
      audio: {
        type: "file",
        file: {
          url: "https://prod-files-secure.example/demo.wav?X-Amz-Signature=temporary",
          expiry_time: "2026-07-19T01:00:00.000Z",
        },
        caption: [],
      },
    },
    [],
  );

  assert.deepEqual(block.audio, {
    url: "https://prod-files-secure.example/demo.wav?X-Amz-Signature=temporary",
    source: "notion",
    expiryTime: "2026-07-19T01:00:00.000Z",
    localized: false,
  });
  assert.equal(block.url, undefined);
});

test("derives a stable media cache key from the block version, not its signed URL", () => {
  /** 使用不同签名构造同一个未编辑媒体块。 */
  const normalize = (signature) =>
    normalizeNotionBlock(
      {
        object: "block",
        id: "stable-image-block",
        type: "image",
        has_children: false,
        last_edited_time: "2026-07-19T01:00:00.000Z",
        image: {
          type: "file",
          file: {
            url: `https://files.example/demo.png?X-Amz-Signature=${signature}`,
            expiry_time: "2026-07-19T02:00:00.000Z",
          },
          caption: [],
        },
      },
      [],
    );

  const first = normalize("first");
  const refreshed = normalize("refreshed");
  assert.equal(
    first.image.cacheKey,
    "block:stable-image-block:2026-07-19T01:00:00.000Z",
  );
  assert.equal(refreshed.image.cacheKey, first.image.cacheKey);
  assert.notEqual(refreshed.image.url, first.image.url);
});

test("localizes GIF, uploaded video, and uploaded audio without changing bytes", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-notion-media-"));
  // 最小 GIF 头声明 1×2 画布，足以验证下载过程会保留字节并提取固有尺寸。
  const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  const videoBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3]);
  // 空白 WAV 仍具有完整容器头，可验证音频签名与静态文件落盘。
  const audioBytes = Uint8Array.from([
    82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0,
    1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0,
  ]);
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
    {
      id: "audio",
      type: "audio",
      richText: [],
      children: [],
      audio: {
        url: "https://files.example/demo.wav?X-Amz-Signature=audio",
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
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes(".gif")) {
          return new Response(gifBytes, { headers: { "Content-Type": "image/gif" } });
        }
        if (url.includes(".wav")) {
          return new Response(audioBytes, { headers: { "Content-Type": "audio/wav" } });
        }
        return new Response(videoBytes, { headers: { "Content-Type": "video/mp4" } });
      },
    });
    const [gif, video, audio] = localized.blocks;

    assert.match(gif.image.url, /^\/notion-assets\/[a-f0-9]{64}\.gif$/);
    assert.match(video.video.url, /^\/notion-assets\/[a-f0-9]{64}\.mp4$/);
    assert.match(audio.audio.url, /^\/notion-assets\/[a-f0-9]{64}\.wav$/);
    assert.equal(gif.image.localized, true);
    assert.equal(gif.image.width, 1);
    assert.equal(gif.image.height, 2);
    assert.equal(video.video.localized, true);
    assert.equal(audio.audio.localized, true);
    assert.equal(gif.image.expiryTime, null);
    assert.equal(video.video.expiryTime, null);
    assert.equal(audio.audio.expiryTime, null);

    const files = await readdir(outputDirectory);
    assert.equal(files.length, 3);
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(outputDirectory, path.basename(gif.image.url)))),
      gifBytes,
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(outputDirectory, path.basename(video.video.url)))),
      videoBytes,
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(outputDirectory, path.basename(audio.audio.url)))),
      audioBytes,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("reuses persistent media across builds while preserving each image alt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenren-media-cache-"));
  const cacheDirectory = path.join(root, "cache");
  const firstOutput = path.join(root, "first-output");
  const secondOutput = path.join(root, "second-output");
  const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  let fetchCount = 0;
  /** 构造签名会刷新、但 Notion 块版本不变的图片。 */
  const cachedEntry = (signature, alt) =>
    createEntry([{
      id: "cached-image",
      type: "image",
      richText: [],
      children: [],
      image: {
        url: `https://files.example/demo.gif?X-Amz-Signature=${signature}`,
        alt,
        source: "notion",
        expiryTime: "2026-07-19T02:00:00.000Z",
        localized: false,
        cacheKey: "block:cached-image:2026-07-19T01:00:00.000Z",
      },
    }]);
  const fetchImpl = async () => {
    fetchCount += 1;
    return new Response(gifBytes, { headers: { "Content-Type": "image/gif" } });
  };

  try {
    const first = await localizeContentEntryMediaForTest(
      cachedEntry("first", "第一次说明"),
      { outputDirectory: firstOutput, cacheDirectory, fetchImpl },
    );
    const second = await localizeContentEntryMediaForTest(
      cachedEntry("refreshed", "第二次说明"),
      { outputDirectory: secondOutput, cacheDirectory, fetchImpl },
    );

    assert.equal(fetchCount, 1);
    assert.equal(second.blocks[0].image.url, first.blocks[0].image.url);
    assert.equal(second.blocks[0].image.alt, "第二次说明");
    assert.deepEqual(
      new Uint8Array(
        await readFile(path.join(secondOutput, path.basename(second.blocks[0].image.url))),
      ),
      gifBytes,
    );
    const entryFiles = await readdir(path.join(cacheDirectory, "entries"));
    const objectFiles = await readdir(path.join(cacheDirectory, "objects"));
    assert.equal(entryFiles.length, 1);
    assert.equal(objectFiles.length, 1);
    const cacheIndex = await readFile(
      path.join(cacheDirectory, "entries", entryFiles[0]),
      "utf8",
    );
    assert.doesNotMatch(cacheIndex, /X-Amz-Signature|https:\/\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloads a replacement when the Notion media version changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenren-media-cache-version-"));
  const cacheDirectory = path.join(root, "cache");
  const firstBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  const secondBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 2, 0, 0, 0, 0]);
  let fetchCount = 0;
  /** 缓存版本随块更新时间变化，资源替换后必须形成新条目。 */
  const versionedEntry = (version) =>
    createEntry([{
      id: "versioned-image",
      type: "image",
      richText: [],
      children: [],
      image: {
        url: `https://files.example/demo-${version}.gif`,
        alt: "版本图片",
        source: "notion",
        expiryTime: null,
        localized: false,
        cacheKey: `block:versioned-image:${version}`,
      },
    }]);

  try {
    const first = await localizeContentEntryMediaForTest(versionedEntry("v1"), {
      outputDirectory: path.join(root, "first-output"),
      cacheDirectory,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(firstBytes, { headers: { "Content-Type": "image/gif" } });
      },
    });
    const second = await localizeContentEntryMediaForTest(versionedEntry("v2"), {
      outputDirectory: path.join(root, "second-output"),
      cacheDirectory,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(secondBytes, { headers: { "Content-Type": "image/gif" } });
      },
    });

    assert.equal(fetchCount, 2);
    assert.notEqual(second.blocks[0].image.url, first.blocks[0].image.url);
    assert.equal(second.blocks[0].image.width, 2);
    assert.equal((await readdir(path.join(cacheDirectory, "entries"))).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repairs a corrupted persistent media object by downloading it again", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wenren-media-cache-repair-"));
  const cacheDirectory = path.join(root, "cache");
  const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  const entry = createEntry([{
    id: "repair-image",
    type: "image",
    richText: [],
    children: [],
    image: {
      url: "https://files.example/repair.gif?signature=first",
      alt: "修复图片",
      source: "notion",
      expiryTime: null,
      localized: false,
      cacheKey: "block:repair-image:v1",
    },
  }]);
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return new Response(gifBytes, { headers: { "Content-Type": "image/gif" } });
  };

  try {
    await localizeContentEntryMediaForTest(entry, {
      outputDirectory: path.join(root, "first-output"),
      cacheDirectory,
      fetchImpl,
    });
    const [objectFile] = await readdir(path.join(cacheDirectory, "objects"));
    await writeFile(
      path.join(cacheDirectory, "objects", objectFile),
      new Uint8Array(gifBytes.byteLength),
    );

    await localizeContentEntryMediaForTest(
      {
        ...entry,
        blocks: [{
          ...entry.blocks[0],
          image: {
            ...entry.blocks[0].image,
            url: "https://files.example/repair.gif?signature=refreshed",
          },
        }],
      },
      {
        outputDirectory: path.join(root, "second-output"),
        cacheDirectory,
        fetchImpl,
      },
    );

    assert.equal(fetchCount, 2);
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(cacheDirectory, "objects", objectFile))),
      gifBytes,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("localizes site media with bounded concurrency", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-media-pool-"));
  const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 2, 0, 0, 0, 0]);
  let activeCount = 0;
  let maximumActiveCount = 0;
  let startedCount = 0;
  let releaseDownloads;
  const downloadGate = new Promise((resolve) => {
    releaseDownloads = resolve;
  });
  const entries = [1, 2, 3].map((index) =>
    createEntry([
      {
        id: `image-${index}`,
        type: "image",
        richText: [],
        children: [],
        image: {
          url: `https://files.example/demo-${index}.gif`,
          alt: `图片 ${index}`,
          source: "notion",
          expiryTime: null,
          localized: false,
        },
      },
    ]),
  );

  try {
    const pending = localizeContentEntriesMediaForTest(entries, {
      outputDirectory,
      concurrency: 2,
      fetchImpl: async () => {
        activeCount += 1;
        startedCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        await downloadGate;
        activeCount -= 1;
        return new Response(gifBytes, { headers: { "Content-Type": "image/gif" } });
      },
    });

    // 前两个下载占满任务池后，第三个必须等待任意槽位释放。
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(startedCount, 2);
    assert.equal(maximumActiveCount, 2);
    releaseDownloads();

    const localized = await pending;
    assert.equal(startedCount, 3);
    assert.equal(maximumActiveCount, 2);
    assert.equal(localized.every((entry) => entry.blocks[0].image.localized), true);
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

test("rejects audio larger than the configured Pages asset limit", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "wenren-large-audio-"));
  const entry = createEntry([{
    id: "large-audio",
    type: "audio",
    richText: [],
    children: [],
    audio: {
      url: "https://files.example/large.wav",
      source: "notion",
      expiryTime: null,
      localized: false,
    },
  }]);

  try {
    await assert.rejects(
      localizeContentEntryMediaForTest(entry, {
        outputDirectory,
        maxAudioBytes: 3,
        fetchImpl: async () =>
          new Response(Uint8Array.from([1, 2, 3, 4]), {
            headers: { "Content-Type": "audio/wav", "Content-Length": "4" },
          }),
      }),
      /Notion 音频声明大小超过 3 字节/,
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

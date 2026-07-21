import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import {
  createPublicRemoteFetcher,
  createUnsafeTestRemoteFetcher,
  fetchPublicResource,
  type PublicRemoteFetcher,
} from "../network/public-remote-fetch";
import {
  resolveMediaExtension,
  validateMediaSignature,
  type MediaKind,
} from "./media-formats";
import type {
  ContentBlock,
  ContentImage,
  ContentMedia,
  MediaLocalizationOptions,
  RenderableContentEntry,
} from "./types";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Cloudflare Pages 单个静态文件上限为 25 MiB，构建阶段提前给出明确错误。
const DEFAULT_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// 有界并发兼顾下载速度与构建内存；单个媒体最多可占用 25 MiB。
const DEFAULT_MEDIA_CONCURRENCY = 3;
const MAX_MEDIA_CONCURRENCY = 6;

interface ResolvedMediaLocalizationOptions {
  outputDirectory: string;
  publicPath: string;
  maxImageBytes: number;
  maxVideoBytes: number;
  maxAudioBytes: number;
  fetchImpl: typeof fetch;
  localizeExternalImages: boolean;
  localizeExternalVideos: boolean;
  localizeExternalAudios: boolean;
  maxRedirects: number;
  requestTimeoutMs: number;
}

interface MediaLocalizationTestOptions extends MediaLocalizationOptions {
  fetchImpl: typeof fetch;
}

interface MediaLocalizationRuntime {
  options: ResolvedMediaLocalizationOptions;
  runDownload: <T extends ContentMedia>(media: T, kind: MediaKind) => Promise<T>;
}

/** 校验媒体并发配置，避免错误配置造成无界内存占用。 */
const resolveMediaConcurrency = (value: number | undefined): number => {
  const concurrency = value ?? DEFAULT_MEDIA_CONCURRENCY;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_MEDIA_CONCURRENCY
  ) {
    throw new Error(`媒体下载并发数必须是 1-${MAX_MEDIA_CONCURRENCY} 的整数`);
  }
  return concurrency;
};

/** 创建轻量任务池，确保整个站点同时下载的媒体数量不超过上限。 */
const createTaskLimiter = (concurrency: number) => {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  /** 填满可用槽位；任务结束时再次调度，避免唤醒等待者时发生抢占。 */
  const drain = (): void => {
    while (activeCount < concurrency && queue.length > 0) {
      activeCount += 1;
      queue.shift()!();
    }
  };

  /** 将任务加入队列，并在成功或失败后可靠释放槽位。 */
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const result = new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            drain();
          });
      });
    });
    drain();
    return result;
  };

  return run;
};

/** 在读取响应流时执行硬性大小限制，避免异常资源耗尽构建内存。 */
const readLimitedBody = async (
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label}响应缺少可读内容`);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label}超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MiB 限制`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/** 从图片字节读取浏览器实际展示方向；带旋转标记的照片需要交换宽高。 */
const readImageDimensions = (
  body: Uint8Array,
): Pick<ContentImage, "width" | "height"> => {
  try {
    const dimensions = imageSize(body);
    if (dimensions.width <= 0 || dimensions.height <= 0) return {};
    const orientation = dimensions.orientation ?? 1;
    const swapsAxes = orientation >= 5 && orientation <= 8;
    return swapsAxes
      ? { width: dimensions.height, height: dimensions.width }
      : { width: dimensions.width, height: dimensions.height };
  } catch {
    // 极少数合法图片可能没有可解析的固有尺寸，页面加载后会用 naturalWidth 兜底。
    return {};
  }
};

/** 统一 public URL 前缀，防止重复或缺失斜杠。 */
const normalizePublicPath = (value: string): string =>
  `/${value.replace(/^\/+|\/+$/g, "")}`;

/** 生产构建写入 dist，开发服务器则从 public 提供生成的媒体文件。 */
const resolveDefaultOutputDirectory = (): string => {
  const root = process.cwd();
  return process.env.NODE_ENV === "development"
    ? path.resolve(root, "public/notion-assets")
    : path.resolve(root, "dist/notion-assets");
};

/** 下载单个临时媒体并原子替换目标文件，失败不会留下半截资源。 */
const downloadMedia = async <T extends ContentMedia>(
  media: T,
  kind: MediaKind,
  options: ResolvedMediaLocalizationOptions,
): Promise<T> => {
  const label =
    kind === "image" ? "Notion 图片" : kind === "video" ? "Notion 视频" : "Notion 音频";
  let source: URL;
  try {
    source = new URL(media.url);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (source.protocol !== "https:") throw new Error(`${label}地址必须使用 HTTPS`);

  let response: Response;
  let resolvedSource: URL;
  try {
    const result = await fetchPublicResource(source, {
      fetchImpl: options.fetchImpl,
      maxRedirects: options.maxRedirects,
      requestTimeoutMs: options.requestTimeoutMs,
      requireHttps: true,
    });
    response = result.response;
    resolvedSource = result.url;
  } catch (error) {
    const reason = error instanceof Error ? `：${error.message}` : "";
    throw new Error(`${label}下载请求失败${reason}`, { cause: error });
  }
  let bodyConsumed = false;
  try {
    if (!response.ok) throw new Error(`下载${label}失败：HTTP ${response.status}`);

    const maxBytes =
      kind === "image"
        ? options.maxImageBytes
        : kind === "video"
          ? options.maxVideoBytes
          : options.maxAudioBytes;
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error(`${label}声明大小超过 ${maxBytes} 字节`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const extension = resolveMediaExtension(kind, contentType, resolvedSource);
    const body = await readLimitedBody(response, maxBytes, label);
    bodyConsumed = true;
    validateMediaSignature(kind, extension, body);
    const dimensions = kind === "image" ? readImageDimensions(body) : {};
    const contentHash = createHash("sha256").update(body).digest("hex");
    const fileName = `${contentHash}${extension}`;
    const destination = path.join(options.outputDirectory, fileName);
    const temporary = `${destination}.${randomUUID()}.tmp`;

    await mkdir(options.outputDirectory, { recursive: true });
    try {
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    return {
      ...media,
      ...dimensions,
      url: `${normalizePublicPath(options.publicPath)}/${fileName}`,
      expiryTime: null,
      localized: true,
    };
  } finally {
    if (!bodyConsumed) await response.body?.cancel().catch(() => undefined);
  }
};

/** 递归本地化正文中的图片、视频与音频，并保持块对象不可变。 */
const localizeBlocks = async (
  blocks: ContentBlock[],
  runtime: MediaLocalizationRuntime,
): Promise<ContentBlock[]> =>
  Promise.all(
    blocks.map(async (block) => {
      const shouldDownloadImage =
        block.image?.source === "notion" ||
        (runtime.options.localizeExternalImages && !!block.image);
      const shouldDownloadVideo =
        block.video?.source === "notion" ||
        (runtime.options.localizeExternalVideos && !!block.video);
      const shouldDownloadAudio =
        block.audio?.source === "notion" ||
        (runtime.options.localizeExternalAudios && !!block.audio);
      // 子树和当前块媒体都进入同一个任务池，既并行处理又共享全站并发上限。
      const [children, image, video, audio] = await Promise.all([
        localizeBlocks(block.children, runtime),
        shouldDownloadImage
          ? runtime.runDownload(block.image!, "image")
          : block.image,
        shouldDownloadVideo
          ? runtime.runDownload(block.video!, "video")
          : block.video,
        shouldDownloadAudio
          ? runtime.runDownload(block.audio!, "audio")
          : block.audio,
      ]);
      return { ...block, children, image, video, audio };
    }),
  );

/** 使用一个远端连接池批量本地化条目，生产与离线测试共享完整校验和写入流程。 */
const localizeContentEntriesMediaInternal = async <T extends RenderableContentEntry>(
  entries: T[],
  options: MediaLocalizationOptions,
  remoteFetcher: PublicRemoteFetcher,
): Promise<T[]> => {
  const resolvedOptions: ResolvedMediaLocalizationOptions = {
    outputDirectory: options.outputDirectory ?? resolveDefaultOutputDirectory(),
    publicPath: options.publicPath ?? "/notion-assets",
    maxImageBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxVideoBytes: options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES,
    maxAudioBytes: options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
    fetchImpl: remoteFetcher.fetch,
    localizeExternalImages: options.localizeExternalImages ?? false,
    localizeExternalVideos: options.localizeExternalVideos ?? false,
    localizeExternalAudios: options.localizeExternalAudios ?? false,
    maxRedirects: options.maxRedirects ?? 5,
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
  };
  const limitTask = createTaskLimiter(resolveMediaConcurrency(options.concurrency));
  const inFlightDownloads = new Map<string, Promise<ContentMedia>>();

  /** 相同媒体只下载一次，并把所有真实下载统一放入有界任务池。 */
  const runDownload = <TMedia extends ContentMedia>(
    media: TMedia,
    kind: MediaKind,
  ): Promise<TMedia> => {
    // 图片替代文本属于展示语义，纳入键值可避免同地址不同说明互相覆盖。
    const semanticSuffix = "alt" in media ? `:${String(media.alt)}` : "";
    const key = `${kind}:${media.url}${semanticSuffix}`;
    const existing = inFlightDownloads.get(key);
    if (existing) return existing as Promise<TMedia>;

    const pending = limitTask(() => downloadMedia(media, kind, resolvedOptions));
    inFlightDownloads.set(key, pending);
    return pending;
  };

  const runtime: MediaLocalizationRuntime = { options: resolvedOptions, runDownload };
  try {
    return await Promise.all(
      entries.map(async (entry) => {
        const shouldLocalizeCover =
          entry.cover?.source === "notion" ||
          (resolvedOptions.localizeExternalImages && !!entry.cover);
        const [cover, blocks] = await Promise.all([
          shouldLocalizeCover
            ? runDownload(entry.cover!, "image")
            : entry.cover,
          localizeBlocks(entry.blocks, runtime),
        ]);
        return { ...entry, cover, blocks };
      }),
    );
  } finally {
    await remoteFetcher.close();
  }
};

/** 将多个条目的临时媒体通过一个安全公网连接池转存到 Astro 静态资源目录。 */
export const localizeContentEntriesMedia = async <T extends RenderableContentEntry>(
  entries: T[],
  options: MediaLocalizationOptions = {},
): Promise<T[]> =>
  localizeContentEntriesMediaInternal(entries, options, createPublicRemoteFetcher());

/** 保留单条入口兼容性，内部仍复用批量本地化的安全边界。 */
export const localizeContentEntryMedia = async <T extends RenderableContentEntry>(
  entry: T,
  options: MediaLocalizationOptions = {},
): Promise<T> => (await localizeContentEntriesMedia([entry], options))[0]!;

/** 仅供离线测试批量注入固定媒体响应，不会被正式内容构建调用。 */
export const localizeContentEntriesMediaForTest = async <
  T extends RenderableContentEntry,
>(
  entries: T[],
  options: MediaLocalizationTestOptions,
): Promise<T[]> =>
  localizeContentEntriesMediaInternal(
    entries,
    options,
    createUnsafeTestRemoteFetcher(options.fetchImpl),
  );

/** 仅供离线测试注入固定媒体响应，不会被正式内容构建调用。 */
export const localizeContentEntryMediaForTest = async <T extends RenderableContentEntry>(
  entry: T,
  options: MediaLocalizationTestOptions,
): Promise<T> => (await localizeContentEntriesMediaForTest([entry], options))[0]!;

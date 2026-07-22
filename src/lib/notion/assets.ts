import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
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
const MEDIA_CACHE_VERSION = 1;
const CONTENT_HASH_FILE_PATTERN = /^([a-f0-9]{64})(\.[a-z0-9]+)$/;

interface ResolvedMediaLocalizationOptions {
  outputDirectory: string;
  publicPath: string;
  cacheDirectory: string | null;
  maxImageBytes: number;
  maxVideoBytes: number;
  maxAudioBytes: number;
  fetchImpl: typeof fetch;
  localizeExternalImages: boolean;
  localizeExternalVideos: boolean;
  localizeExternalAudios: boolean;
  maxRedirects: number;
  requestTimeoutMs: number;
  reportCacheStats: boolean;
}

interface MediaLocalizationTestOptions extends MediaLocalizationOptions {
  fetchImpl: typeof fetch;
}

interface MediaLocalizationRuntime {
  options: ResolvedMediaLocalizationOptions;
  localizeMedia: <T extends ContentMedia>(media: T, kind: MediaKind) => Promise<T>;
}

interface LocalizedMediaAsset {
  fileName: string;
  byteLength: number;
  width?: number;
  height?: number;
}

interface DownloadedMediaAsset extends LocalizedMediaAsset {
  body: Uint8Array;
}

interface StoredMediaAsset extends LocalizedMediaAsset {
  filePath: string;
}

interface MediaCacheEntry extends LocalizedMediaAsset {
  version: typeof MEDIA_CACHE_VERSION;
  kind: MediaKind;
}

interface MediaCacheStats {
  hits: number;
  misses: number;
  downloads: number;
  reusedBytes: number;
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

/** 持久资源库独立于 dist，Astro 清理输出目录时不会丢失已下载媒体。 */
const resolveDefaultCacheDirectory = (): string =>
  path.resolve(process.cwd(), ".cache/notion-assets");

/** 判断文件读取失败是否仅表示目标不存在。 */
const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** 使用临时文件原子更新缓存或输出，进程中断不会留下半截内容。 */
const writeFileAtomically = async (
  destination: string,
  body: Uint8Array | string,
): Promise<void> => {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

/** 只允许内容哈希文件名进入路径拼接，缓存索引无法越过资源目录。 */
const parseContentHashFileName = (
  fileName: unknown,
): { hash: string; extension: string } | null => {
  if (typeof fileName !== "string" || path.basename(fileName) !== fileName) return null;
  const match = fileName.match(CONTENT_HASH_FILE_PATTERN);
  return match ? { hash: match[1]!, extension: match[2]! } : null;
};

/** 将不可信 JSON 收窄为当前版本的媒体缓存索引。 */
const parseMediaCacheEntry = (
  value: unknown,
  kind: MediaKind,
): MediaCacheEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MediaCacheEntry>;
  if (
    candidate.version !== MEDIA_CACHE_VERSION ||
    candidate.kind !== kind ||
    !parseContentHashFileName(candidate.fileName) ||
    !Number.isInteger(candidate.byteLength) ||
    (candidate.byteLength ?? 0) <= 0
  ) {
    return null;
  }
  for (const dimension of [candidate.width, candidate.height]) {
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) {
      return null;
    }
  }
  return candidate as MediaCacheEntry;
};

/** 缓存身份只使用 Notion 对象版本，不写入临时签名 URL。 */
const createMediaCacheEntryId = (
  media: ContentMedia,
  kind: MediaKind,
): string | null => {
  if (media.source !== "notion" || !media.cacheKey) return null;
  return createHash("sha256")
    .update(`notion-media-v${MEDIA_CACHE_VERSION}\0${kind}\0${media.cacheKey}`)
    .digest("hex");
};

/** 读取并重新校验本地缓存；索引或资源损坏时删除坏项并回退到下载。 */
const readCachedMediaAsset = async (
  cacheDirectory: string,
  entryId: string,
  kind: MediaKind,
): Promise<StoredMediaAsset | null> => {
  const entryPath = path.join(cacheDirectory, "entries", `${entryId}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(entryPath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    if (error instanceof SyntaxError) {
      await rm(entryPath, { force: true });
      return null;
    }
    throw error;
  }

  const entry = parseMediaCacheEntry(parsed, kind);
  if (!entry) {
    await rm(entryPath, { force: true });
    return null;
  }
  const fileName = parseContentHashFileName(entry.fileName)!;
  const filePath = path.join(cacheDirectory, "objects", entry.fileName);
  let body: Uint8Array;
  try {
    body = await readFile(filePath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    await rm(entryPath, { force: true });
    return null;
  }

  try {
    if (body.byteLength !== entry.byteLength) throw new Error("缓存资源大小不匹配");
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (actualHash !== fileName.hash) throw new Error("缓存资源哈希不匹配");
    validateMediaSignature(kind, fileName.extension, body);
  } catch {
    // 内容哈希文件损坏后所有引用都不再可信，删除对象并让本次构建重新下载。
    await Promise.all([
      rm(entryPath, { force: true }),
      rm(filePath, { force: true }),
    ]);
    return null;
  }

  return {
    fileName: entry.fileName,
    byteLength: entry.byteLength,
    ...(entry.width ? { width: entry.width } : {}),
    ...(entry.height ? { height: entry.height } : {}),
    filePath,
  };
};

/** 将已验证的远端资源写入内容寻址资源库，并原子记录其稳定身份。 */
const storeCachedMediaAsset = async (
  cacheDirectory: string,
  entryId: string,
  kind: MediaKind,
  asset: DownloadedMediaAsset,
): Promise<StoredMediaAsset> => {
  const filePath = path.join(cacheDirectory, "objects", asset.fileName);
  const entryPath = path.join(cacheDirectory, "entries", `${entryId}.json`);
  const entry: MediaCacheEntry = {
    version: MEDIA_CACHE_VERSION,
    kind,
    fileName: asset.fileName,
    byteLength: asset.byteLength,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
  };
  await writeFileAtomically(filePath, asset.body);
  await writeFileAtomically(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
  return {
    fileName: asset.fileName,
    byteLength: asset.byteLength,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    filePath,
  };
};

/** 从资源库硬链接到本次产物；跨文件系统时自动退回普通复制。 */
const materializeCachedMediaAsset = async (
  asset: StoredMediaAsset,
  outputDirectory: string,
): Promise<void> => {
  const destination = path.join(outputDirectory, asset.fileName);
  if (path.resolve(destination) === path.resolve(asset.filePath)) return;
  await mkdir(outputDirectory, { recursive: true });
  try {
    await link(asset.filePath, destination);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return;
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EXDEV", "EPERM", "ENOTSUP"].includes(String(error.code))
    ) {
      throw error;
    }
    await copyFile(asset.filePath, destination);
  }
};

/** 下载单个临时媒体，完成大小、格式和内容签名校验后返回可信字节。 */
const downloadMediaAsset = async (
  media: ContentMedia,
  kind: MediaKind,
  options: ResolvedMediaLocalizationOptions,
): Promise<DownloadedMediaAsset> => {
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
    return {
      body,
      byteLength: body.byteLength,
      ...dimensions,
      fileName,
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
          ? runtime.localizeMedia(block.image!, "image")
          : block.image,
        shouldDownloadVideo
          ? runtime.localizeMedia(block.video!, "video")
          : block.video,
        shouldDownloadAudio
          ? runtime.localizeMedia(block.audio!, "audio")
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
    cacheDirectory:
      options.cacheDirectory === false
        ? null
        : path.resolve(options.cacheDirectory ?? resolveDefaultCacheDirectory()),
    maxImageBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxVideoBytes: options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES,
    maxAudioBytes: options.maxAudioBytes ?? DEFAULT_MAX_AUDIO_BYTES,
    fetchImpl: remoteFetcher.fetch,
    localizeExternalImages: options.localizeExternalImages ?? false,
    localizeExternalVideos: options.localizeExternalVideos ?? false,
    localizeExternalAudios: options.localizeExternalAudios ?? false,
    maxRedirects: options.maxRedirects ?? 5,
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    reportCacheStats: options.reportCacheStats ?? false,
  };
  const limitTask = createTaskLimiter(resolveMediaConcurrency(options.concurrency));
  const inFlightAssets = new Map<string, Promise<LocalizedMediaAsset>>();
  const inFlightDownloads = new Map<string, Promise<DownloadedMediaAsset>>();
  const stats: MediaCacheStats = { hits: 0, misses: 0, downloads: 0, reusedBytes: 0 };

  /** 同一临时来源在一次构建中只发起一次真实下载。 */
  const downloadOnce = (
    media: ContentMedia,
    kind: MediaKind,
  ): Promise<DownloadedMediaAsset> => {
    const sourceKey = `${kind}:${media.url}`;
    const existing = inFlightDownloads.get(sourceKey);
    if (existing) return existing;
    stats.downloads += 1;
    const pending = downloadMediaAsset(media, kind, resolvedOptions);
    inFlightDownloads.set(sourceKey, pending);
    return pending;
  };

  /** 优先复用持久资源库，未命中时下载并把可信结果写回缓存。 */
  const resolveLocalizedAsset = (
    media: ContentMedia,
    kind: MediaKind,
  ): Promise<LocalizedMediaAsset> => {
    const entryId = resolvedOptions.cacheDirectory
      ? createMediaCacheEntryId(media, kind)
      : null;
    const taskKey = entryId ? `cache:${entryId}` : `source:${kind}:${media.url}`;
    const existing = inFlightAssets.get(taskKey);
    if (existing) return existing;

    const pending = limitTask(async () => {
      if (entryId && resolvedOptions.cacheDirectory) {
        const cached = await readCachedMediaAsset(
          resolvedOptions.cacheDirectory,
          entryId,
          kind,
        );
        if (cached) {
          stats.hits += 1;
          stats.reusedBytes += cached.byteLength;
          await materializeCachedMediaAsset(cached, resolvedOptions.outputDirectory);
          return cached;
        }
        stats.misses += 1;
      }

      const downloaded = await downloadOnce(media, kind);
      if (entryId && resolvedOptions.cacheDirectory) {
        const stored = await storeCachedMediaAsset(
          resolvedOptions.cacheDirectory,
          entryId,
          kind,
          downloaded,
        );
        await materializeCachedMediaAsset(stored, resolvedOptions.outputDirectory);
      } else {
        await writeFileAtomically(
          path.join(resolvedOptions.outputDirectory, downloaded.fileName),
          downloaded.body,
        );
      }
      return {
        fileName: downloaded.fileName,
        byteLength: downloaded.byteLength,
        ...(downloaded.width ? { width: downloaded.width } : {}),
        ...(downloaded.height ? { height: downloaded.height } : {}),
      };
    });
    inFlightAssets.set(taskKey, pending);
    return pending;
  };

  /** 媒体展示语义保留在各自对象中，二进制资源可以安全跨条目复用。 */
  const localizeMedia = async <TMedia extends ContentMedia>(
    media: TMedia,
    kind: MediaKind,
  ): Promise<TMedia> => {
    const asset = await resolveLocalizedAsset(media, kind);
    return {
      ...media,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      url: `${normalizePublicPath(resolvedOptions.publicPath)}/${asset.fileName}`,
      expiryTime: null,
      localized: true,
    };
  };

  const runtime: MediaLocalizationRuntime = { options: resolvedOptions, localizeMedia };
  try {
    return await Promise.all(
      entries.map(async (entry) => {
        const shouldLocalizeCover =
          entry.cover?.source === "notion" ||
          (resolvedOptions.localizeExternalImages && !!entry.cover);
        const [cover, blocks] = await Promise.all([
          shouldLocalizeCover
            ? localizeMedia(entry.cover!, "image")
            : entry.cover,
          localizeBlocks(entry.blocks, runtime),
        ]);
        return { ...entry, cover, blocks };
      }),
    );
  } finally {
    // 任一媒体失败时也等待已启动任务收尾，避免关闭连接池时打断其他缓存写入。
    await Promise.allSettled(inFlightAssets.values());
    if (resolvedOptions.reportCacheStats) {
      const reusedMiB = (stats.reusedBytes / 1024 / 1024).toFixed(2);
      console.info(
        `媒体缓存：命中 ${stats.hits}，未命中 ${stats.misses}，实际下载 ${stats.downloads}，复用 ${reusedMiB} MiB`,
      );
    }
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

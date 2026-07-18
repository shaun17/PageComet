import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveMediaExtension,
  validateMediaSignature,
  type MediaKind,
} from "./media-formats";
import type {
  ContentBlock,
  ContentEntry,
  ContentMedia,
  MediaLocalizationOptions,
} from "./types";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Cloudflare Pages 单个静态文件上限为 25 MiB，构建阶段提前给出明确错误。
const DEFAULT_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

interface ResolvedMediaLocalizationOptions {
  outputDirectory: string;
  publicPath: string;
  maxImageBytes: number;
  maxVideoBytes: number;
  fetchImpl: typeof fetch;
  localizeExternalImages: boolean;
  localizeExternalVideos: boolean;
}

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
      await reader.cancel();
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
  const label = kind === "image" ? "Notion 图片" : "Notion 视频";
  let source: URL;
  try {
    source = new URL(media.url);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (source.protocol !== "https:") throw new Error(`${label}地址必须使用 HTTPS`);

  let response: Response;
  try {
    response = await options.fetchImpl(source, { redirect: "follow" });
  } catch {
    throw new Error(`${label}下载请求失败`);
  }
  if (!response.ok) throw new Error(`下载${label}失败：HTTP ${response.status}`);
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new Error(`${label}下载被重定向到非 HTTPS 地址`);
  }

  const maxBytes = kind === "image" ? options.maxImageBytes : options.maxVideoBytes;
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new Error(`${label}声明大小超过 ${maxBytes} 字节`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = resolveMediaExtension(kind, contentType, source);
  const body = await readLimitedBody(response, maxBytes, label);
  validateMediaSignature(kind, extension, body);
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
    url: `${normalizePublicPath(options.publicPath)}/${fileName}`,
    expiryTime: null,
    localized: true,
  };
};

/** 递归本地化正文中的图片与 Notion 上传视频，并保持块对象不可变。 */
const localizeBlocks = async (
  blocks: ContentBlock[],
  options: ResolvedMediaLocalizationOptions,
): Promise<ContentBlock[]> => {
  const localized: ContentBlock[] = [];
  for (const block of blocks) {
    const children = await localizeBlocks(block.children, options);
    const shouldDownloadImage =
      block.image?.source === "notion" || (options.localizeExternalImages && !!block.image);
    const shouldDownloadVideo =
      block.video?.source === "notion" || (options.localizeExternalVideos && !!block.video);
    const image = shouldDownloadImage
      ? await downloadMedia(block.image!, "image", options)
      : block.image;
    const video = shouldDownloadVideo
      ? await downloadMedia(block.video!, "video", options)
      : block.video;
    localized.push({ ...block, children, image, video });
  }
  return localized;
};

/** 将 ContentEntry 内所有临时媒体转存到 Astro 静态资源目录。 */
export const localizeContentEntryMedia = async (
  entry: ContentEntry,
  options: MediaLocalizationOptions = {},
): Promise<ContentEntry> => {
  const resolvedOptions: ResolvedMediaLocalizationOptions = {
    outputDirectory: options.outputDirectory ?? resolveDefaultOutputDirectory(),
    publicPath: options.publicPath ?? "/notion-assets",
    maxImageBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxVideoBytes: options.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    localizeExternalImages: options.localizeExternalImages ?? false,
    localizeExternalVideos: options.localizeExternalVideos ?? false,
  };
  const shouldLocalizeCover =
    entry.cover?.source === "notion" ||
    (resolvedOptions.localizeExternalImages && !!entry.cover);
  const cover = shouldLocalizeCover
    ? await downloadMedia(entry.cover!, "image", resolvedOptions)
    : entry.cover;
  const blocks = await localizeBlocks(entry.blocks, resolvedOptions);
  return { ...entry, cover, blocks };
};

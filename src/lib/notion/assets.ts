import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentBlock, ContentEntry, ContentImage, ImageLocalizationOptions } from "./types";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** 从响应类型或 URL 推断受支持的位图后缀，拒绝 SVG 和未知格式。 */
const resolveImageExtension = (contentType: string, sourceUrl: URL): string => {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType) {
    const extension = CONTENT_TYPE_EXTENSIONS[mediaType];
    if (!extension) throw new Error(`Notion 图片格式不受支持：${mediaType}`);
    return extension;
  }

  const extension = path.extname(sourceUrl.pathname).toLowerCase();
  if ([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)) {
    return extension;
  }
  throw new Error("Notion 图片缺少可识别的安全格式");
};

/** 在读取响应流时执行硬性大小限制，避免异常资源耗尽构建内存。 */
const readLimitedBody = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图片响应缺少可读内容");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Notion 图片超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MB 限制`);
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

/**
 * Astro 在静态路由执行前已经复制 public，因此生产构建必须直接写入 dist。
 * 开发服务器则从 public 提供静态文件，两种模式分别选择正确目录。
 */
const resolveDefaultOutputDirectory = (): string => {
  const root = process.cwd();
  return process.env.NODE_ENV === "development"
    ? path.resolve(root, "public/notion-assets")
    : path.resolve(root, "dist/notion-assets");
};

/** 下载单张临时图片并原子替换目标文件，失败不会污染已构建资源。 */
const downloadImage = async (
  image: ContentImage,
  options: Required<Pick<ImageLocalizationOptions, "outputDirectory" | "publicPath" | "maxBytes">> & {
    fetchImpl: typeof fetch;
    localizeExternal: boolean;
  },
): Promise<ContentImage> => {
  let source: URL;
  try {
    source = new URL(image.url);
  } catch {
    throw new Error("Notion 图片地址无效");
  }
  if (source.protocol !== "https:") throw new Error("Notion 图片地址必须使用 HTTPS");

  let response: Response;
  try {
    response = await options.fetchImpl(source, { redirect: "follow" });
  } catch {
    throw new Error("Notion 图片下载请求失败");
  }
  if (!response.ok) throw new Error(`下载 Notion 图片失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Notion 图片返回了非图片类型：${contentType}`);
  }

  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > options.maxBytes) {
    throw new Error(`Notion 图片声明大小超过 ${options.maxBytes} 字节`);
  }

  const body = await readLimitedBody(response, options.maxBytes);
  const extension = resolveImageExtension(contentType, source);
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
    ...image,
    url: `${normalizePublicPath(options.publicPath)}/${fileName}`,
    expiryTime: null,
    localized: true,
  };
};

/** 递归本地化正文块中的图片，并保持原始块对象不可变。 */
const localizeBlocks = async (
  blocks: ContentBlock[],
  options: Parameters<typeof downloadImage>[1],
): Promise<ContentBlock[]> => {
  const localized: ContentBlock[] = [];
  for (const block of blocks) {
    const children = await localizeBlocks(block.children, options);
    const shouldDownload =
      block.image?.source === "notion" || (options.localizeExternal && !!block.image);
    const image = shouldDownload
      ? await downloadImage(block.image!, options)
      : block.image;
    localized.push({ ...block, children, image });
  }
  return localized;
};

/** 将 ContentEntry 内所有 Notion 临时图片转存到 Astro public 目录。 */
export const localizeContentEntryImages = async (
  entry: ContentEntry,
  options: ImageLocalizationOptions = {},
): Promise<ContentEntry> => {
  const resolvedOptions = {
    outputDirectory: options.outputDirectory ?? resolveDefaultOutputDirectory(),
    publicPath: options.publicPath ?? "/notion-assets",
    maxBytes: options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    localizeExternal: options.localizeExternal ?? false,
  };
  const shouldLocalizeCover =
    entry.cover?.source === "notion" || (options.localizeExternal === true && !!entry.cover);
  const cover = shouldLocalizeCover
    ? await downloadImage(entry.cover!, resolvedOptions)
    : entry.cover;
  const blocks = await localizeBlocks(entry.blocks, resolvedOptions);
  return { ...entry, cover, blocks };
};

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { preview, type PreviewResult } from "linkpeek";
import type { ContentLinkPreview } from "../lib/notion";
import {
  createPublicRemoteFetcher,
  createUnsafeTestRemoteFetcher,
  type PublicRemoteFetcher,
} from "../lib/network/public-remote-fetch";
import type { LinkPreviewResolver } from "./link-preview";

const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const STALE_SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface LinkPreviewCacheRecord {
  fetchedAt: number;
  status: "success" | "failure";
  preview?: ContentLinkPreview;
}

interface LinkPreviewResolverOptions {
  cacheDirectory?: string | false;
  now?: () => number;
}

interface LinkPreviewResolverTestOptions extends LinkPreviewResolverOptions {
  fetchImpl: typeof fetch;
}

export interface CachedLinkPreviewResolver {
  resolve: LinkPreviewResolver;
  close: () => Promise<void>;
}

/** 清理远端元数据中的控制符与异常空白，并按 Unicode 字符安全截断。 */
const normalizePreviewText = (value: string | null, maxLength: number): string | null => {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return [...normalized].slice(0, maxLength).join("");
};

/** 从 linkpeek 的完整结果中只保留页面真正展示的三个可信文本字段。 */
const normalizePreviewResult = (result: PreviewResult): ContentLinkPreview | null => {
  if (result.statusCode < 200 || result.statusCode >= 300) return null;
  const title = normalizePreviewText(result.title, 160);
  if (!title) return null;
  const siteName = normalizePreviewText(result.siteName, 80) ?? new URL(result.url).hostname;
  return {
    title,
    description: normalizePreviewText(result.description, 320),
    siteName,
  };
};

/** 用 URL 哈希生成无查询参数泄漏的缓存文件名。 */
const cacheFileFor = (cacheDirectory: string, url: string): string => {
  const digest = createHash("sha256").update(url).digest("hex");
  return path.join(cacheDirectory, `${digest}.json`);
};

/** 对磁盘缓存执行最小结构校验，损坏或旧格式会被当作未命中。 */
const readCacheRecord = async (
  cacheDirectory: string,
  url: string,
): Promise<LinkPreviewCacheRecord | null> => {
  try {
    const value = JSON.parse(await readFile(cacheFileFor(cacheDirectory, url), "utf8"));
    if (!value || typeof value !== "object") return null;
    if (typeof value.fetchedAt !== "number") return null;
    if (value.status === "failure") return value as LinkPreviewCacheRecord;
    const previewValue = value.preview;
    if (
      value.status !== "success" ||
      !previewValue ||
      typeof previewValue.title !== "string" ||
      typeof previewValue.siteName !== "string" ||
      !(typeof previewValue.description === "string" || previewValue.description === null)
    ) {
      return null;
    }
    return value as LinkPreviewCacheRecord;
  } catch {
    return null;
  }
};

/** 原子写入清洗后的缓存记录，构建中断不会留下半截 JSON。 */
const writeCacheRecord = async (
  cacheDirectory: string,
  url: string,
  record: LinkPreviewCacheRecord,
): Promise<void> => {
  const destination = cacheFileFor(cacheDirectory, url);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(cacheDirectory, { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(record), { flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

/** 用确定的公网抓取器创建缓存解析器，生产与离线测试共享缓存和清洗规则。 */
const createCachedLinkPreviewResolverInternal = (
  options: LinkPreviewResolverOptions,
  remoteFetcher: PublicRemoteFetcher,
): CachedLinkPreviewResolver => {
  const cacheDirectory =
    options.cacheDirectory === false
      ? null
      : options.cacheDirectory ?? path.resolve(process.cwd(), ".cache/link-previews/v1");
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<ContentLinkPreview | null>>();

  /** 读取缓存并在需要时抓取；失败结果短缓存，旧成功结果可离线兜底。 */
  const resolveUncached = async (url: string): Promise<ContentLinkPreview | null> => {
    const cached = cacheDirectory ? await readCacheRecord(cacheDirectory, url) : null;
    const age = cached ? now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
    if (cached?.status === "success" && age <= SUCCESS_TTL_MS) return cached.preview ?? null;
    if (cached?.status === "failure" && age <= FAILURE_TTL_MS) return null;

    try {
      const result = await preview(url, {
        fetch: remoteFetcher.fetch,
        timeout: 6_000,
        maxBytes: 64 * 1024,
        maxRedirects: 3,
        followRedirects: true,
        followMetaRefresh: false,
        includeBodyContent: false,
        allowPrivateIPs: false,
        userAgent: "astro-notion-portfolio-link-preview/1.0",
      });
      const resolved = normalizePreviewResult(result);
      if (!resolved) throw new Error(`链接摘要响应不可用：HTTP ${result.statusCode}`);
      if (cacheDirectory) {
        await writeCacheRecord(cacheDirectory, url, {
          fetchedAt: now(),
          status: "success",
          preview: resolved,
        }).catch(() => undefined);
      }
      return resolved;
    } catch (error) {
      if (cached?.status === "success" && age <= STALE_SUCCESS_TTL_MS) {
        return cached.preview ?? null;
      }
      if (cacheDirectory) {
        await writeCacheRecord(cacheDirectory, url, {
          fetchedAt: now(),
          status: "failure",
        }).catch(() => undefined);
      }
      throw error;
    }
  };

  return {
    resolve: (url) => {
      const pending = inFlight.get(url) ?? resolveUncached(url);
      inFlight.set(url, pending);
      return pending;
    },
    close: remoteFetcher.close,
  };
};

/** 创建带安全抓取、磁盘缓存和 stale-if-error 降级的生产链接摘要解析器。 */
export const createCachedLinkPreviewResolver = (
  options: LinkPreviewResolverOptions = {},
): CachedLinkPreviewResolver =>
  createCachedLinkPreviewResolverInternal(options, createPublicRemoteFetcher());

/** 仅供离线测试注入固定 HTML 响应，不会被正式内容构建调用。 */
export const createCachedLinkPreviewResolverForTest = (
  options: LinkPreviewResolverTestOptions,
): CachedLinkPreviewResolver =>
  createCachedLinkPreviewResolverInternal(
    options,
    createUnsafeTestRemoteFetcher(options.fetchImpl),
  );

export type VideoBlockKind = "video" | "embed";

export type VideoPresentation =
  | { kind: "native"; url: string; external: boolean }
  | { kind: "embed"; url: string; provider: "YouTube" | "Vimeo" | "Loom" }
  | { kind: "link"; url: string; external: boolean };

interface SafeVideoUrl {
  url: URL | null;
  href: string;
  external: boolean;
}

/** 媒体地址只接受站内路径和 HTTPS，避免混合内容及脚本协议。 */
const readSafeVideoUrl = (value: string): SafeVideoUrl | null => {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return { url: null, href: value, external: false };
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      ? { url, href: url.toString(), external: true }
      : null;
  } catch {
    return null;
  }
};

/** 从 YouTube 常见分享、观看、Shorts 与 embed 地址中提取视频 ID。 */
const resolveYouTubeEmbed = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;

  if (host === "youtu.be") videoId = parts[0] ?? null;
  if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    videoId = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : ["embed", "shorts", "live"].includes(parts[0] ?? "")
        ? parts[1] ?? null
        : null;
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
};

/** 将 Vimeo 页面或播放器地址统一为可嵌入地址，并保留非公开视频的 h 参数。 */
const resolveVimeoEmbed = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["vimeo.com", "player.vimeo.com"].includes(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const videoId = parts.find((part) => /^\d+$/.test(part));
  if (!videoId) return null;

  const pathHash = parts.at(-1) !== videoId ? parts.at(-1) : null;
  const hash = url.searchParams.get("h") ?? pathHash;
  const safeHash = hash && /^[a-zA-Z0-9]+$/.test(hash) ? hash : null;
  return `https://player.vimeo.com/video/${videoId}${safeHash ? `?h=${safeHash}` : ""}`;
};

/** 将 Loom 分享页改写为官方嵌入播放器。 */
const resolveLoomEmbed = (url: URL): string | null => {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "loom.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const videoId = ["share", "embed"].includes(parts[0] ?? "") ? parts[1] : null;
  if (!videoId || !/^[a-zA-Z0-9_-]{8,}$/.test(videoId)) return null;
  return `https://www.loom.com/embed/${videoId}`;
};

/** 只把浏览器普遍支持的 MP4/WebM 交给原生播放器，其余格式提供打开链接。 */
const isBrowserPlayablePath = (pathname: string): boolean => /\.(?:mp4|webm)$/i.test(pathname);

/**
 * 将 Notion 视频呈现为原生播放器、安全供应商 iframe 或普通链接。
 * 未识别的 embed 不直接注入 iframe，避免任意网页获得嵌入权限。
 */
export const resolveVideoPresentation = (
  value: string,
  blockKind: VideoBlockKind,
): VideoPresentation | null => {
  const safe = readSafeVideoUrl(value);
  if (!safe) return null;
  if (!safe.url) {
    return blockKind === "video" && isBrowserPlayablePath(safe.href)
      ? { kind: "native", url: safe.href, external: false }
      : { kind: "link", url: safe.href, external: false };
  }

  const youtube = resolveYouTubeEmbed(safe.url);
  if (youtube) return { kind: "embed", url: youtube, provider: "YouTube" };

  const vimeo = resolveVimeoEmbed(safe.url);
  if (vimeo) return { kind: "embed", url: vimeo, provider: "Vimeo" };

  const loom = resolveLoomEmbed(safe.url);
  if (loom) return { kind: "embed", url: loom, provider: "Loom" };

  return blockKind === "video" && isBrowserPlayablePath(safe.url.pathname)
    ? { kind: "native", url: safe.href, external: true }
    : { kind: "link", url: safe.href, external: true };
};

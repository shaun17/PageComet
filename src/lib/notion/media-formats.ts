import path from "node:path";

export type MediaKind = "image" | "video";

const IMAGE_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const VIDEO_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/mp4": ".mp4",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

/** 从响应类型或 URL 推断安全后缀，GIF 会保持 .gif 而不会丢失动画。 */
export const resolveMediaExtension = (
  kind: MediaKind,
  contentType: string,
  sourceUrl: URL,
): string => {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const extensions =
    kind === "image" ? IMAGE_CONTENT_TYPE_EXTENSIONS : VIDEO_CONTENT_TYPE_EXTENSIONS;
  const extensionFromType = mediaType ? extensions[mediaType] : undefined;
  if (extensionFromType) return extensionFromType;

  const isGenericBinary =
    mediaType === "application/octet-stream" || mediaType === "binary/octet-stream";
  if (mediaType && !isGenericBinary) {
    const guidance = kind === "video" ? "；请改用 MP4 或 WebM" : "";
    throw new Error(
      `Notion ${kind === "image" ? "图片" : "视频"}格式不受支持：${mediaType}${guidance}`,
    );
  }

  const extension = path.extname(sourceUrl.pathname).toLowerCase();
  const allowedExtensions = kind === "image" ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (allowedExtensions.has(extension)) return extension;
  const guidance = kind === "video" ? "，请改用 MP4 或 WebM" : "";
  throw new Error(
    `Notion ${kind === "image" ? "图片" : "视频"}缺少可识别的安全格式${guidance}`,
  );
};

/** 读取指定偏移处的 ASCII 标记，用于拦截伪装成媒体的 HTML 或损坏文件。 */
const hasAsciiMarker = (body: Uint8Array, offset: number, marker: string): boolean =>
  marker.split("").every((character, index) => body[offset + index] === character.charCodeAt(0));

/** 在文件头有限范围内查找兼容品牌，兼容 AVIF 使用 mif1 作为主品牌的情况。 */
const hasAsciiMarkerWithin = (
  body: Uint8Array,
  marker: string,
  maxBytes = 64,
): boolean => {
  const end = Math.min(body.byteLength - marker.length, maxBytes);
  for (let offset = 0; offset <= end; offset += 1) {
    if (hasAsciiMarker(body, offset, marker)) return true;
  }
  return false;
};

/** 校验本站实际支持格式的文件头；容器内 codec 仍由浏览器原生播放器判断。 */
export const validateMediaSignature = (
  kind: MediaKind,
  extension: string,
  body: Uint8Array,
): void => {
  const matches = kind === "video"
    ? extension === ".mp4"
      ? hasAsciiMarker(body, 4, "ftyp")
      : body[0] === 0x1a && body[1] === 0x45 && body[2] === 0xdf && body[3] === 0xa3
    : extension === ".gif"
      ? hasAsciiMarker(body, 0, "GIF87a") || hasAsciiMarker(body, 0, "GIF89a")
      : extension === ".png"
        ? body[0] === 0x89 && hasAsciiMarker(body, 1, "PNG")
        : extension === ".jpg" || extension === ".jpeg"
          ? body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
          : extension === ".webp"
            ? hasAsciiMarker(body, 0, "RIFF") && hasAsciiMarker(body, 8, "WEBP")
            : extension === ".avif"
              ? hasAsciiMarker(body, 4, "ftyp") &&
                (hasAsciiMarkerWithin(body, "avif") || hasAsciiMarkerWithin(body, "avis"))
              : false;

  if (!matches) {
    throw new Error(
      `Notion ${kind === "image" ? "图片" : "视频"}内容与 ${extension} 格式不匹配`,
    );
  }
};

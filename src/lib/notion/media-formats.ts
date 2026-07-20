import path from "node:path";
import { MEDIA_FORMAT_EXTENSIONS } from "./media-format-extensions.mjs";

export type MediaKind = "image" | "video" | "audio";

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

const AUDIO_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/ogg": ".ogg",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/mpeg3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/vnd.wave": ".wav",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-flac": ".flac",
  "audio/x-m4a": ".m4a",
  "audio/x-mpeg-3": ".mp3",
  "audio/x-wav": ".wav",
};

const IMAGE_EXTENSIONS = new Set(MEDIA_FORMAT_EXTENSIONS.image);
const VIDEO_EXTENSIONS = new Set(MEDIA_FORMAT_EXTENSIONS.video);
const AUDIO_EXTENSIONS = new Set(MEDIA_FORMAT_EXTENSIONS.audio);

/** 为错误信息提供稳定的中文媒体名称。 */
const readMediaLabel = (kind: MediaKind): string =>
  kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";

/** 按媒体种类选择允许的 MIME 类型和文件后缀。 */
const readSupportedFormats = (
  kind: MediaKind,
): { contentTypes: Readonly<Record<string, string>>; extensions: ReadonlySet<string> } => {
  if (kind === "image") {
    return { contentTypes: IMAGE_CONTENT_TYPE_EXTENSIONS, extensions: IMAGE_EXTENSIONS };
  }
  if (kind === "video") {
    return { contentTypes: VIDEO_CONTENT_TYPE_EXTENSIONS, extensions: VIDEO_EXTENSIONS };
  }
  return { contentTypes: AUDIO_CONTENT_TYPE_EXTENSIONS, extensions: AUDIO_EXTENSIONS };
};

/** 从响应类型或 URL 推断安全后缀，GIF 会保持 .gif 而不会丢失动画。 */
export const resolveMediaExtension = (
  kind: MediaKind,
  contentType: string,
  sourceUrl: URL,
): string => {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const supported = readSupportedFormats(kind);
  const extensionFromType = mediaType ? supported.contentTypes[mediaType] : undefined;
  if (extensionFromType) return extensionFromType;

  const isGenericBinary =
    mediaType === "application/octet-stream" || mediaType === "binary/octet-stream";
  if (mediaType && !isGenericBinary) {
    const guidance =
      kind === "video"
        ? "；请改用 MP4 或 WebM"
        : kind === "audio"
          ? "；请改用 MP3、M4A、Ogg、WAV、WebM、AAC 或 FLAC"
          : "";
    throw new Error(
      `Notion ${readMediaLabel(kind)}格式不受支持：${mediaType}${guidance}`,
    );
  }

  const extension = path.extname(sourceUrl.pathname).toLowerCase();
  if (supported.extensions.has(extension)) return extension;
  const guidance =
    kind === "video"
      ? "，请改用 MP4 或 WebM"
      : kind === "audio"
        ? "，请改用 MP3、M4A、Ogg、WAV、WebM、AAC 或 FLAC"
        : "";
  throw new Error(
    `Notion ${readMediaLabel(kind)}缺少可识别的安全格式${guidance}`,
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

/** 校验图片格式的关键文件头，避免把网页或损坏内容作为图片发布。 */
const matchesImageSignature = (extension: string, body: Uint8Array): boolean =>
  extension === ".gif"
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

/** 校验 MP4 与 WebM 容器的稳定标记。 */
const matchesVideoSignature = (extension: string, body: Uint8Array): boolean =>
  extension === ".mp4"
    ? hasAsciiMarker(body, 4, "ftyp")
    : extension === ".webm" &&
      body[0] === 0x1a &&
      body[1] === 0x45 &&
      body[2] === 0xdf &&
      body[3] === 0xa3;

/** 校验浏览器常用音频容器的文件头，不依赖不可信的响应 MIME。 */
const matchesAudioSignature = (extension: string, body: Uint8Array): boolean => {
  if (extension === ".mp3") {
    return (
      hasAsciiMarker(body, 0, "ID3") ||
      (body[0] === 0xff && body[1] !== undefined && (body[1] & 0xe0) === 0xe0)
    );
  }
  if (extension === ".m4a") return hasAsciiMarker(body, 4, "ftyp");
  if (extension === ".ogg" || extension === ".oga") return hasAsciiMarker(body, 0, "OggS");
  if (extension === ".wav") {
    return hasAsciiMarker(body, 0, "RIFF") && hasAsciiMarker(body, 8, "WAVE");
  }
  if (extension === ".webm") return matchesVideoSignature(extension, body);
  if (extension === ".flac") return hasAsciiMarker(body, 0, "fLaC");
  return (
    extension === ".aac" &&
    body[0] === 0xff &&
    body[1] !== undefined &&
    (body[1] & 0xf6) === 0xf0
  );
};

/** 校验本站实际支持格式的文件头；容器内 codec 仍由浏览器原生播放器判断。 */
export const validateMediaSignature = (
  kind: MediaKind,
  extension: string,
  body: Uint8Array,
): void => {
  const matches =
    kind === "image"
      ? matchesImageSignature(extension, body)
      : kind === "video"
        ? matchesVideoSignature(extension, body)
        : matchesAudioSignature(extension, body);

  if (!matches) {
    throw new Error(
      `Notion ${readMediaLabel(kind)}内容与 ${extension} 格式不匹配`,
    );
  }
};

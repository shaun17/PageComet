/**
 * Notion 媒体允许落盘的扩展名。下载器与静态产物校验器共用这份配置，
 * 避免新增媒体格式后只更新其中一条链路。
 */
export const MEDIA_FORMAT_EXTENSIONS = Object.freeze({
  image: Object.freeze([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]),
  video: Object.freeze([".mp4", ".webm"]),
  audio: Object.freeze([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]),
});

/** 汇总静态产物中允许出现的全部 Notion 媒体扩展名。 */
export const NOTION_ASSET_EXTENSIONS = Object.freeze(
  [...new Set(Object.values(MEDIA_FORMAT_EXTENSIONS).flat())].sort(),
);

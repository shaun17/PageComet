export const DIRECTORY_PREVIEW_LIMIT = 4;

/**
 * 保留内容源已经确定的顺序，只截取目录需要展示的前四项。
 * @template T
 * @param {readonly T[]} entries
 * @returns {T[]}
 */
export const selectDirectoryPreviewEntries = (entries) =>
  entries.slice(0, DIRECTORY_PREVIEW_LIMIT);

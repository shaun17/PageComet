export const DIRECTORY_PREVIEW_LIMIT = 4;

/**
 * 保留内容源已经确定的顺序，只截取目录需要展示的前四项。
 * @template T
 * @param {readonly T[]} entries
 * @returns {T[]}
 */
export const selectDirectoryPreviewEntries = (entries) =>
  entries.slice(0, DIRECTORY_PREVIEW_LIMIT);

/**
 * 首页目录栏位较窄：「主标题：副标题」形式只展示冒号前的主标题，
 * 完整标题仍作为链接的无障碍名称；没有冒号或主标题过短时原样返回。
 * @param {string} title
 * @returns {string}
 */
export const getDirectoryTitle = (title) => {
  const match = title.match(/^(.+?)(?:：|:\s+)(.+)$/);
  const lead = match?.[1]?.trim() ?? "";
  return lead.length >= 2 ? lead : title;
};

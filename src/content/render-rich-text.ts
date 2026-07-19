import type { ContentRichText } from "../lib/notion";
import {
  getContentHrefMark,
  isRawUrlLabel,
  normalizeContentHref,
} from "./content-href";

/** 转义所有来自 Notion 的文本，避免正文被当作原始 HTML 执行。 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });

export interface RenderRichTextOptions {
  previewMode?: "inline" | "card" | "mention";
}

let richTextRenderSequence = 0;

/** 将远端元数据严格转义为只含 span 的预览结构，确保可安全嵌入任意富文本容器。 */
const renderLinkPreview = (
  item: ContentRichText,
  previewId: string,
  includeTitleInDescription: boolean,
): string => {
  const preview = item.linkPreview;
  if (!preview) return "";
  const accessibleDescription = [
    includeTitleInDescription ? preview.title : null,
    preview.siteName,
    preview.description,
  ]
    .filter((value): value is string => Boolean(value))
    .join("。");
  const description = preview.description
    ? `<span class="notion-link-preview-summary">${escapeHtml(preview.description)}</span>`
    : "";
  return `<span id="${previewId}" class="notion-link-preview-a11y" hidden>${escapeHtml(accessibleDescription)}</span><span class="notion-link-preview" aria-hidden="true"><span class="notion-link-preview-title">${escapeHtml(preview.title)}</span><span class="notion-link-preview-domain">${escapeHtml(preview.siteName)}</span>${description}</span>`;
};

/** 将标准化富文本转换成经过转义的有限 HTML 标记。 */
export const renderRichText = (
  items: ContentRichText[] = [],
  options: RenderRichTextOptions = {},
): string => {
  const renderId = richTextRenderSequence;
  richTextRenderSequence += 1;
  return items
    .map((item, itemIndex) => {
      let output = escapeHtml(item.plainText).replaceAll("\n", "<br />");
      const { annotations } = item;
      if (annotations.code) output = `<code>${output}</code>`;
      if (annotations.bold) output = `<strong>${output}</strong>`;
      if (annotations.italic) output = `<em>${output}</em>`;
      if (annotations.strikethrough) output = `<s>${output}</s>`;
      if (annotations.underline) output = `<u>${output}</u>`;

      const href = normalizeContentHref(item.href);
      if (!href) {
        if (item.type !== "mention") return output;
        return `<span class="notion-mention notion-mention-native"><span class="notion-mention-mark" aria-hidden="true">@</span><span class="notion-mention-label">${output}</span></span>`;
      }
      const nativeMentionClass = item.type === "mention" ? " notion-mention-native" : "";
      const attributes =
        href.kind === "external" ? ' target="_blank" rel="noopener noreferrer"' : "";
      const mark = getContentHrefMark(href);
      const preview = options.previewMode === "mention" ? undefined : item.linkPreview;
      const usesPreviewTitle = Boolean(
        preview && isRawUrlLabel(item.plainText, href.href),
      );
      const label = preview && usesPreviewTitle ? escapeHtml(preview.title) : output;
      if (!preview) {
        return `<a class="notion-mention notion-mention-${href.kind}${nativeMentionClass}" href="${escapeHtml(href.href)}"${attributes}><span class="notion-mention-mark" aria-hidden="true">${mark}</span><span class="notion-mention-label">${label}</span></a>`;
      }

      const previewId = `notion-link-preview-${renderId}-${itemIndex}`;
      const cardClass = options.previewMode === "card" ? " notion-link-card" : "";
      const includeTitleInDescription =
        !usesPreviewTitle && item.plainText.trim() !== preview.title.trim();
      return `<span class="notion-link${cardClass}"><a class="notion-mention notion-mention-${href.kind}${nativeMentionClass}" href="${escapeHtml(href.href)}"${attributes} aria-describedby="${previewId}"><span class="notion-mention-mark" aria-hidden="true">${mark}</span><span class="notion-mention-label">${label}</span></a>${renderLinkPreview(item, previewId, includeTitleInDescription)}</span>`;
    })
    .join("");
};

/** 图注和无格式场景需要纯文本时，同样由标准模型统一提取。 */
export const richTextToPlainText = (items: ContentRichText[] = []): string =>
  items.map((item) => item.plainText).join("");

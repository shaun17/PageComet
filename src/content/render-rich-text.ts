import type { ContentRichText } from "../lib/notion";

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

/** 只允许正文链接使用明确的网页或邮件协议。 */
interface SafeHref {
  href: string;
  external: boolean;
}

const normalizeHref = (value: string | null): SafeHref | null => {
  if (!value) return null;
  if (
    (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) ||
    value.startsWith("#")
  ) {
    return { href: value, external: false };
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return {
      href: url.toString(),
      external:
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname !== "wenren.cc",
    };
  } catch {
    return null;
  }
};

/** 将标准化富文本转换成经过转义的有限 HTML 标记。 */
export const renderRichText = (items: ContentRichText[] = []): string =>
  items
    .map((item) => {
      let output = escapeHtml(item.plainText).replaceAll("\n", "<br />");
      const { annotations } = item;
      if (annotations.code) output = `<code>${output}</code>`;
      if (annotations.bold) output = `<strong>${output}</strong>`;
      if (annotations.italic) output = `<em>${output}</em>`;
      if (annotations.strikethrough) output = `<s>${output}</s>`;
      if (annotations.underline) output = `<u>${output}</u>`;

      const href = normalizeHref(item.href);
      if (!href) return output;
      const attributes = href.external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeHtml(href.href)}"${attributes}>${output}</a>`;
    })
    .join("");

/** 图注和无格式场景需要纯文本时，同样由标准模型统一提取。 */
export const richTextToPlainText = (items: ContentRichText[] = []): string =>
  items.map((item) => item.plainText).join("");

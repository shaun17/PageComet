import { isSiteHostname } from "../config/site-origin";

export interface SafeContentHref {
  href: string;
  kind: "internal" | "external" | "email";
}

/** 只允许正文链接使用明确的站内、网页或邮件协议。 */
export const normalizeContentHref = (
  value: string | null | undefined,
): SafeContentHref | null => {
  if (!value) return null;
  if (
    (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) ||
    value.startsWith("#")
  ) {
    return { href: value, kind: "internal" };
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return {
      href: url.toString(),
      kind:
        url.protocol === "mailto:"
          ? "email"
          : isSiteHostname(url.hostname)
            ? "internal"
            : "external",
    };
  } catch {
    return null;
  }
};

/** 给不同链接类别提供不依赖颜色的简短方向标记。 */
export const getContentHrefMark = (href: SafeContentHref): string => {
  if (href.kind === "email") return "@";
  return href.kind === "external" ? "↗" : "→";
};

/** 判断作者文本是否只是原始 URL，供预览标题替换冗长地址。 */
export const isRawUrlLabel = (label: string, href: string): boolean => {
  try {
    return new URL(label.trim()).href === new URL(href).href;
  } catch {
    return false;
  }
};

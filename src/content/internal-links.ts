import { siteConfig } from "../config/runtime-site-config";
import type { ContentBlock, ContentEntry } from "../lib/notion";

/** 把有无连字符的 Notion 页面 ID 统一成 32 位小写字符串。 */
const normalizePageId = (value: string): string =>
  value.replaceAll("-", "").toLowerCase();

/** 从 Notion 页面地址中提取 UUID，兼容有无连字符的 URL。 */
const readNotionPageId = (value: string | null): string | null => {
  if (!value) return null;
  const matches = value.match(
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?=$|[/?#])/gi,
  );
  return matches?.at(-1) ? normalizePageId(matches.at(-1)!) : null;
};

/** 将数据库页面之间的 Notion 地址及可选旧页面别名改写为站内静态地址。 */
export const rewriteInternalLinks = (entries: ContentEntry[]): ContentEntry[] => {
  const routesByPageId = new Map(
    entries.map((entry) => [normalizePageId(entry.id), `${entry.route}/`]),
  );

  // 迁移后的正文可能仍引用旧公开页 ID；配置别名后统一改写到新静态路由。
  for (const [legacyPageId, currentPageId] of Object.entries(
    siteConfig.content.legacyPageAliases,
  )) {
    const route = routesByPageId.get(normalizePageId(currentPageId));
    if (route) routesByPageId.set(normalizePageId(legacyPageId), route);
  }

  /** 将任意 Notion 页面地址解析为对应站内路由；普通网页地址保持不变。 */
  const resolveInternalRoute = (value: string | null | undefined): string | undefined => {
    const pageId = readNotionPageId(value ?? null);
    return pageId ? routesByPageId.get(pageId) : undefined;
  };

  /** 递归复制块树，避免修改内容管线缓存的原始对象。 */
  const rewriteBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
    blocks.map((item) => ({
      ...item,
      richText: item.richText.map((span) => ({
        ...span,
        href: resolveInternalRoute(span.href) ?? span.href,
      })),
      caption: item.caption?.map((span) => ({
        ...span,
        href: resolveInternalRoute(span.href) ?? span.href,
      })),
      cells: item.cells?.map((cell) =>
        cell.map((span) => ({
          ...span,
          href: resolveInternalRoute(span.href) ?? span.href,
        })),
      ),
      url: resolveInternalRoute(item.url) ?? item.url,
      children: rewriteBlocks(item.children),
    }));

  return entries.map((entry) => ({ ...entry, blocks: rewriteBlocks(entry.blocks) }));
};

import type { ContentCategory } from "../lib/notion";
import { siteConfig } from "../config/runtime-site-config";

export interface CategoryDefinition {
  key: ContentCategory;
  index: string;
  label: string;
  englishLabel: string;
  notionOption: string;
  path: string;
  description: string;
}

/** 三个分类的展示和路径定义集中维护，避免各页面出现不一致的文案。 */
export const CATEGORY_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    siteConfig.categories.map((category) => [
      category.key,
      { ...category, path: `/${category.key}/` },
    ]),
  ) as Record<ContentCategory, CategoryDefinition>,
);

/** 按固定顺序输出分类，用于首页三列和站点导航。 */
export const ORDERED_CATEGORIES: readonly CategoryDefinition[] =
  siteConfig.categories.map((category) => CATEGORY_DEFINITIONS[category.key as ContentCategory]);

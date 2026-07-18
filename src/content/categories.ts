import type { ContentCategory } from "../lib/notion";

export interface CategoryDefinition {
  key: ContentCategory;
  index: string;
  label: string;
  englishLabel: string;
  path: string;
  description: string;
}

/** 三个分类的展示和路径定义集中维护，避免各页面出现不一致的文案。 */
export const CATEGORY_DEFINITIONS: Readonly<Record<ContentCategory, CategoryDefinition>> = {
  career: {
    key: "career",
    index: "01",
    label: "职业经历",
    englishLabel: "CAREER",
    path: "/career/",
    description: "关于工作、工程实践，以及一路形成的判断。",
  },
  works: {
    key: "works",
    index: "02",
    label: "个人作品",
    englishLabel: "WORKS",
    path: "/works/",
    description: "从一个想法开始，持续把它做成可以使用的产品。",
  },
  journal: {
    key: "journal",
    index: "03",
    label: "流水账",
    englishLabel: "JOURNAL",
    path: "/journal/",
    description: "偶尔记录生活、想法和正在发生的事。",
  },
};

/** 按固定顺序输出分类，用于首页三列和站点导航。 */
export const ORDERED_CATEGORIES = [
  CATEGORY_DEFINITIONS.career,
  CATEGORY_DEFINITIONS.works,
  CATEGORY_DEFINITIONS.journal,
] as const;

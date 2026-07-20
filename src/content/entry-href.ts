import type { ContentEntry, JournalEntry } from "../lib/notion";

type RoutableEntry = Pick<ContentEntry | JournalEntry, "category" | "route">;

/** 流水账只公开统一时间流，其余分类继续使用各自的静态详情页。 */
export const getEntryHref = (entry: RoutableEntry): string =>
  entry.category === "journal" ? "/journal/" : `${entry.route}/`;

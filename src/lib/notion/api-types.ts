/** Notion API 分页响应的最小稳定结构。 */
export interface NotionPaginatedResponse<T> {
  object: "list";
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** 页面属性保留动态类型字段，由领域解析器按 schema 校验。 */
export interface NotionPropertyValue {
  id: string;
  type: string;
  [key: string]: unknown;
}

/** 查询数据源返回的页面结构。 */
export interface NotionPageResponse {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  is_archived?: boolean;
  in_trash?: boolean;
  url: string;
  cover: unknown | null;
  properties: Record<string, NotionPropertyValue>;
  [key: string]: unknown;
}

/** 读取页面正文时返回的原始块结构。 */
export interface NotionBlockResponse {
  object: "block";
  id: string;
  type: string;
  has_children: boolean;
  last_edited_time?: string;
  archived?: boolean;
  is_archived?: boolean;
  in_trash?: boolean;
  [key: string]: unknown;
}

/** 数据源 schema 中单个字段的结构。 */
export interface NotionDataSourceProperty {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

/** 读取数据源时仅保留内容管线需要的字段。 */
export interface NotionDataSourceResponse {
  object: "data_source";
  id: string;
  properties: Record<string, NotionDataSourceProperty>;
  [key: string]: unknown;
}

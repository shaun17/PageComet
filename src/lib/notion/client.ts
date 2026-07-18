import type {
  NotionBlockResponse,
  NotionDataSourceResponse,
  NotionPageResponse,
  NotionPaginatedResponse,
} from "./api-types";

const NOTION_API_BASE_URL = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2026-03-11";

/** Notion API 错误保留状态码和请求 ID，便于定位构建失败。 */
export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

export interface NotionClientOptions {
  token: string;
  dataSourceId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

/** 将 Retry-After 转为毫秒，并限制异常响应带来的超长等待。 */
const readRetryDelay = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;

  if (Number.isFinite(seconds)) {
    return Math.min(seconds * 1_000, 10_000);
  }

  return Math.min(500 * 2 ** attempt, 4_000);
};

/** 构建阶段的短暂等待，仅用于 Notion 限流和服务端临时错误重试。 */
const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** 对响应错误体做容错解析，避免 HTML 错误页遮蔽真实状态码。 */
const readErrorDetails = async (
  response: Response,
): Promise<{ code: string | null; message: string }> => {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === "string" ? body.code : null,
      message: typeof body.message === "string" ? body.message : response.statusText,
    };
  } catch {
    return { code: null, message: response.statusText || "Notion API 请求失败" };
  }
};

/** 无额外 SDK 依赖的 Notion 只读客户端，封装认证、分页、超时和有限重试。 */
export class NotionClient {
  private readonly token: string;
  private readonly dataSourceId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: NotionClientOptions) {
    if (!options.token.trim() || !options.dataSourceId.trim()) {
      throw new Error("NOTION_TOKEN 与 NOTION_DATA_SOURCE_ID 均不能为空");
    }

    this.token = options.token.trim();
    this.dataSourceId = options.dataSourceId.trim();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /** 从构建环境创建客户端，缺少凭据时立即终止并给出明确提示。 */
  static fromEnvironment(
    environment: Record<string, string | undefined> = process.env,
  ): NotionClient {
    return new NotionClient({
      token: environment.NOTION_TOKEN ?? "",
      dataSourceId: environment.NOTION_DATA_SOURCE_ID ?? "",
    });
  }

  /** 读取数据源 schema，供内容管线在查询前校验字段契约。 */
  async retrieveDataSource(): Promise<NotionDataSourceResponse> {
    return this.request<NotionDataSourceResponse>(
      `/data_sources/${encodeURIComponent(this.dataSourceId)}`,
    );
  }

  /** 查询数据源全部页面，并自动跟随 Notion 游标分页。 */
  async queryDataSource(body: Record<string, unknown>): Promise<NotionPageResponse[]> {
    const pages: NotionPageResponse[] = [];
    let cursor: string | null = null;

    do {
      const pageBody: Record<string, unknown> = cursor
        ? { ...body, start_cursor: cursor }
        : body;
      const response: NotionPaginatedResponse<NotionPageResponse> =
        await this.request<NotionPaginatedResponse<NotionPageResponse>>(
          `/data_sources/${encodeURIComponent(this.dataSourceId)}/query`,
          { method: "POST", body: JSON.stringify(pageBody) },
        );
      // `in_trash: false` 在 2026-03-11 接口中会被拒绝；省略该参数，并在响应层防御性排除回收站页面。
      pages.push(
        ...response.results.filter(
          (result) =>
            result.object === "page" &&
            result.in_trash !== true &&
            result.archived !== true &&
            result.is_archived !== true,
        ),
      );
      cursor = response.has_more ? response.next_cursor : null;

      if (response.has_more && !cursor) {
        throw new Error("Notion 返回 has_more=true，但缺少 next_cursor");
      }
    } while (cursor);

    return pages;
  }

  /** 读取任意页面或块的全部直属子块，并处理每页最多 100 条的限制。 */
  async listBlockChildren(blockId: string): Promise<NotionBlockResponse[]> {
    const blocks: NotionBlockResponse[] = [];
    let cursor: string | null = null;

    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const response: NotionPaginatedResponse<NotionBlockResponse> =
        await this.request<NotionPaginatedResponse<NotionBlockResponse>>(
          `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
        );
      // 子块接口同样做响应层过滤，避免回收站或归档块进入最终静态 HTML。
      blocks.push(
        ...response.results.filter(
          (result) =>
            result.object === "block" &&
            result.in_trash !== true &&
            result.archived !== true &&
            result.is_archived !== true,
        ),
      );
      cursor = response.has_more ? response.next_cursor : null;

      if (response.has_more && !cursor) {
        throw new Error("Notion 子块响应缺少 next_cursor");
      }
    } while (cursor);

    return blocks;
  }

  /** 发起单次 API 请求；仅对限流和服务端临时错误进行有界重试。 */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetchImpl(`${NOTION_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_API_VERSION,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) return (await response.json()) as T;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await wait(readRetryDelay(response, attempt));
        continue;
      }

      const details = await readErrorDetails(response);
      throw new NotionApiError(
        `Notion API ${response.status}: ${details.message}`,
        response.status,
        details.code,
        response.headers.get("x-request-id"),
      );
    }

    throw new Error("Notion API 重试流程异常结束");
  }
}

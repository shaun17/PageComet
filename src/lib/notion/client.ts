import type {
  NotionBlockResponse,
  NotionDataSourceResponse,
  NotionPageResponse,
  NotionPaginatedResponse,
} from "./api-types";

const NOTION_API_BASE_URL = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2026-03-11";
// Notion 官方限制为每个连接平均每秒 3 次请求，340 ms 间隔留出少量调度余量。
const DEFAULT_REQUEST_INTERVAL_MS = 340;
const DEFAULT_REQUEST_CONCURRENCY = 3;
// 固定 Node 22.13.0 发布环境的 Undici 建连超时为 10 秒；失败后不退避，最多立即重试两次。
const MAX_CONNECT_TIMEOUT_RETRIES = 2;
const UNDICI_CONNECT_TIMEOUT_CODE = "UND_ERR_CONNECT_TIMEOUT";

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
  scheduler?: NotionRequestScheduler;
}

export interface NotionRequestScheduler {
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

export interface NotionRequestSchedulerOptions {
  intervalMs?: number;
  concurrency?: number;
}

/**
 * 创建共享请求队列：请求按固定间隔启动，同时允许慢请求与后续请求重叠。
 * 两个数据源共用同一实例，才能遵守同一 Notion 连接的总速率限制。
 */
export const createNotionRequestScheduler = (
  options: NotionRequestSchedulerOptions = {},
): NotionRequestScheduler => {
  const intervalMs = options.intervalMs ?? DEFAULT_REQUEST_INTERVAL_MS;
  const concurrency = options.concurrency ?? DEFAULT_REQUEST_CONCURRENCY;
  if (!Number.isInteger(intervalMs) || intervalMs < 0) {
    throw new Error("Notion 请求间隔必须是非负整数");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error("Notion 请求并发数必须是 1-10 的整数");
  }

  let activeCount = 0;
  let nextStartAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: Array<() => void> = [];

  /** 在速率和并发均有余量时启动队首任务。 */
  const drain = (): void => {
    if (timer || activeCount >= concurrency || queue.length === 0) return;

    const delay = Math.max(0, nextStartAt - Date.now());
    if (delay > 0) {
      timer = setTimeout(() => {
        timer = null;
        drain();
      }, delay);
      return;
    }

    const start = queue.shift()!;
    activeCount += 1;
    nextStartAt = Date.now() + intervalMs;
    start();
    drain();
  };

  return {
    /** 将真实网络请求排入共享队列，失败也会可靠释放并发槽位。 */
    schedule<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeCount -= 1;
              drain();
            });
        });
        drain();
      });
    },
  };
};

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

/**
 * 沿错误 cause 链识别 Undici 建连超时。
 * Node 全局 Fetch 会把底层错误包装为 TypeError，因此不能只检查最外层对象。
 */
const isConnectTimeoutError = (error: unknown): boolean => {
  const visited = new Set<object>();
  let current = error;

  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    if ("code" in current && current.code === UNDICI_CONNECT_TIMEOUT_CODE) return true;
    current = "cause" in current ? current.cause : null;
  }

  return false;
};

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
  private readonly scheduler: NotionRequestScheduler;

  constructor(options: NotionClientOptions) {
    if (!options.token.trim() || !options.dataSourceId.trim()) {
      throw new Error("NOTION_TOKEN 与 NOTION_DATA_SOURCE_ID 均不能为空");
    }

    this.token = options.token.trim();
    this.dataSourceId = options.dataSourceId.trim();
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.scheduler = options.scheduler ?? createNotionRequestScheduler();
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

  /** 发起单次 API 请求；分别限制建连超时与 HTTP 临时错误的重试次数。 */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let responseRetryCount = 0;
    let connectTimeoutRetryCount = 0;

    while (true) {
      // 超时从真实发起时开始计算，排队时间不会挤占单次请求预算。
      let response: Response;
      try {
        response = await this.scheduler.schedule(() =>
          this.fetchImpl(`${NOTION_API_BASE_URL}${path}`, {
            ...init,
            headers: {
              Authorization: `Bearer ${this.token}`,
              "Notion-Version": NOTION_API_VERSION,
              ...(init.body ? { "Content-Type": "application/json" } : {}),
              ...init.headers,
            },
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        );
      } catch (error) {
        // 建连超时不增加额外退避；共享调度器仍会维持 Notion 的全局请求速率。
        if (
          isConnectTimeoutError(error) &&
          connectTimeoutRetryCount < MAX_CONNECT_TIMEOUT_RETRIES
        ) {
          connectTimeoutRetryCount += 1;
          continue;
        }
        throw error;
      }

      if (response.ok) return (await response.json()) as T;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && responseRetryCount < this.maxRetries) {
        await wait(readRetryDelay(response, responseRetryCount));
        responseRetryCount += 1;
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
  }
}

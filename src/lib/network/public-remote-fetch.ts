import { isIP } from "node:net";
import { isPrivateHost, validateUrl } from "linkpeek";
import {
  Agent,
  fetch as undiciFetch,
  interceptors,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DNS_RECORD_TTL_MS = 10_000;

export interface RemoteAddress {
  address: string;
  family: 4 | 6;
}

export type RemoteAddressResolver = (hostname: string) => Promise<RemoteAddress[]>;

interface PublicRemoteFetcherTestOptions {
  dispatcher?: Dispatcher;
  resolveAddresses?: RemoteAddressResolver;
}

export interface PublicRemoteFetcher {
  fetch: typeof fetch;
  close: () => Promise<void>;
}

export interface PublicResourceFetchOptions {
  fetchImpl: typeof fetch;
  maxRedirects?: number;
  requestTimeoutMs?: number;
  requireHttps?: boolean;
}

export interface PublicResourceResponse {
  response: Response;
  url: URL;
}

interface DnsJsonResponse {
  Status?: number;
  Answer?: Array<{ type?: number; data?: string }>;
}

/** 通过固定的公共 DNS HTTPS 端点获取将被 socket 直接使用的公网地址。 */
const resolveDnsOverHttpsAddresses: RemoteAddressResolver = async (hostname) => {
  const query = async (recordType: "A" | "AAAA"): Promise<RemoteAddress[]> => {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", recordType);
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`公网 DNS 验证失败：HTTP ${response.status}`);
    }
    const result = (await response.json()) as DnsJsonResponse;
    if (result.Status !== 0) throw new Error(`公网 DNS 验证失败：状态 ${result.Status}`);
    return (result.Answer ?? []).flatMap((answer) => {
      const address = answer.data ?? "";
      const family = isIP(address);
      return family === 4 || family === 6 ? [{ address, family }] : [];
    });
  };

  const [ipv4, ipv6] = await Promise.all([query("A"), query("AAAA")]);
  return [...ipv4, ...ipv6];
};

/** 从 fetch 支持的输入结构中读取确定的 URL。 */
const readRequestUrl = (input: Parameters<typeof fetch>[0]): URL =>
  new URL(input instanceof Request ? input.url : String(input));

/** 阻止凭据、特殊端口、私网地址和内部主机进入构建机请求。 */
const assertPublicUrl = (url: URL): void => {
  validateUrl(url.href, false);
  if (url.username || url.password) throw new Error("远程地址不能包含用户名或密码");
  if (url.port) throw new Error("远程地址不能使用非默认端口");
  if (!isIP(url.hostname) && !url.hostname.includes(".")) {
    throw new Error("远程地址必须使用公开域名");
  }
};

/** 要求域名返回的全部地址都是公网单播，混入一个私网地址也会拒绝。 */
const assertPublicAddresses = (addresses: RemoteAddress[]): void => {
  if (addresses.length === 0) throw new Error("远程域名没有可用地址");
  if (addresses.some(({ address }) => isPrivateHost(address))) {
    throw new Error("远程域名解析到了私有或本机网络");
  }
};

/** 创建在 socket 建连时验证并固定公共 DNS 结果的独立 Undici 调度器。 */
const createPublicDispatcher = (
  resolveAddresses: RemoteAddressResolver,
  baseDispatcher: Dispatcher = new Agent({ connectTimeout: 6_000 }),
): Dispatcher => {
  const secureDns = interceptors.dns({
    maxTTL: DNS_RECORD_TTL_MS,
    dualStack: true,
    affinity: 4,
    lookup: (origin, _options, callback) => {
      resolveAddresses(origin.hostname)
        .then((addresses) => {
          assertPublicAddresses(addresses);
          callback(
            null,
            addresses.map(({ address, family }) => ({
              address,
              family,
              ttl: DNS_RECORD_TTL_MS,
            })),
          );
        })
        .catch((error: unknown) => {
          callback(error instanceof Error ? error : new Error("远程域名解析失败"), []);
        });
    },
  });
  return baseDispatcher.compose(secureDns);
};

/** 按指定依赖创建安全 fetch，生产入口与离线测试入口共用同一套校验逻辑。 */
const createPublicRemoteFetcherInternal = (
  options: PublicRemoteFetcherTestOptions,
): PublicRemoteFetcher => {
  const dispatcher = createPublicDispatcher(
    options.resolveAddresses ?? resolveDnsOverHttpsAddresses,
    options.dispatcher,
  );
  return {
    fetch: async (input, init) => {
      const url = readRequestUrl(input);
      assertPublicUrl(url);
      return undiciFetch(url, {
        ...(init as UndiciRequestInit),
        dispatcher,
      }) as unknown as Response;
    },
    close: async () => {
      await dispatcher.close();
    },
  };
};

/** 创建生产使用的公网 fetch，调用方无法绕过 DNS 校验与 socket 地址固定。 */
export const createPublicRemoteFetcher = (): PublicRemoteFetcher =>
  createPublicRemoteFetcherInternal({});

/** 仅供离线测试注入 MockAgent 与 DNS 结果，仍然执行完整公网地址校验。 */
export const createPublicRemoteFetcherForTest = (
  options: PublicRemoteFetcherTestOptions,
): PublicRemoteFetcher => createPublicRemoteFetcherInternal(options);

/** 仅供完全离线的响应解析测试使用，不得用于任何生产网络请求。 */
export const createUnsafeTestRemoteFetcher = (
  fetchImpl: typeof fetch,
): PublicRemoteFetcher => ({
  fetch: async (input, init) => {
    assertPublicUrl(readRequestUrl(input));
    return fetchImpl(input, init);
  },
  close: async () => undefined,
});

/** 下载一个公网资源，逐跳验证重定向并为整个请求设置硬超时。 */
export const fetchPublicResource = async (
  input: string | URL,
  options: PublicResourceFetchOptions,
): Promise<PublicResourceResponse> => {
  const signal = AbortSignal.timeout(options.requestTimeoutMs ?? 10_000);
  const maxRedirects = options.maxRedirects ?? 5;
  let url = new URL(input);

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (options.requireHttps && url.protocol !== "https:") {
      throw new Error("远程地址必须使用 HTTPS");
    }

    let response: Response;
    try {
      response = await options.fetchImpl(url, { redirect: "manual", signal });
    } catch (error) {
      const reason = error instanceof Error ? `：${error.message}` : "";
      throw new Error(`远程请求失败（${url.hostname}）${reason}`, { cause: error });
    }
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url };

    const location = response.headers.get("location");
    if (!location) return { response, url };
    await response.body?.cancel().catch(() => undefined);
    if (redirectCount >= maxRedirects) throw new Error("远程地址重定向次数过多");
    url = new URL(location, url);
  }
};

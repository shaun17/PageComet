import { siteConfig } from "./runtime-site-config";

const SITE_HOSTNAME = new URL(siteConfig.origin).hostname;

/** 判断绝对网页地址是否属于当前站点或其子域名。 */
export const isSiteHostname = (hostname: string): boolean =>
  hostname === SITE_HOSTNAME || hostname.endsWith(`.${SITE_HOSTNAME}`);

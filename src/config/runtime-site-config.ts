import { siteConfig as virtualSiteConfig } from "virtual:site-config";
import type { SiteConfig } from "./site-config-types";

/** 为构建期虚拟模块补充稳定类型，供页面和内容管线统一读取。 */
export const siteConfig: Readonly<SiteConfig> = virtualSiteConfig;

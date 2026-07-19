/// <reference types="astro/client" />

declare module "virtual:site-config" {
  import type { SiteConfig } from "./config/site-config-types";

  export const siteConfig: Readonly<SiteConfig>;
}

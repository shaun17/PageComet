import type { ContentCategory } from "../lib/notion";

export interface SiteContact {
  key: string;
  label: string;
  href: string;
  ariaLabel: string;
  external: boolean;
}

export interface SiteCategory {
  key: ContentCategory;
  notionOption: string;
  index: string;
  label: string;
  englishLabel: string;
  description: string;
}

export interface SiteConfig {
  locale: string;
  origin: string;
  brand: {
    name: string;
    browserTitle: string;
    socialTitle: string;
    kicker: string;
    description: string;
  };
  home: {
    headline: {
      prefix: string;
      linkLabel: string;
      categoryKey: ContentCategory;
      suffix: string;
    };
    biography: string[];
  };
  contacts: SiteContact[];
  categories: SiteCategory[];
  designCredit: {
    prefix: string;
    label: string;
    href: string;
    suffix: string;
  };
  features: {
    linkPreviews: boolean;
  };
  content: {
    legacyPageAliases: Record<string, string>;
  };
}

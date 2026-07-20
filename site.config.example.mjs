import { defineSiteConfig } from "./src/config/define-site-config.mjs";

/**
 * 可安全提交的虚构站点配置，也是无密钥 fixture 和 CI 的默认配置。
 * 克隆后复制为 site.config.mjs，再填写自己的公开站点信息。
 */
export const siteConfig = defineSiteConfig({
  locale: "zh-CN",
  origin: "https://portfolio.example.com",
  brand: {
    name: "Alice",
    browserTitle: "ALICE",
    socialTitle: "Alice — 设计师与独立开发者",
    kicker: "ALICE / DESIGNER & DEVELOPER",
    description: "Alice 的个人网站，收录职业经历、个人作品、文章与日常记录。",
  },
  home: {
    headline: {
      prefix: "alice 正在做",
      linkLabel: "独立作品",
      categoryKey: "works",
      suffix: "。",
    },
    biography: [
      "产品设计师，也是一名独立开发者。把想法做成简单、好用的产品。",
      "喜欢阅读、徒步，也期待认识更多有趣的朋友。",
    ],
  },
  contacts: [
    {
      key: "x",
      label: "X",
      href: "https://x.com/alice_example",
      ariaLabel: "在 X 上查看 Alice",
      external: true,
    },
    {
      key: "mail",
      label: "Mail",
      href: "mailto:alice@example.com",
      ariaLabel: "发送邮件至 alice@example.com",
      external: false,
    },
  ],
  categories: [
    {
      key: "career",
      notionOption: "职业经历",
      index: "01",
      label: "职业经历",
      englishLabel: "CAREER",
      description: "关于工作、协作，以及一路形成的判断。",
    },
    {
      key: "works",
      notionOption: "个人作品",
      index: "02",
      label: "个人作品",
      englishLabel: "WORKS",
      description: "从一个想法开始，持续把它做成可以使用的产品。",
    },
    {
      key: "writing",
      notionOption: "文稿",
      index: "03",
      label: "文稿",
      englishLabel: "WRITING",
      description: "记录技术实践、探索尝试，以及逐步形成的思考。",
    },
    {
      key: "journal",
      notionOption: "流水账",
      index: "04",
      label: "流水账",
      englishLabel: "JOURNAL",
      description: "偶尔记录生活、想法和正在发生的事。",
    },
  ],
  designCredit: {
    prefix: "Design inspired by",
    label: "Ryo Lu",
    href: "https://ryo.lu/",
    suffix: "↗",
  },
  features: {
    linkPreviews: true,
  },
  content: {
    legacyPageAliases: {},
  },
});

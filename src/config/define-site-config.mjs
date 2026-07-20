import { CONTENT_CATEGORY_KEYS } from "./content-category-keys.mjs";

const NOTION_PAGE_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

/** 校验必填文字并返回去除首尾空白后的值。 */
const requireText = (value, path) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`站点配置 ${path} 必须是非空文字`);
  }
  return value.trim();
};

/** 校验允许为空的文字字段，避免数字或对象意外进入页面。 */
const requireString = (value, path) => {
  if (typeof value !== "string") {
    throw new TypeError(`站点配置 ${path} 必须是文字`);
  }
  return value;
};

/** 校验布尔开关，防止字符串形式的 true/false 被误判。 */
const requireBoolean = (value, path) => {
  if (typeof value !== "boolean") {
    throw new TypeError(`站点配置 ${path} 必须是 true 或 false`);
  }
  return value;
};

/** 校验绝对地址及允许的协议，并返回浏览器规范化后的地址。 */
const requireUrl = (value, protocols, path) => {
  const text = requireText(value, path);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError(`站点配置 ${path} 必须是完整地址`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new TypeError(`站点配置 ${path} 仅支持 ${protocols.join("、")} 协议`);
  }
  return parsed;
};

/** 校验迁移别名中的 Notion 页面 ID，兼容有无连字符的 UUID。 */
const requireNotionPageId = (value, path) => {
  const pageId = requireText(value, path);
  if (!NOTION_PAGE_ID_PATTERN.test(pageId)) {
    throw new TypeError(`站点配置 ${path} 必须是有效的 Notion 页面 ID`);
  }
  return pageId;
};

/** 递归冻结最终配置，防止构建过程中某个页面意外修改共享值。 */
const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/**
 * 在 Astro 启动前校验公开配置，让拼错字段、路由或地址立即给出明确错误。
 * @template {Record<string, any>} T
 * @param {T} config
 * @returns {Readonly<T>}
 */
export const defineSiteConfig = (config) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("站点配置必须是对象");
  }

  requireText(config.locale, "locale");
  const origin = requireUrl(config.origin, ["https:"], "origin");
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new TypeError("站点配置 origin 只能填写 HTTPS 域名，不能包含路径、参数或账号信息");
  }

  for (const field of ["name", "browserTitle", "socialTitle", "kicker", "description"]) {
    requireText(config.brand?.[field], `brand.${field}`);
  }
  for (const field of ["prefix", "linkLabel"]) {
    requireText(config.home?.headline?.[field], `home.headline.${field}`);
  }
  requireString(config.home?.headline?.suffix, "home.headline.suffix");

  if (!Array.isArray(config.home?.biography) || config.home.biography.length === 0) {
    throw new TypeError("站点配置 home.biography 至少需要一段简介");
  }
  config.home.biography.forEach((paragraph, index) =>
    requireText(paragraph, `home.biography[${index}]`),
  );

  if (
    !Array.isArray(config.categories) ||
    config.categories.length !== CONTENT_CATEGORY_KEYS.length
  ) {
    throw new TypeError(
      `站点配置 categories 必须完整包含：${CONTENT_CATEGORY_KEYS.join("、")}`,
    );
  }
  const categoryKeys = new Set();
  const notionOptions = new Set();
  const categoryIndexes = new Set();
  config.categories.forEach((category, index) => {
    const path = `categories[${index}]`;
    const key = requireText(category?.key, `${path}.key`);
    if (!CONTENT_CATEGORY_KEYS.includes(key) || categoryKeys.has(key)) {
      throw new TypeError(
        `${path}.key 必须是不重复的 ${CONTENT_CATEGORY_KEYS.join("、")} 之一`,
      );
    }
    categoryKeys.add(key);

    const notionOption = requireText(category.notionOption, `${path}.notionOption`);
    if (notionOptions.has(notionOption)) {
      throw new TypeError(`${path}.notionOption 不能与其他分类重复`);
    }
    notionOptions.add(notionOption);

    const categoryIndex = requireText(category.index, `${path}.index`);
    if (categoryIndexes.has(categoryIndex)) {
      throw new TypeError(`${path}.index 不能与其他分类重复`);
    }
    categoryIndexes.add(categoryIndex);
    for (const field of ["label", "englishLabel", "description"]) {
      requireText(category[field], `${path}.${field}`);
    }
  });
  for (const key of CONTENT_CATEGORY_KEYS) {
    if (!categoryKeys.has(key)) throw new TypeError(`站点配置 categories 缺少 ${key} 分类`);
  }
  if (!categoryKeys.has(config.home.headline.categoryKey)) {
    throw new TypeError("站点配置 home.headline.categoryKey 必须对应现有分类");
  }

  if (!Array.isArray(config.contacts)) {
    throw new TypeError("站点配置 contacts 必须是数组");
  }
  const contactKeys = new Set();
  config.contacts.forEach((contact, index) => {
    const path = `contacts[${index}]`;
    const key = requireText(contact?.key, `${path}.key`);
    if (contactKeys.has(key)) throw new TypeError(`${path}.key 不能与其他联系方式重复`);
    contactKeys.add(key);
    requireText(contact.label, `${path}.label`);
    requireText(contact.ariaLabel, `${path}.ariaLabel`);
    requireBoolean(contact.external, `${path}.external`);
    const contactProtocols = contact.external
      ? ["http:", "https:"]
      : ["http:", "https:", "mailto:", "tel:"];
    requireUrl(contact.href, contactProtocols, `${path}.href`);
  });

  for (const field of ["prefix", "label"]) {
    requireText(config.designCredit?.[field], `designCredit.${field}`);
  }
  requireString(config.designCredit?.suffix, "designCredit.suffix");
  requireUrl(config.designCredit?.href, ["http:", "https:"], "designCredit.href");

  requireBoolean(config.features?.linkPreviews, "features.linkPreviews");
  const aliases = config.content?.legacyPageAliases;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    throw new TypeError("站点配置 content.legacyPageAliases 必须是对象");
  }
  for (const [legacyPageId, currentPageId] of Object.entries(aliases)) {
    requireNotionPageId(legacyPageId, "content.legacyPageAliases 的旧页面 ID");
    requireNotionPageId(
      currentPageId,
      `content.legacyPageAliases.${legacyPageId}`,
    );
  }

  return deepFreeze(config);
};

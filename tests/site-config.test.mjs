import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { siteConfig } from "../site.config.example.mjs";
import { defineSiteConfig } from "../src/config/define-site-config.mjs";

/** 复制当前有效配置，测试错误输入时不会修改共享的冻结对象。 */
const createConfig = () => structuredClone(siteConfig);

/** 示例配置、环境模板与两份入口文档必须共同覆盖当前双数据源契约。 */
test("keeps the reusable configuration and setup documentation complete", async () => {
  const [gitignore, environmentExample, readme, agentGuide] = await Promise.all([
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/agent-deploy.md", import.meta.url), "utf8"),
  ]);

  assert.equal(siteConfig.origin, "https://portfolio.example.com");
  assert.equal(siteConfig.timeZone, "Asia/Shanghai");
  assert.deepEqual(siteConfig.content.legacyPageAliases, {});
  assert.match(gitignore, /^site\.config\.mjs$/m);
  for (const name of [
    "NOTION_TOKEN",
    "NOTION_DATA_SOURCE_ID",
    "NOTION_JOURNAL_DATA_SOURCE_ID",
    "CLOUDFLARE_PAGES_PROJECT",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ]) {
    assert.match(environmentExample, new RegExp(`^${name}=$`, "m"));
    assert.match(readme, new RegExp(`\\b${name}\\b`));
  }
  for (const property of [
    "标题",
    "Slug",
    "分类",
    "状态",
    "摘要",
    "发布日期",
    "排序",
    "置顶",
    "外部链接",
    "GitHub 仓库",
    "标签",
    "封面",
    "内容",
    "补充内容",
    "素材",
    "嵌入链接",
    "发布时间",
    "创建时间",
    "隐藏",
  ]) {
    assert.match(readme, new RegExp("\\| `" + property + "` \\|"));
  }
  assert.match(readme, /career.*works.*writing.*journal/s);
  assert.match(readme, /私有 Form/);
  assert.match(readme, /https:\/\/github\.com\/shaun17\/PageComet/);
  assert.match(readme, /docs\/agent-deploy\.md/);
  assert.match(readme, /只在 Notion、Cloudflare 授权和个人资料处/);
  for (const command of [
    "npm ci",
    "npm test",
    "npm run validate:site-config",
    "npm run build",
    "npm run verify:dist",
    "npm run pages:create",
    "npm run deploy",
  ]) {
    assert.match(agentGuide, new RegExp(command.replaceAll(" ", "\\s+")));
  }
  assert.match(agentGuide, /不得无条件覆盖/);
  assert.match(agentGuide, /不要把值打印出来/);
  assert.match(agentGuide, /只有在所有者要求提交或推送时/);
});

test("accepts and deeply freezes a valid site configuration", () => {
  const config = defineSiteConfig(createConfig());

  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.home.headline));
  assert.ok(Object.isFrozen(config.categories));
  assert.ok(Object.isFrozen(config.content.legacyPageAliases));
  assert.deepEqual(
    config.categories.map(({ key, index }) => ({ key, index })),
    [
      { key: "career", index: "01" },
      { key: "works", index: "02" },
      { key: "writing", index: "03" },
      { key: "journal", index: "04" },
    ],
  );
});

test("rejects an unsafe origin and an unknown headline category", () => {
  const unsafeOrigin = createConfig();
  unsafeOrigin.origin = "http://portfolio.example.com";
  assert.throws(() => defineSiteConfig(unsafeOrigin), /origin 仅支持 https:/);

  const unknownCategory = createConfig();
  unknownCategory.home.headline.categoryKey = "notes";
  assert.throws(
    () => defineSiteConfig(unknownCategory),
    /home\.headline\.categoryKey 必须对应现有分类/,
  );
});

test("rejects an invalid journal time zone", () => {
  const invalidTimeZone = createConfig();
  invalidTimeZone.timeZone = "Shanghai";
  assert.throws(
    () => defineSiteConfig(invalidTimeZone),
    /timeZone 必须是有效的 IANA 时区/,
  );
});

test("rejects duplicate categories, unsafe contacts, and malformed aliases", () => {
  const duplicateCategory = createConfig();
  duplicateCategory.categories[2].key = duplicateCategory.categories[0].key;
  assert.throws(() => defineSiteConfig(duplicateCategory), /key 必须是不重复的/);

  const unsafeContact = createConfig();
  unsafeContact.contacts[0].href = "javascript:alert(1)";
  assert.throws(() => defineSiteConfig(unsafeContact), /contacts\[0\]\.href 仅支持/);

  const malformedAlias = createConfig();
  malformedAlias.content.legacyPageAliases = { invalid: "also-invalid" };
  assert.throws(() => defineSiteConfig(malformedAlias), /必须是有效的 Notion 页面 ID/);
});

test("requires the complete four-category contract", () => {
  const missingCategory = createConfig();
  missingCategory.categories.pop();
  assert.throws(
    () => defineSiteConfig(missingCategory),
    /categories 必须完整包含：career、works、writing、journal/,
  );

  const unknownCategory = createConfig();
  unknownCategory.categories[2].key = "notes";
  assert.throws(() => defineSiteConfig(unknownCategory), /key 必须是不重复的/);
});

test("requires an explicit link-preview boolean", () => {
  const malformedFeature = createConfig();
  malformedFeature.features.linkPreviews = "true";
  assert.throws(
    () => defineSiteConfig(malformedFeature),
    /features\.linkPreviews 必须是 true 或 false/,
  );
});

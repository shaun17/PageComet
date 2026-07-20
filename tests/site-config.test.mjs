import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { siteConfig } from "../site.config.example.mjs";
import { defineSiteConfig } from "../src/config/define-site-config.mjs";

/** 复制当前有效配置，测试错误输入时不会修改共享的冻结对象。 */
const createConfig = () => structuredClone(siteConfig);

test("keeps committed configuration generic and local configuration ignored", async () => {
  const [gitignore, environmentExample] = await Promise.all([
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.equal(siteConfig.origin, "https://portfolio.example.com");
  assert.deepEqual(siteConfig.content.legacyPageAliases, {});
  assert.match(gitignore, /^site\.config\.mjs$/m);
  for (const name of [
    "NOTION_TOKEN",
    "NOTION_DATA_SOURCE_ID",
    "CLOUDFLARE_PAGES_PROJECT",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
  ]) {
    assert.match(environmentExample, new RegExp(`^${name}=$`, "m"));
  }
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

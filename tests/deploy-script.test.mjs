import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeploymentScanValues,
  createNotionBuildEnvironment,
  createTestEnvironment,
  createVerificationEnvironment,
  createWranglerEnvironment,
  validateDeploymentEnvironment,
} from "../scripts/deploy.mjs";

const validEnvironment = {
  NOTION_TOKEN: "ntn_abcdefghijklmnopqrstuvwxyz0123456789",
  NOTION_DATA_SOURCE_ID: "11111111-2222-4333-8444-555555555555",
  NOTION_JOURNAL_DATA_SOURCE_ID: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  CLOUDFLARE_PAGES_PROJECT: "alice-portfolio",
};

/** 逐项删除必需变量，确保部署不会带着不完整配置继续运行。 */
for (const name of Object.keys(validEnvironment)) {
  test(`rejects a missing ${name}`, () => {
    const environment = { ...validEnvironment };
    delete environment[name];
    assert.throws(() => validateDeploymentEnvironment(environment), new RegExp(name));
  });
}

test("validates deployment identifiers before running child processes", () => {
  assert.deepEqual(validateDeploymentEnvironment(validEnvironment), {
    notionToken: validEnvironment.NOTION_TOKEN,
    notionDataSourceId: validEnvironment.NOTION_DATA_SOURCE_ID,
    notionJournalDataSourceId: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
    pagesProject: validEnvironment.CLOUDFLARE_PAGES_PROJECT,
  });
  assert.throws(
    () => validateDeploymentEnvironment({ ...validEnvironment, NOTION_TOKEN: "placeholder" }),
    /NOTION_TOKEN 格式无效/,
  );
  assert.throws(
    () =>
      validateDeploymentEnvironment({
        ...validEnvironment,
        CLOUDFLARE_PAGES_PROJECT: "Alice Portfolio",
      }),
    /CLOUDFLARE_PAGES_PROJECT 格式无效/,
  );
});

test("isolates credentials for every deployment stage", () => {
  const environment = {
    ...validEnvironment,
    NOTION_CUSTOM_SETTING: "private",
    CONTENT_SOURCE: "notion",
    ALLOW_EMPTY_SITE: "true",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
    CLOUDFLARE_API_KEY: "cloudflare-global-api-key",
    CLOUDFLARE_EMAIL: "cloudflare@example.com",
    CLOUDFLARE_CUSTOM_SETTING: "must-not-pass",
    CF_API_TOKEN: "legacy-token",
    GITHUB_TOKEN: "unrelated-github-token",
    AWS_SECRET_ACCESS_KEY: "unrelated-aws-secret",
    STATIC_OUTPUT_SECRET_MANIFEST: "/tmp/stale-manifest.json",
    ASTRO_ENV_DIR: "/project/root",
    PATH: "/usr/bin",
  };
  const deployment = validateDeploymentEnvironment(environment);

  assert.deepEqual(createTestEnvironment(environment, "/tmp/isolated-astro-env"), {
    ASTRO_ENV_DIR: "/tmp/isolated-astro-env",
    PATH: "/usr/bin",
  });
  assert.deepEqual(
    createNotionBuildEnvironment(environment, deployment, "/tmp/isolated-astro-env"),
    {
      ASTRO_ENV_DIR: "/tmp/isolated-astro-env",
      PATH: "/usr/bin",
      NOTION_TOKEN: validEnvironment.NOTION_TOKEN,
      NOTION_DATA_SOURCE_ID: validEnvironment.NOTION_DATA_SOURCE_ID,
      NOTION_JOURNAL_DATA_SOURCE_ID: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
      ALLOW_EMPTY_SITE: "true",
    },
  );
  assert.deepEqual(
    createVerificationEnvironment(environment, "/tmp/current-manifest.json"),
    {
      ASTRO_ENV_DIR: "/project/root",
      PATH: "/usr/bin",
      STATIC_OUTPUT_SECRET_MANIFEST: "/tmp/current-manifest.json",
    },
  );
  assert.deepEqual(createWranglerEnvironment(environment), {
    ASTRO_ENV_DIR: "/project/root",
    PATH: "/usr/bin",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
  });
  assert.deepEqual(createDeploymentScanValues(environment, deployment), {
    NOTION_TOKEN: validEnvironment.NOTION_TOKEN,
    NOTION_DATA_SOURCE_ID: validEnvironment.NOTION_DATA_SOURCE_ID,
    NOTION_JOURNAL_DATA_SOURCE_ID: validEnvironment.NOTION_JOURNAL_DATA_SOURCE_ID,
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
  });
});

test("adds credential-bearing proxy values to the real-secret scan", () => {
  const proxy = "https://proxy-user-2026:proxy-password-2026@proxy.example.com:8443";
  const deployment = validateDeploymentEnvironment(validEnvironment);
  const scanValues = createDeploymentScanValues(
    { ...validEnvironment, HTTPS_PROXY: proxy },
    deployment,
  );

  assert.equal(scanValues.HTTPS_PROXY_URL, proxy);
  assert.equal(scanValues.HTTPS_PROXY_USERNAME, "proxy-user-2026");
  assert.equal(scanValues.HTTPS_PROXY_PASSWORD, "proxy-password-2026");
});

test("keeps fixture tests deterministic when empty-site override exists", () => {
  assert.deepEqual(
    createTestEnvironment({ PATH: "/usr/bin", ALLOW_EMPTY_SITE: "true" }),
    { PATH: "/usr/bin" },
  );
});

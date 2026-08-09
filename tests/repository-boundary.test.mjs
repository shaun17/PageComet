import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRepositoryUrl,
  resolveRepositoryRole,
  validateRepositoryBoundary,
} from "../scripts/check-repository-boundary.mjs";

const cleanTemplateFiles = [
  ".env.example",
  ".gitignore",
  "package.json",
  "site.config.example.mjs",
  "src/pages/index.astro",
];
const cleanPackageJson = {
  dependencies: { astro: "1.0.0" },
  devDependencies: {},
};
const personalOnlyFiles = [
  "src/components/HomeSticker.astro",
  "src/components/SpatialPortrait.astro",
  "src/config/spatial-avatar-assets.ts",
  "src/config/spatial-avatar-layout.ts",
  "src/lib/home-sticker.ts",
  "src/lib/spatial-avatar-model.ts",
  "src/lib/spatial-avatar-prefetch.ts",
  "src/lib/spatial-avatar-scene.ts",
  "src/lib/spatial-portrait.ts",
  "src/pages/avatar.astro",
  "src/styles/avatar.css",
  "src/styles/home-sticker.css",
  "tests/home-sticker.test.mjs",
  "tests/spatial-portrait.test.mjs",
];
const personalOnlyAssets = [
  "public/3d/avatar.glb",
  "public/projects/id-photo-maker/background-adjustment.jpg",
  "public/projects/id-photo-maker/beauty-adjustment.jpg",
  "public/projects/id-photo-maker/size-selection.jpg",
  "public/stickers/petly-sticker.webp",
];

/** 只有显式维护环境才启用模板边界，普通官方 clone 仍可自由定制。 */
test("resolves repository roles from explicit and remote identities", () => {
  assert.equal(
    normalizeRepositoryUrl("git@github.com:shaun17/PageComet.git"),
    "github.com/shaun17/pagecomet",
  );
  assert.equal(
    resolveRepositoryRole({ originUrl: "https://github.com/shaun17/PageComet.git" }),
    "downstream",
  );
  assert.equal(
    resolveRepositoryRole({ githubRepository: "shaun17/PageComet" }),
    "template",
  );
  assert.equal(
    resolveRepositoryRole({ explicitRole: "template" }),
    "template",
  );
  assert.equal(
    resolveRepositoryRole({ githubRepository: "shaun17/wenren-site" }),
    "personal",
  );
  assert.equal(
    resolveRepositoryRole({
      explicitRole: "downstream",
      githubRepository: "shaun17/PageComet",
    }),
    "downstream",
  );
});

/** PageComet 必须拒绝本地配置和个人 3D 依赖。 */
test("rejects local configuration and personal dependencies in the template repository", () => {
  const errors = validateRepositoryBoundary({
    role: "template",
    trackedFiles: [
      ...cleanTemplateFiles,
      ".env.production",
      "site.config.mjs",
    ],
    packageJson: {
      dependencies: { astro: "1.0.0", three: "1.0.0" },
      devDependencies: { "@types/three": "1.0.0" },
    },
  });

  assert.ok(errors.some((error) => error.includes(".env.production")));
  assert.ok(errors.some((error) => error.includes("site.config.mjs")));
  assert.ok(errors.some((error) => error.includes("three")));
});

/** 每个已知个人模块和资源路径都必须单独触发模板边界，避免部分遗漏被批量断言掩盖。 */
test("rejects every known personal module and asset in the template repository", () => {
  for (const file of [...personalOnlyFiles, ...personalOnlyAssets]) {
    const errors = validateRepositoryBoundary({
      role: "template",
      trackedFiles: [...cleanTemplateFiles, file],
      packageJson: cleanPackageJson,
    });

    assert.ok(
      errors.some((error) => error.includes(file)),
      `PageComet 模板应拒绝个人文件：${file}`,
    );
  }
});

/** 个人站必须保留个人模块、运行依赖、模型和两张降级海报。 */
test("requires the complete personal source contract in the personal repository", () => {
  const requiredFiles = [
    ...cleanTemplateFiles,
    ...personalOnlyFiles,
    "public/3d/avatar.glb",
    "public/3d/poster.jpg",
    "public/3d/poster-mobile.jpg",
  ];
  assert.deepEqual(
    validateRepositoryBoundary({
      role: "personal",
      trackedFiles: requiredFiles,
      packageJson: {
        dependencies: { astro: "1.0.0", three: "1.0.0" },
        devDependencies: {},
      },
    }),
    [],
  );

  for (const requiredFile of personalOnlyFiles) {
    const errors = validateRepositoryBoundary({
      role: "personal",
      trackedFiles: requiredFiles.filter((file) => file !== requiredFile),
      packageJson: {
        dependencies: { astro: "1.0.0", three: "1.0.0" },
        devDependencies: {},
      },
    });
    assert.ok(
      errors.some((error) => error.includes(requiredFile)),
      `wenren-site 应要求个人文件：${requiredFile}`,
    );
  }

  const errors = validateRepositoryBoundary({
    role: "personal",
    trackedFiles: cleanTemplateFiles,
    packageJson: cleanPackageJson,
  });
  assert.ok(errors.some((error) => error.includes("src/pages/avatar.astro")));
  assert.ok(errors.some((error) => error.includes("GLB")));
  assert.ok(errors.some((error) => error.includes("海报")));
  assert.ok(errors.some((error) => error.includes("three")));
});

/** 普通模板使用者只受凭据与构建产物保护，不被上游个人化规则限制。 */
test("allows independent downstream customization without tracked secrets", () => {
  assert.deepEqual(
    validateRepositoryBoundary({
      role: "downstream",
      trackedFiles: [
        ...cleanTemplateFiles,
        ...personalOnlyFiles,
        ...personalOnlyAssets,
      ],
      packageJson: {
        dependencies: { astro: "1.0.0", three: "1.0.0" },
        devDependencies: { "@types/three": "1.0.0" },
      },
    }),
    [],
  );
});

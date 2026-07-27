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

/** PageComet 必须拒绝个人模型、个人组件、3D 依赖和本地配置。 */
test("rejects personal assets and local configuration in the template repository", () => {
  const errors = validateRepositoryBoundary({
    role: "template",
    trackedFiles: [
      ...cleanTemplateFiles,
      ".env.production",
      "site.config.mjs",
      "public/3d/avatar.glb",
      "src/pages/avatar.astro",
    ],
    packageJson: {
      dependencies: { astro: "1.0.0", three: "1.0.0" },
      devDependencies: { "@types/three": "1.0.0" },
    },
  });

  assert.ok(errors.some((error) => error.includes(".env.production")));
  assert.ok(errors.some((error) => error.includes("site.config.mjs")));
  assert.ok(errors.some((error) => error.includes("public/3d/avatar.glb")));
  assert.ok(errors.some((error) => error.includes("src/pages/avatar.astro")));
  assert.ok(errors.some((error) => error.includes("three")));
});

/** 个人站必须保留空间肖像源码、运行依赖、模型和两张降级海报。 */
test("requires the spatial portrait contract in the personal repository", () => {
  const requiredFiles = [
    ...cleanTemplateFiles,
    "src/components/SpatialPortrait.astro",
    "src/lib/spatial-avatar-scene.ts",
    "src/lib/spatial-portrait.ts",
    "src/pages/avatar.astro",
    "src/styles/avatar.css",
    "tests/spatial-portrait.test.mjs",
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
      trackedFiles: [...cleanTemplateFiles, "public/3d/custom-avatar.glb"],
      packageJson: cleanPackageJson,
    }),
    [],
  );
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDeploymentScanValues,
  createNotionBuildEnvironment,
  createTestEnvironment,
  createVerificationEnvironment,
  createWranglerEnvironment,
  validateDeploymentEnvironment,
  writeSecretScanManifest,
} from "./deploy/environment.mjs";
import {
  npmExecutable,
  projectRoot,
  runProcess,
  wranglerCli,
} from "./deploy/process.mjs";

export {
  createDeploymentScanValues,
  createNotionBuildEnvironment,
  createTestEnvironment,
  createVerificationEnvironment,
  createWranglerEnvironment,
  validateDeploymentEnvironment,
  writeSecretScanManifest,
} from "./deploy/environment.mjs";

/** 完成夹具测试、Notion 构建、安全校验和 Cloudflare Pages Direct Upload。 */
export const deploy = async (environment = process.env) => {
  const deployment = validateDeploymentEnvironment(environment);
  const astroEnvironmentDirectory = await mkdtemp(
    path.join(tmpdir(), "notion-site-astro-env-"),
  );
  try {
    await runProcess(npmExecutable, ["test"], {
      env: createTestEnvironment(environment, astroEnvironmentDirectory),
    });
    await runProcess(npmExecutable, ["run", "build"], {
      env: createNotionBuildEnvironment(
        environment,
        deployment,
        astroEnvironmentDirectory,
      ),
    });
  } finally {
    await rm(astroEnvironmentDirectory, { recursive: true, force: true });
  }

  const verificationDirectory = await mkdtemp(
    path.join(tmpdir(), "notion-site-verify-"),
  );
  try {
    const manifestPath = await writeSecretScanManifest(
      verificationDirectory,
      createDeploymentScanValues(environment, deployment),
    );
    await runProcess(npmExecutable, ["run", "verify:dist"], {
      env: createVerificationEnvironment(environment, manifestPath),
    });
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }

  const isolatedDirectory = await mkdtemp(
    path.join(tmpdir(), "notion-site-pages-deploy-"),
  );
  try {
    await runProcess(
      process.execPath,
      [
        wranglerCli,
        "pages",
        "deploy",
        path.join(projectRoot, "dist"),
        "--project-name",
        deployment.pagesProject,
        "--branch",
        "main",
      ],
      {
        cwd: isolatedDirectory,
        env: createWranglerEnvironment(environment),
      },
    );
  } finally {
    await rm(isolatedDirectory, { recursive: true, force: true });
  }
};

const isDirectExecution = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectExecution) {
  try {
    await deploy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

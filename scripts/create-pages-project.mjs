import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createWranglerEnvironment,
  validatePagesProjectEnvironment,
} from "./deploy/environment.mjs";
import { runProcess, wranglerCli } from "./deploy/process.mjs";

/** 使用 .env 中的项目名创建 Direct Upload 项目，避免把仓库默认名注册到用户账户。 */
export const createPagesProject = async (environment = process.env) => {
  const pagesProject = validatePagesProjectEnvironment(environment);
  const isolatedDirectory = await mkdtemp(
    path.join(tmpdir(), "notion-site-pages-create-"),
  );
  try {
    await runProcess(
      process.execPath,
      [
        wranglerCli,
        "pages",
        "project",
        "create",
        pagesProject,
        "--production-branch",
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
    await createPagesProject();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

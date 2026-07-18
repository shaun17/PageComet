import { rm } from "node:fs/promises";
import path from "node:path";

/** 清理开发服务器生成的图片，避免已撤回内容作为孤儿资源进入下一次部署。 */
const cleanDevelopmentAssets = async () => {
  const projectRoot = path.resolve(process.cwd());
  const target = path.resolve(projectRoot, "public/notion-assets");
  const expectedTarget = path.join(projectRoot, "public", "notion-assets");

  if (target !== expectedTarget || path.basename(target) !== "notion-assets") {
    throw new Error("拒绝清理未通过路径校验的 Notion 资源目录");
  }

  await rm(target, { recursive: true, force: true });
};

await cleanDevelopmentAssets();

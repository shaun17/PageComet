import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE_PATTERN = /\.(?:css|html|js|json|svg|txt|xml)$/i;
const PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const NOTION_ASSET_REFERENCE_PATTERN = /\/notion-assets\/([^"'()\s<>]+)/g;
const FORBIDDEN_OUTPUT = [
  { name: "Notion 密钥", pattern: /NOTION_TOKEN|Bearer\s+[^\s<]+|secret_[a-z0-9_]+|ntn_[a-z0-9_]{20,}/i },
  { name: "签名参数", pattern: /X-Amz-(?:Algorithm|Credential|Signature)/i },
  { name: "Notion 临时资源", pattern: /secure\.notion-static\.com|notionusercontent\.com|prod-files-secure/i },
  { name: "Notion 私有页面", pattern: /https:\/\/(?:www\.)?notion\.so\/|https:\/\/app\.notion\.com\/p\//i },
  { name: "Notion 公开页面", pattern: /https:\/\/[^/"']+\.notion\.site\//i },
  { name: "远程图片", pattern: /<img\b[^>]*\b(?:src|srcset)="https?:\/\/|url\(https?:\/\//i },
];

/** 读取 dist 中所有文本产物，二进制图片和字体不参与字符串扫描。 */
const readStaticTextOutput = async (distRoot) => {
  const names = await readdir(distRoot, { recursive: true });
  const textNames = names.filter((name) => TEXT_FILE_PATTERN.test(name));
  const contents = await Promise.all(
    textNames.map(async (name) => ({
      name,
      content: await readFile(path.join(distRoot, name), "utf8"),
    })),
  );
  return contents;
};

/** 提前拦截超过 Cloudflare Pages 25 MiB 上限的文件，避免发布到最后一步才失败。 */
const verifyPagesAssetSizes = async (distRoot) => {
  const names = await readdir(distRoot, { recursive: true });
  await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(distRoot, name);
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size <= PAGES_MAX_ASSET_BYTES) return;
      throw new Error(`静态资源 ${name} 超过 Cloudflare Pages 单文件 25 MiB 限制`);
    }),
  );
};

/** 校验长缓存的 Notion 资源名确实来自内容哈希，禁止临时文件和损坏缓存进入部署。 */
const verifyNotionAssetIntegrity = async (distRoot) => {
  const assetsRoot = path.join(distRoot, "notion-assets");
  let entries;
  try {
    entries = await readdir(assetsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }

  const assetNames = new Set();
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`Notion 资源目录包含非普通文件：${entry.name}`);
    const match = entry.name.match(/^([a-f0-9]{64})\.(?:avif|gif|jpe?g|png|webp|mp4|webm)$/);
    if (!match) throw new Error(`Notion 资源文件名不符合内容哈希规则：${entry.name}`);

    const body = await readFile(path.join(assetsRoot, entry.name));
    if (body.byteLength === 0) throw new Error(`Notion 资源为空：${entry.name}`);
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (actualHash !== match[1]) throw new Error(`Notion 资源内容哈希不匹配：${entry.name}`);
    assetNames.add(entry.name);
  }
  return assetNames;
};

/** 确保 HTML/CSS/JS 引用的每个 Notion 资源都真实存在，不把本地 404 带到线上。 */
const verifyNotionAssetReferences = (files, assetNames) => {
  for (const file of files) {
    for (const match of file.content.matchAll(NOTION_ASSET_REFERENCE_PATTERN)) {
      const rawName = match[1];
      if (rawName.includes("?") || rawName.includes("#")) {
        throw new Error(`静态产物 ${file.name} 的 Notion 资源地址包含查询参数或片段`);
      }

      let decodedName;
      try {
        decodedName = decodeURIComponent(rawName);
      } catch {
        throw new Error(`静态产物 ${file.name} 包含无法解码的 Notion 资源地址`);
      }
      if (!/^[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp|mp4|webm)$/.test(decodedName)) {
        throw new Error(`静态产物 ${file.name} 包含无效的 Notion 资源路径：${rawName}`);
      }
      if (!assetNames.has(decodedName)) {
        throw new Error(`静态产物 ${file.name} 引用了不存在的 Notion 资源：${decodedName}`);
      }
    }
  }
};

/** 部署前扫描真实生产产物，阻止密钥、临时地址和远程图片进入 Pages。 */
const verifyStaticOutput = async () => {
  const distRoot = path.resolve(process.cwd(), "dist");
  await access(path.join(distRoot, "index.html"));
  await verifyPagesAssetSizes(distRoot);
  const notionAssetNames = await verifyNotionAssetIntegrity(distRoot);
  const files = await readStaticTextOutput(distRoot);
  verifyNotionAssetReferences(files, notionAssetNames);

  for (const file of files) {
    for (const rule of FORBIDDEN_OUTPUT) {
      if (rule.pattern.test(file.content)) {
        throw new Error(`静态产物 ${file.name} 包含${rule.name}，已阻止部署`);
      }
    }
  }

  console.log(`已验证 ${files.length} 个静态文本产物，未发现凭据或临时资源泄漏。`);
};

await verifyStaticOutput();

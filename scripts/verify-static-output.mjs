import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { NOTION_ASSET_EXTENSIONS } from "../src/lib/notion/media-format-extensions.mjs";

const PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const SECRET_MANIFEST_MAX_BYTES = 64 * 1024;
const NOTION_ASSET_REFERENCE_PATTERN = /\/notion-assets\/([^"'()\s<>]+)/g;
const NOTION_ASSET_FILE_PATTERN = new RegExp(
  `^([a-f0-9]{64})(${NOTION_ASSET_EXTENSIONS.map((extension) =>
    extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})$`,
);
const FORBIDDEN_OUTPUT = [
  {
    name: "Notion 密钥",
    pattern:
      /NOTION_(?:TOKEN|DATA_SOURCE_ID)|Bearer\s+[^\s<]+|(?:secret|ntn)_[a-z0-9_-]{10,}/i,
  },
  {
    name: "Cloudflare 凭据变量",
    pattern: /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/i,
  },
  { name: "签名参数", pattern: /X-Amz-(?:Algorithm|Credential|Signature)/i },
  { name: "Notion 临时资源", pattern: /secure\.notion-static\.com|notionusercontent\.com|prod-files-secure/i },
  { name: "Notion 私有页面", pattern: /https:\/\/(?:www\.)?notion\.so\/|https:\/\/app\.notion\.com\/p\//i },
  { name: "Notion 公开页面", pattern: /https:\/\/[^/"']+\.notion\.site\//i },
  { name: "远程图片", pattern: /<img\b[^>]*\b(?:src|srcset)="https?:\/\/|url\(https?:\/\//i },
];

/** 枚举 dist 内全部普通文件并拒绝符号链接，防止扫描范围逃逸。 */
const listStaticOutputFiles = async (distRoot) => {
  const names = await readdir(distRoot, { recursive: true });
  const files = [];
  for (const name of names) {
    const filePath = path.join(distRoot, name);
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`静态产物不允许包含符号链接：${name}`);
    }
    if (metadata.isFile()) files.push({ name, filePath, size: metadata.size });
  }
  return files;
};

/** 仅把严格合法的文本编码且不含二进制控制字节的文件视为文本。 */
export const decodeStaticText = (body) => {
  let encoding = "utf-8";
  if (body[0] === 0xff && body[1] === 0xfe) encoding = "utf-16le";
  if (body[0] === 0xfe && body[1] === 0xff) encoding = "utf-16be";
  if (encoding === "utf-8" && body.includes(0)) return null;

  let content;
  try {
    content = new TextDecoder(encoding, { fatal: true }).decode(body);
  } catch {
    return null;
  }

  for (const character of content) {
    const codePoint = character.codePointAt(0);
    const isAllowedWhitespace =
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      character === "\f";
    if (codePoint < 0x20 && !isAllowedWhitespace) return null;
  }
  return content;
};

/** 读取所有可判定为文本的产物，不依赖容易漏项的扩展名白名单。 */
const readStaticTextOutput = async (files) => {
  const contents = [];
  for (const file of files) {
    const body = await readFile(file.filePath);
    const content = decodeStaticText(body);
    if (content !== null) contents.push({ name: file.name, content });
  }
  return contents;
};

/** 提前拦截超过 Cloudflare Pages 25 MiB 上限的文件。 */
const verifyPagesAssetSizes = (files) => {
  for (const file of files) {
    if (file.size > PAGES_MAX_ASSET_BYTES) {
      throw new Error(`静态资源 ${file.name} 超过 Cloudflare Pages 单文件 25 MiB 限制`);
    }
  }
};

/** 为真实密钥生成生产产物中常见的可逆表示。 */
export const createSecretRepresentations = (value) => {
  const bytes = Buffer.from(value, "utf8");
  const fullPercentUpper = [...bytes]
    .map((byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
  const unicodeEscaped = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0xffff
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : `\\u{${codePoint.toString(16)}}`;
    })
    .join("");
  const htmlDecimal = [...value]
    .map((character) => `&#${character.codePointAt(0)};`)
    .join("");
  const candidates = [
    ["原值", value],
    ["URL 编码", encodeURIComponent(value)],
    ["全量百分号编码", fullPercentUpper],
    ["全量百分号编码", fullPercentUpper.toLowerCase()],
    ["Base64 编码", bytes.toString("base64")],
    [
      "Base64URL 编码",
      bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_"),
    ],
    ["Base64URL 编码", bytes.toString("base64url")],
    ["十六进制编码", bytes.toString("hex")],
    ["十六进制编码", bytes.toString("hex").toUpperCase()],
    ["Unicode 转义", unicodeEscaped],
    ["HTML 数字实体", htmlDecimal],
  ];

  const seen = new Set();
  return candidates
    .filter(([, encodedValue]) => {
      if (!encodedValue || seen.has(encodedValue)) return false;
      seen.add(encodedValue);
      return true;
    })
    .map(([encodingName, encodedValue]) => ({ encoding: encodingName, value: encodedValue }));
};

/** 读取临时密钥清单并转换为精确扫描规则；清单内容不会写入日志。 */
const readSecretScanRules = async (manifestPath) => {
  if (!manifestPath) return [];

  const metadata = await lstat(manifestPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("静态产物密钥清单必须是普通文件");
  }
  if (metadata.size > SECRET_MANIFEST_MAX_BYTES) {
    throw new Error("静态产物密钥清单超过 64 KiB 安全上限");
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("静态产物密钥清单不是有效 JSON");
  }
  if (manifest?.version !== 1 || !Array.isArray(manifest.secrets)) {
    throw new Error("静态产物密钥清单结构无效");
  }

  const rules = [];
  for (const secret of manifest.secrets) {
    if (
      !secret ||
      typeof secret.name !== "string" ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(secret.name) ||
      typeof secret.value !== "string" ||
      secret.value.length < 8 ||
      secret.value.length > 8192
    ) {
      throw new Error("静态产物密钥清单包含无效条目");
    }
    for (const representation of createSecretRepresentations(secret.value)) {
      rules.push({ name: secret.name, ...representation });
    }
  }
  return rules;
};

/** 校验 Notion 资源名确实来自内容哈希，禁止损坏缓存进入部署。 */
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
    const match = entry.name.match(NOTION_ASSET_FILE_PATTERN);
    if (!match) throw new Error(`Notion 资源文件名不符合内容哈希规则：${entry.name}`);

    const body = await readFile(path.join(assetsRoot, entry.name));
    if (body.byteLength === 0) throw new Error(`Notion 资源为空：${entry.name}`);
    const actualHash = createHash("sha256").update(body).digest("hex");
    if (actualHash !== match[1]) throw new Error(`Notion 资源内容哈希不匹配：${entry.name}`);
    assetNames.add(entry.name);
  }
  return assetNames;
};

/** 确保页面引用的每个 Notion 资源都真实存在，避免把本地 404 带到线上。 */
const verifyNotionAssetReferences = (files, assetNames) => {
  for (const file of files) {
    for (const match of file.content.matchAll(NOTION_ASSET_REFERENCE_PATTERN)) {
      const rawName = match[1];
      const isCloudflareHeaderGlob = file.name === "_headers" && rawName === "*";
      if (isCloudflareHeaderGlob) continue;

      if (rawName.includes("?") || rawName.includes("#")) {
        throw new Error(`静态产物 ${file.name} 的 Notion 资源地址包含查询参数或片段`);
      }

      let decodedName;
      try {
        decodedName = decodeURIComponent(rawName);
      } catch {
        throw new Error(`静态产物 ${file.name} 包含无法解码的 Notion 资源地址`);
      }
      if (!NOTION_ASSET_FILE_PATTERN.test(decodedName)) {
        throw new Error(`静态产物 ${file.name} 包含无效的 Notion 资源路径：${rawName}`);
      }
      if (!assetNames.has(decodedName)) {
        throw new Error(`静态产物 ${file.name} 引用了不存在的 Notion 资源：${decodedName}`);
      }
    }
  }
};

/** 部署前扫描真实产物，阻止密钥、临时地址、远程图片和超大文件发布。 */
export const verifyStaticOutput = async ({
  distRoot = path.resolve(process.cwd(), "dist"),
  secretManifestPath = process.env.STATIC_OUTPUT_SECRET_MANIFEST,
} = {}) => {
  await access(path.join(distRoot, "index.html"));
  const outputFiles = await listStaticOutputFiles(distRoot);
  verifyPagesAssetSizes(outputFiles);
  const notionAssetNames = await verifyNotionAssetIntegrity(distRoot);
  const files = await readStaticTextOutput(outputFiles);
  const secretRules = await readSecretScanRules(secretManifestPath);
  verifyNotionAssetReferences(files, notionAssetNames);

  for (const file of files) {
    for (const rule of FORBIDDEN_OUTPUT) {
      if (rule.pattern.test(file.content)) {
        throw new Error(`静态产物 ${file.name} 包含${rule.name}，已阻止部署`);
      }
    }
    for (const rule of secretRules) {
      if (file.content.includes(rule.value)) {
        throw new Error(
          `静态产物 ${file.name} 包含 ${rule.name} 的${rule.encoding}，已阻止部署`,
        );
      }
    }
  }

  console.log(`已验证 ${files.length} 个静态文本产物，未发现凭据或临时资源泄漏。`);
};

const isDirectExecution = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectExecution) {
  try {
    await verifyStaticOutput();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

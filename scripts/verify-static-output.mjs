import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE_PATTERN = /\.(?:css|html|js|json|svg|txt|xml)$/i;
const FORBIDDEN_OUTPUT = [
  { name: "Notion 密钥", pattern: /NOTION_TOKEN|Bearer\s+[^\s<]+|secret_[a-z0-9_]+|ntn_[a-z0-9_]{20,}/i },
  { name: "签名参数", pattern: /X-Amz-(?:Algorithm|Credential|Signature)/i },
  { name: "Notion 临时资源", pattern: /secure\.notion-static\.com|notionusercontent\.com|prod-files-secure/i },
  { name: "Notion 私有页面", pattern: /https:\/\/(?:www\.)?notion\.so\/|https:\/\/app\.notion\.com\/p\//i },
  { name: "Notion 公开页面", pattern: /https:\/\/[^/"']+\.notion\.site\//i },
  { name: "远程图片", pattern: /(?:src|srcset)="https?:\/\/|url\(https?:\/\//i },
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

/** 部署前扫描真实生产产物，阻止密钥、临时地址和远程图片进入 Pages。 */
const verifyStaticOutput = async () => {
  const distRoot = path.resolve(process.cwd(), "dist");
  await access(path.join(distRoot, "index.html"));
  const files = await readStaticTextOutput(distRoot);

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

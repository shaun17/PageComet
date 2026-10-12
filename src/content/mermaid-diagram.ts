import { renderMermaidSVG } from "beautiful-mermaid";

/** 只渲染完全依靠 SVG 属性着色的图表类型；xychart 依赖内联样式类，交给代码块降级。 */
const SUPPORTED_HEADER =
  /^(?:graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram)\b/;

/** 渲染结果一旦出现可执行内容或外部资源，就整体放弃并回退为源码展示。 */
const UNSAFE_MARKUP =
  /<script|<foreignObject|<a[\s>]|<image|<iframe|\son[a-z]+\s*=|javascript:|@import|xlink:href/i;

/** 判断 Notion 代码块的语言是否为 Mermaid，兼容大小写差异。 */
export const isMermaidLanguage = (language: string | undefined): boolean =>
  language?.trim().toLowerCase() === "mermaid";

/**
 * 渲染器把 `subgraph 标题` 的标题去掉非 ASCII 字符后当作 id，
 * 中文标题会全部变成空 id 而互相覆盖；这里为这类子图补上唯一 id，标题原样保留。
 */
export const assignSubgraphIds = (source: string): string => {
  const usedIds = new Set<string>();
  let generatedIndex = 0;
  return source
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*)subgraph\s+(.+)$/);
      if (!match) return line;
      const [, indent, rest] = match as [string, string, string];
      const label = rest.trim();
      const explicit = label.match(/^([\w-]+)\s*\[(.+)\]$/);
      const id = explicit ? explicit[1]! : label.replace(/\s+/g, "_").replace(/[^\w]/g, "");
      if (id && !usedIds.has(id)) {
        usedIds.add(id);
        return line;
      }
      generatedIndex += 1;
      const generatedId = `pagecomet_subgraph_${generatedIndex}`;
      usedIds.add(generatedId);
      return `${indent}subgraph ${generatedId} [${explicit ? explicit[2] : label}]`;
    })
    .join("\n");
};

/** 给 SVG 内所有 id 及其引用加前缀，避免同页多张图或页面元素之间 id 冲突。 */
const prefixSvgIds = (svg: string, prefix: string): string =>
  svg
    .replace(/\sid="([^"]+)"/g, (_, id: string) => ` id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}-${id})`)
    .replace(/\shref="#([^"]+)"/g, (_, id: string) => ` href="#${prefix}-${id}"`);

/**
 * 在构建期把 Mermaid 源码渲染成静态 SVG。
 * 站点 CSP 不允许内联样式，因此移除渲染器自带的 style 元素与属性，
 * 颜色变量和字体改由站点样式表提供；失败或类型不支持时返回 null，由调用方展示源码。
 */
export const renderMermaidDiagram = (
  source: string,
  idPrefix: string,
  accessibleLabel: string,
): string | null => {
  const code = source.trim();
  if (!SUPPORTED_HEADER.test(code)) return null;

  let svg: string;
  try {
    svg = renderMermaidSVG(assignSubgraphIds(code), { transparent: true });
  } catch {
    return null;
  }

  const cleaned = prefixSvgIds(
    svg.replace(/<style[\s\S]*?<\/style>/g, "").replace(/\sstyle="[^"]*"/g, ""),
    idPrefix.replace(/[^a-zA-Z0-9_-]/g, "-"),
  );
  if (UNSAFE_MARKUP.test(cleaned)) return null;

  // 图表作为一张整体图片暴露给读屏，名称来自图注或通用描述。
  const escapedLabel = accessibleLabel
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return cleaned.replace(
    /^<svg\s/,
    `<svg role="img" aria-label="${escapedLabel}" focusable="false" `,
  );
};

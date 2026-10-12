import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite, assignSubgraphIds, isMermaidLanguage, renderMermaidDiagram;

/** 使用项目自身的 Vite 配置加载 TypeScript 图表渲染器。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ assignSubgraphIds, isMermaidLanguage, renderMermaidDiagram } = await vite.ssrLoadModule(
    "/src/content/mermaid-diagram.ts",
  ));
});

/** 测试完成后关闭文件监听器，避免 Node 进程无法退出。 */
after(async () => {
  await vite?.close();
});

test("recognizes mermaid code blocks regardless of case", () => {
  assert.equal(isMermaidLanguage("mermaid"), true);
  assert.equal(isMermaidLanguage(" Mermaid "), true);
  assert.equal(isMermaidLanguage("shell"), false);
  assert.equal(isMermaidLanguage(undefined), false);
});

test("gives CJK subgraphs unique ids while keeping their labels", () => {
  const source = ["graph TB", "  subgraph 接入层", "  end", "  subgraph 存储层", "  end", "  subgraph api [接口]", "  end"].join("\n");
  const lines = assignSubgraphIds(source).split("\n");
  assert.equal(lines[1], "  subgraph pagecomet_subgraph_1 [接入层]");
  assert.equal(lines[3], "  subgraph pagecomet_subgraph_2 [存储层]");
  assert.equal(lines[5], "  subgraph api [接口]");
});

test("renders flowcharts as CSP-safe static SVG with prefixed ids", () => {
  const svg = renderMermaidDiagram(
    ["graph TB", "  subgraph 写作", '    A["<script>alert(1)</script>"]', "  end", "  subgraph 发布", "    B", "  end", "  A --> B"].join("\n"),
    "diagram-1",
    "发布流程",
  );
  assert.ok(svg);
  assert.match(svg, /^<svg role="img" aria-label="发布流程" focusable="false" /);
  // 站点 CSP 禁止内联样式，输出里不能残留 style 元素、style 属性或外部字体。
  assert.doesNotMatch(svg, /<style|\sstyle="|@import|fonts\.googleapis/);
  assert.doesNotMatch(svg, /<script/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, />写作</);
  assert.match(svg, />发布</);
  assert.match(svg, /id="diagram-1-arrowhead"/);
  assert.match(svg, /marker-end="url\(#diagram-1-arrowhead\)"/);
  assert.doesNotMatch(svg, /\sid="(?!diagram-1-)/);
});

test("falls back to source code for unsupported or invalid diagrams", () => {
  assert.equal(renderMermaidDiagram('pie title 时间\n  "写作": 60', "d", "图"), null);
  assert.equal(renderMermaidDiagram("xychart-beta\n  bar [1, 2]", "d", "图"), null);
  assert.equal(renderMermaidDiagram("not a diagram", "d", "图"), null);
});

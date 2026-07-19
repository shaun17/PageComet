import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createTestViteServer } from "./vite-test-server.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let vite;
let resolveVideoPresentation;

/** 使用 Vite 加载网站的视频地址解析模块。 */
before(async () => {
  vite = await createTestViteServer(projectRoot);
  ({ resolveVideoPresentation } = await vite.ssrLoadModule(
    "/src/content/video-presentation.ts",
  ));
});

/** 测试完成后关闭文件监听器。 */
after(async () => {
  await vite?.close();
});

test("resolves native video and allowlisted video providers safely", () => {
  assert.deepEqual(resolveVideoPresentation("/notion-assets/demo.mp4", "video"), {
    kind: "native",
    url: "/notion-assets/demo.mp4",
    external: false,
  });
  assert.deepEqual(
    resolveVideoPresentation("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"),
    {
      kind: "embed",
      url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      provider: "YouTube",
    },
  );
  assert.equal(
    resolveVideoPresentation("https://example.com/embed", "embed").kind,
    "link",
  );
  assert.deepEqual(resolveVideoPresentation("https://example.com/demo.mov", "video"), {
    kind: "link",
    url: "https://example.com/demo.mov",
    external: true,
  });
  assert.equal(resolveVideoPresentation("javascript:alert(1)", "video"), null);
});

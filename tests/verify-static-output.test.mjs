import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeSecretScanManifest } from "../scripts/deploy.mjs";
import {
  createSecretRepresentations,
  decodeStaticText,
  verifyStaticOutput,
} from "../scripts/verify-static-output.mjs";

/** 创建最小可校验的静态目录，并在测试结束时完整清理。 */
const createStaticFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "static-output-test-"));
  const distRoot = path.join(root, "dist");
  await mkdir(distRoot);
  await writeFile(path.join(distRoot, "index.html"), "<!doctype html><title>Fixture</title>");
  return { root, distRoot };
};

test("writes the real-secret manifest with owner-only permissions", async () => {
  const { root } = await createStaticFixture();
  try {
    const manifestPath = await writeSecretScanManifest(root, {
      NOTION_TOKEN: "ntn_manifest_permission_fixture",
    });
    const metadata = await stat(manifestPath);
    assert.ok(metadata.isFile());
    if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects every supported real-secret representation in extensionless output", async () => {
  const { root, distRoot } = await createStaticFixture();
  const secret = "cloudflare+/credential-value-2026";
  try {
    const manifestPath = await writeSecretScanManifest(root, {
      CLOUDFLARE_API_TOKEN: secret,
    });
    const outputPath = path.join(distRoot, "_headers");

    for (const representation of createSecretRepresentations(secret)) {
      await writeFile(outputPath, `x-secret: ${representation.value}\n`);
      await assert.rejects(
        verifyStaticOutput({ distRoot, secretManifestPath: manifestPath }),
        new RegExp(`CLOUDFLARE_API_TOKEN.*${representation.encoding}`),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scans arbitrary text extensions and safely skips binary media", async () => {
  const { root, distRoot } = await createStaticFixture();
  const secret = "another-cloudflare-secret-2026";
  try {
    const manifestPath = await writeSecretScanManifest(root, {
      CLOUDFLARE_API_TOKEN: secret,
    });
    const customOutput = path.join(distRoot, "payload.custom-output");
    await writeFile(customOutput, Buffer.from(secret).toString("base64"));
    await assert.rejects(
      verifyStaticOutput({ distRoot, secretManifestPath: manifestPath }),
      /CLOUDFLARE_API_TOKEN.*Base64/,
    );

    await rm(customOutput);
    const binaryBody = Buffer.concat([Buffer.from([0x00, 0xff, 0x01]), Buffer.from(secret)]);
    await writeFile(path.join(distRoot, "media.unknown"), binaryBody);
    await verifyStaticOutput({ distRoot, secretManifestPath: manifestPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("allows the Cloudflare header glob but still rejects missing asset URLs", async () => {
  const { root, distRoot } = await createStaticFixture();
  try {
    await writeFile(
      path.join(distRoot, "_headers"),
      "/notion-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    );
    await verifyStaticOutput({ distRoot });

    const missingAsset = `${"a".repeat(64)}.png`;
    await writeFile(
      path.join(distRoot, "index.html"),
      `<!doctype html><img src="/notion-assets/${missingAsset}" alt="">`,
    );
    await assert.rejects(
      verifyStaticOutput({ distRoot }),
      new RegExp(`引用了不存在的 Notion 资源：${missingAsset}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses strict UTF-8 and control-byte checks when identifying text", () => {
  assert.equal(decodeStaticText(Buffer.from("plain text\n")), "plain text\n");
  assert.equal(
    decodeStaticText(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])),
    "hi",
  );
  assert.equal(decodeStaticText(Buffer.from([0x00, 0x61])), null);
  assert.equal(decodeStaticText(Buffer.from([0xff, 0xfe, 0xfd])), null);
});

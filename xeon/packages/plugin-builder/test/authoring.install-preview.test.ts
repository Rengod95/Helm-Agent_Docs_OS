import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  installExtension,
  packExtension,
  previewInstall,
  scaffoldExtension,
} from "../src/index.ts";
import { tempRoot, templateDirs } from "./support.ts";

// 앱 안 설치의 미리 보기와 해시 확인(L3.authoring.spec §3.3 `link`, F.wire-settings.spec `ext.installPreview`).
const root = tempRoot();
const templates = templateDirs();

async function packed(name: string, requires: readonly string[] = []): Promise<string> {
  const dir = root.path(name);
  const made = await scaffoldExtension({ kind: "single-plugin", name, dir }, { templates });
  if (!made.ok) throw new Error(made.error.message);
  if (requires.length > 0) {
    const path = join(dir, ".fresnel-plugin", "plugin.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.plugins[0].requires = requires.map((id) => ({ id, range: "^1.0.0" }));
    writeFileSync(path, JSON.stringify(manifest, null, 2));
  }
  const out = await packExtension({ dir });
  if (!out.ok) throw new Error(out.error.message);
  return out.value.path;
}

test("previewInstall: shows name, version, source, hash and sorts requested access by kind, writing nothing", async () => {
  const source = await packed("pv-demo", [
    "web.fetch",
    "workspace.files",
    "workspace.shell",
    "dialog.notify",
  ]);
  const extensions = root.path("pv-ext");
  const preview = await previewInstall({ source }, { extensionsDir: extensions });
  if (!preview.ok) throw new Error(preview.error.message);
  expect(preview.value).toMatchObject({
    name: "pv-demo",
    version: "0.1.0",
    source,
    trustRequest: "user",
    hooks: ["boundary.settle.after"],
    tools: [],
    displayName: "pv-demo",
    warnings: [],
    installedVersion: null,
    network: ["web.fetch"],
    files: ["workspace.files"],
    shell: ["workspace.shell"],
    drives: false,
  });
  expect(preview.value.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(preview.value.capabilities).toContainEqual({ id: "web.fetch", optional: false });
  expect(existsSync(extensions)).toBe(false);
  // 같은 폴더는 같은 해시
  const again = await previewInstall({ source }, { extensionsDir: extensions });
  expect(again.ok && again.value.sha256).toBe(preview.value.sha256);
});

test("previewInstall: reports the installed version it would replace and refuses what install refuses", async () => {
  const source = await packed("pv-replace");
  const extensions = root.path("pv-replace-ext");
  const first = await installExtension({ source }, { extensionsDir: extensions });
  expect(first.ok).toBe(true);
  const preview = await previewInstall({ source }, { extensionsDir: extensions });
  expect(preview.ok && preview.value.installedVersion).toBe("0.1.0");
  expect(await previewInstall({ source: "relative/dir" }, { extensionsDir: extensions })).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "source must be an absolute path" },
  });
});

test("installExtension: a matching expectedSha256 installs, a changed folder is refused and leaves nothing", async () => {
  const source = await packed("pv-hash");
  const extensions = root.path("pv-hash-ext");
  const preview = await previewInstall({ source }, { extensionsDir: extensions });
  if (!preview.ok) throw new Error(preview.error.message);

  writeFileSync(join(source, "README.md"), "changed after the preview\n");
  const refused = await installExtension(
    { source, expectedSha256: preview.value.sha256 },
    { extensionsDir: extensions },
  );
  expect(refused).toEqual({
    ok: false,
    error: {
      kind: "source_changed",
      message: "the folder changed after the preview; preview it again",
    },
  });
  expect(readdirSync(extensions)).toEqual([]);

  const fresh = await previewInstall({ source }, { extensionsDir: extensions });
  if (!fresh.ok) throw new Error(fresh.error.message);
  expect(fresh.value.sha256).not.toBe(preview.value.sha256);
  const installed = await installExtension(
    { source, expectedSha256: fresh.value.sha256 },
    { extensionsDir: extensions },
  );
  expect(installed).toMatchObject({ ok: true, value: { name: "pv-hash", replaced: false } });
  expect(readdirSync(extensions)).toEqual(["pv-hash"]);
});

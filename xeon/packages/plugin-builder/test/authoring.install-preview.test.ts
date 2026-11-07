import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
    error: {
      kind: "not_absolute",
      message: "source must be an absolute path",
      reasons: [{ code: "not_absolute" }],
    },
  });
});

test("previewInstall and installExtension tell a folder without the plugin file from a missing folder, and write nothing", async () => {
  const bare = root.path("pv-bare-folder");
  mkdirSync(bare, { recursive: true });
  const extensions = root.path("pv-bare-ext");
  const noManifest = {
    ok: false,
    error: {
      kind: "no_manifest",
      message: ".fresnel-plugin/plugin.json is missing",
      reasons: [{ code: "no_manifest" }],
    },
  } as const;
  expect(await previewInstall({ source: bare }, { extensionsDir: extensions })).toEqual(noManifest);
  expect(await installExtension({ source: bare }, { extensionsDir: extensions })).toEqual(
    noManifest,
  );
  const gone = root.path("pv-gone-folder");
  const missing = await previewInstall({ source: gone }, { extensionsDir: extensions });
  expect(missing).toMatchObject({
    ok: false,
    error: { kind: "not_found", reasons: [{ code: "folder_missing" }] },
  });
  expect(existsSync(extensions)).toBe(false);
});

/** 매니페스트 파일을 읽어 고친 뒤 다시 쓴다(고친 글자가 든 줄 번호는 시험이 원문에서 따로 센다) */
function editManifest(source: string, edit: (text: string) => string): void {
  const path = join(source, ".fresnel-plugin", "plugin.json");
  writeFileSync(path, edit(readFileSync(path, "utf8")));
}

/** 원문에서 그 글자가 처음 든 줄(1부터). 시험이 검사기와 따로 세어 값을 맞춘다 */
function lineWith(source: string, needle: string): number {
  const lines = readFileSync(join(source, ".fresnel-plugin", "plugin.json"), "utf8").split("\n");
  return lines.findIndex((line) => line.includes(needle)) + 1;
}

test("previewInstall and installExtension name a misspelt manifest key with its field and line, and the required key it stands for", async () => {
  const source = await packed("pv-misspelt");
  editManifest(source, (text) => text.replace('"entry"', '"entrie"'));
  const extensions = root.path("pv-misspelt-ext");
  const refusal = {
    ok: false,
    error: {
      kind: "invalid_input",
      message: "manifest is not valid: must have required properties entry",
      reasons: [
        {
          code: "unknown_key",
          field: "entrie",
          line: lineWith(source, '"entrie"'),
          message: 'unknown top-level key "entrie" was removed',
        },
        { code: "missing_field", field: "entry", message: "must have required properties entry" },
      ],
    },
  } as const;
  expect(await previewInstall({ source }, { extensionsDir: extensions })).toEqual(refusal);
  expect(await installExtension({ source }, { extensionsDir: extensions })).toEqual(refusal);
  expect(existsSync(extensions)).toBe(false);
});

test("previewInstall names a misspelt plugins key and the plugins list it stands for", async () => {
  const source = await packed("pv-plugins-key");
  editManifest(source, (text) => text.replace('"plugins"', '"pluginz"'));
  const preview = await previewInstall({ source }, { extensionsDir: root.path("pv-plugins-ext") });
  expect(preview).toMatchObject({
    ok: false,
    error: {
      kind: "invalid_input",
      reasons: [
        { code: "unknown_key", field: "pluginz", line: lineWith(source, '"pluginz"') },
        { code: "missing_field", field: "plugins" },
      ],
    },
  });
});

test("previewInstall gives the entry format and a missing entry file each its own reason with the line", async () => {
  const source = await packed("pv-entry-reason");
  const extensions = root.path("pv-entry-ext");
  editManifest(source, (text) =>
    text.replace('"entry": "./dist/index.js"', '"entry": "./src/index.ts"'),
  );
  expect(await previewInstall({ source }, { extensionsDir: extensions })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: "entry must be a bundled single file (run ext.package first)",
      reasons: [{ code: "entry_format", field: "entry", line: lineWith(source, '"entry"') }],
    },
  });
  editManifest(source, (text) => text.replace("./src/index.ts", "./dist/gone.js"));
  expect(await installExtension({ source }, { extensionsDir: extensions })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: "entry ./dist/gone.js does not exist",
      reasons: [{ code: "entry_missing", field: "entry", line: lineWith(source, '"entry"') }],
    },
  });
});

test("previewInstall gives a file that is not JSON its own reason, and no line", async () => {
  const source = await packed("pv-not-json");
  editManifest(source, () => "{ not json");
  expect(await previewInstall({ source }, { extensionsDir: root.path("pv-json-ext") })).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: ".fresnel-plugin/plugin.json is not JSON",
      reasons: [{ code: "manifest_json" }],
    },
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

test("previewInstall and installExtension refuse a name with the host's hook unit prefix, give the reason, and write nothing", async () => {
  const source = await packed("pv-hooks-look");
  const manifestPath = join(source, ".fresnel-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, name: "fresnel-hooks-x" }, null, 2));
  const extensions = root.path("pv-hooks-ext");
  const refusal = {
    ok: false,
    error: {
      kind: "invalid_input",
      message:
        'manifest is not valid: extension name "fresnel-hooks-x" starts with "fresnel-hooks-", a prefix the host reserves for its own units',
      reasons: [
        {
          code: "name_reserved",
          field: "name",
          line: lineWith(source, '"name"'),
          message:
            'extension name "fresnel-hooks-x" starts with "fresnel-hooks-", a prefix the host reserves for its own units',
        },
      ],
    },
  } as const;
  expect(await previewInstall({ source }, { extensionsDir: extensions })).toEqual(refusal);
  expect(await installExtension({ source }, { extensionsDir: extensions })).toEqual(refusal);
  expect(existsSync(extensions)).toBe(false);
});

test("previewInstall: lists the screens and the bridge capabilities each frame declares", async () => {
  const source = await packed("pv-screens");
  const path = join(source, ".fresnel-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.ui = {
    schemaVersion: 1,
    widgets: "^1.0.0",
    items: [
      {
        id: "all",
        placement: "page",
        mode: "app",
        title: "Perm all",
        app: {
          root: "./ui/all",
          entry: "index.html",
          bridge: "^1.0.0",
          reason: "Test every shell permission.",
          capabilities: ["files", "notify", "settingsWrite", "secrets"],
        },
        fallback: "./ui/fallback.json",
      },
      { id: "plain", placement: "page", title: "Plain", file: "./ui/plain.json" },
    ],
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  const preview = await previewInstall({ source }, { extensionsDir: root.path("pv-screens-ext") });
  if (!preview.ok) throw new Error(preview.error.message);
  expect(preview.value.screens).toEqual([
    {
      id: "all",
      title: "Perm all",
      placement: "page",
      mode: "app",
      capabilities: ["files", "notify", "settingsWrite", "secrets"],
    },
    { id: "plain", title: "Plain", placement: "page", mode: "native", capabilities: [] },
  ]);
});

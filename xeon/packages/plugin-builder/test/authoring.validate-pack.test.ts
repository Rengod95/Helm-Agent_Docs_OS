import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { scanDriveSource } from "@fresnel/group-sdk/testing";
import {
  installExtension,
  looksSecret,
  packExtension,
  removeExtension,
  scaffoldExtension,
  validateCompositionReport,
  validateExtensionDir,
} from "../src/index.ts";
import { readManifest, readRecord, tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();

async function scaffolded(
  name: string,
  kind: "plugin-group" | "single-plugin" = "plugin-group",
): Promise<string> {
  const dir = root.path(name);
  const made = await scaffoldExtension({ kind, name, dir }, { templates });
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

function editManifest(dir: string, edit: (manifest: Record<string, unknown>) => void): void {
  const path = join(dir, ".fresnel-plugin", "plugin.json");
  const manifest = readRecord(path);
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

test("authoring.validate: a fresh scaffold has no errors", async () => {
  const dir = await scaffolded("v-fresh");
  const report = await validateExtensionDir(dir, { scanDrive: scanDriveSource });
  expect(report).toEqual({ ok: true, value: { ok: true, issues: [] } });
});

test("authoring.validate: AU-002 refuses a builtin trust request", async () => {
  const dir = await scaffolded("v-builtin");
  editManifest(dir, (manifest) => {
    manifest["trust"] = { level: "builtin" };
  });
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  expect(report.value.ok).toBe(false);
  expect(report.value.issues.filter((found) => found.code === "AU-002")).toEqual([
    {
      severity: "error",
      code: "AU-002",
      path: "/trust/level",
      message: "an authored extension cannot request the builtin trust level",
    },
  ]);
});

test("authoring.validate: AU-009 finds a secret literal with file and line", async () => {
  const dir = await scaffolded("v-secret");
  // 시험 소스에 리터럴로 적으면 저장소 비밀 검사에 걸리므로 실행 중에 이어 붙인다
  const secretValue = ["abcd1234", "efgh5678"].join("");
  const file = join(dir, "src", "settings.ts");
  writeFileSync(file, `${readFileSync(file, "utf8")}\nconst apiKey = "${secretValue}";\n`);
  const lines = readFileSync(file, "utf8").split("\n");
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  const secrets = report.value.issues.filter((found) => found.code === "AU-009");
  expect(secrets.map((found) => [found.file, found.line, found.severity])).toEqual([
    ["src/settings.ts", lines.findIndex((line) => line.includes(secretValue)) + 1, "error"],
  ]);
});

test("authoring.validate: AU-012 reports replay-discipline violations of the drive", async () => {
  const dir = await scaffolded("v-replay");
  const file = join(dir, "src", "index.ts");
  const source = readFileSync(file, "utf8");
  expect(source).toContain('if (st.phase === "done") return;');
  writeFileSync(
    file,
    source.replace('if (st.phase === "done") return;', "if (Date.now() < 0) return;"),
  );
  const report = await validateExtensionDir(dir, { scanDrive: scanDriveSource });
  if (!report.ok) throw new Error(report.error.message);
  const found = report.value.issues.filter((entry) => entry.code === "AU-012");
  expect(found.length).toBe(1);
  expect(found[0]?.severity).toBe("error");
  expect(found[0]?.file).toBe("src/index.ts");
  expect(found[0]?.message).toContain("Date.now");
});

test("authoring.validate: without a drive scanner a driving extension gets one AU-012 warning for the folder and stays ok", async () => {
  const dir = await scaffolded("v-no-scanner");
  const report = await validateExtensionDir(dir);
  expect(report).toEqual({
    ok: true,
    value: {
      ok: true,
      issues: [
        {
          severity: "warning",
          code: "AU-012",
          path: "",
          message:
            "the replay discipline scan did not run in this build; run scanDriveSource from @fresnel/group-sdk/testing to check the drive",
        },
      ],
    },
  });
});

test("authoring.validate: without a drive scanner a non-driving extension gets no AU-012 issue", async () => {
  const dir = await scaffolded("v-single-no-scanner", "single-plugin");
  const report = await validateExtensionDir(dir);
  expect(report).toEqual({ ok: true, value: { ok: true, issues: [] } });
});

test("authoring.view-mode-checks: card with an app view, empty reason, project trust and no fallback", async () => {
  const dir = await scaffolded("v-view", "single-plugin");
  editManifest(dir, (manifest) => {
    manifest["trust"] = { level: "project" };
    manifest["ui"] = {
      schemaVersion: 1,
      items: [
        {
          id: "board",
          placement: "page",
          mode: "app",
          title: "Board",
          app: { root: "./app", entry: "index.html", reason: "", bridge: "^1.0.0" },
        },
        {
          id: "result",
          placement: "card",
          mode: "app",
          title: "Result",
          forKind: "x.view-card.note",
          app: { root: "./app", entry: "index.html", reason: "needs a canvas", bridge: "^1.0.0" },
        },
      ],
    };
  });
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  const codes = report.value.issues.map((found) => `${found.severity}:${found.code}:${found.path}`);
  expect(codes).toContain("error:ui_reason_empty:/ui/items/0/app/reason");
  expect(codes).toContain("error:ui_mode_not_allowed:/ui/items/1/mode");
  expect(codes).toContain("warning:AU-006:/ui/items/0/app");
  expect(codes).toContain("warning:AU-007:/ui/items/0/fallback");
});

test("authoring.validate-composition: draft checked against plugin declarations (W-47)", () => {
  const draft = {
    blocks: [
      { id: "guard", stage: "guard", op: "on" as const, hooks: ["tool.call.before" as const] },
    ],
  };
  const ok = validateCompositionReport(draft, [{ layer: "L3", hooks: ["tool.call.before"] }]);
  expect(ok).toEqual({ ok: true, issues: [] });
  const bad = validateCompositionReport(draft, [{ layer: "L3", hooks: ["boundary.settle.after"] }]);
  expect(bad.ok).toBe(false);
  expect(bad.issues.every((found) => found.severity === "error")).toBe(true);
});

test("authoring.pack: bundles the entry into one file and the packed folder installs and replaces", async () => {
  const dir = await scaffolded("p-group");
  const packed = await packExtension({ dir });
  if (!packed.ok) throw new Error(packed.error.message);
  expect(packed.value.path).toBe(join(dir, "dist", "package"));
  expect(packed.value.files).toEqual([".fresnel-plugin/plugin.json", "README.md", "dist/index.js"]);
  expect(packed.value.sha256).toMatch(/^[0-9a-f]{64}$/);
  const manifest = readManifest(packed.value.path);
  expect(manifest.entry).toBe("./dist/index.js");
  // 한 파일: 상대 import가 남지 않고, SDK는 외부 import로 남는다
  const bundle = readFileSync(join(packed.value.path, "dist", "index.js"), "utf8");
  expect(bundle).not.toMatch(/from\s*["']\.{1,2}\//);
  expect(bundle).toContain("@fresnel/group-sdk");
  // 같은 입력은 같은 해시
  const again = await packExtension({ dir });
  if (!again.ok) throw new Error(again.error.message);
  expect(again.value.sha256).toBe(packed.value.sha256);

  const extensions = root.path("extensions");
  const first = await installExtension(
    { source: packed.value.path },
    { extensionsDir: extensions },
  );
  expect(first).toEqual({
    ok: true,
    value: {
      name: "p-group",
      version: "0.1.0",
      location: join(extensions, "p-group"),
      replaced: false,
    },
  });
  expect(readdirSync(extensions)).toEqual(["p-group"]);
  const second = await installExtension(
    { source: packed.value.path },
    { extensionsDir: extensions },
  );
  expect(second.ok && second.value.replaced).toBe(true);
  const removed = await removeExtension("p-group", { extensionsDir: extensions });
  expect(removed).toEqual({ ok: true, value: { location: join(extensions, "p-group") } });
  expect(existsSync(join(extensions, "p-group"))).toBe(false);
  expect(await removeExtension("p-group", { extensionsDir: extensions })).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
  expect(await removeExtension("../escape", { extensionsDir: extensions })).toMatchObject({
    ok: false,
    error: { kind: "invalid_input" },
  });
});

test("authoring.pack: refuses invalid input, leaves secret-looking files out and keeps an unbundled source out of install", async () => {
  const bad = await scaffolded("p-bad");
  editManifest(bad, (manifest) => {
    manifest["trust"] = { level: "builtin" };
  });
  const refused = await packExtension({ dir: bad });
  expect(refused).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "validation failed: AU-002" },
  });

  const dir = await scaffolded("p-secret", "single-plugin");
  writeFileSync(join(dir, ".env"), "TOKEN=x\n");
  writeFileSync(join(dir, "server.pem"), "x\n");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "a.txt"), "a\n");
  const packed = await packExtension({ dir, out: root.path("p-secret-out") });
  if (!packed.ok) throw new Error(packed.error.message);
  expect(packed.value.files).toEqual([
    ".fresnel-plugin/plugin.json",
    "README.md",
    "assets/a.txt",
    "dist/index.js",
  ]);
  const occupied = await packExtension({ dir, out: root.path("p-secret-out") });
  expect(occupied.ok).toBe(false);

  const source = await installExtension({ source: dir }, { extensionsDir: root.path("ext2") });
  expect(source).toEqual({
    ok: false,
    error: {
      kind: "invalid_input",
      message: "entry must be a bundled single file (run ext.package first)",
    },
  });
  expect(looksSecret(".env.local")).toBe(true);
  expect(looksSecret("id_rsa")).toBe(true);
  expect(looksSecret("notes.txt")).toBe(false);
});

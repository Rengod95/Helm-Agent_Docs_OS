// 검토함으로 보내기 전의 검사(M5c §4.9). 설치 미리 보기(`previewInstall`)는 폐기됐다(M5c §7.7). 같은 검사가 남는 곳은
// `validateExtensionDir`다. 이 시험은 옛 미리 보기가 보던 사례(플러그인 파일 없음, 없는 폴더, 철자가 틀린 키)를 그 검사로 본다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { scaffoldExtension, validateExtensionDir } from "@fresnel/core-authoring";
import { SAMPLE_TEXT, tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();

async function scaffolded(name: string): Promise<string> {
  const dir = root.path(name);
  const made = await scaffoldExtension(
    { kind: "single-plugin", name, dir, ...SAMPLE_TEXT },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

test("submit-checks: a folder without the plugin file is no_manifest, a missing folder is not_found", async () => {
  const bare = root.path("sc-bare-folder");
  mkdirSync(bare, { recursive: true });
  expect(await validateExtensionDir(bare)).toMatchObject({
    ok: false,
    error: { kind: "no_manifest" },
  });
  expect(await validateExtensionDir(root.path("sc-gone-folder"))).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
});

test("submit-checks: a scaffolded plugin has no errors", async () => {
  const dir = await scaffolded("sc-clean");
  const checked = await validateExtensionDir(dir);
  expect(checked.ok && checked.value.ok).toBe(true);
});

test("submit-checks: a misspelt manifest key is a warning and the folder stays valid", async () => {
  const dir = await scaffolded("sc-misspelt");
  const path = join(dir, ".fresnel-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.descripton = "오타가 든 키";
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  const checked = await validateExtensionDir(dir);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.value.ok).toBe(true);
  const warnings = checked.value.issues.filter((issue) => issue.severity === "warning");
  expect(warnings.map((issue) => issue.path)).toContain("/descripton");
});

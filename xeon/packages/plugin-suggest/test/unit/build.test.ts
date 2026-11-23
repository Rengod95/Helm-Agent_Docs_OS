import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import { validateManifest } from "@fresnel/contracts/extensions";
import { buildSuggestPlugin } from "../../scripts/build-plugin.ts";

// 번들 산출물 시험. 임시 폴더에 빌드해 파일 목록, 외부 import 목록, 매니페스트 검증 결과를 값으로 비교한다.
// 실제 사용자 홈과 키체인은 건드리지 않는다.

const root = await mkdtemp(join(tmpdir(), "suggest-plugin-build-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the build writes the manifest, the entry bundle, the view tree and the locales", async () => {
  const outDir = join(root, "suggest");
  const built = await buildSuggestPlugin(outDir);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.value.externals).toEqual([
    "@fresnel/contracts",
    "@fresnel/contracts/capabilities",
    "@fresnel/contracts/extensions",
    "@fresnel/contracts/wire",
    "@fresnel/orchestration-sdk",
    "typebox",
  ]);

  const manifestJson = parseJson(
    await readFile(join(outDir, ".fresnel-plugin", "plugin.json"), "utf8"),
  );
  expect(manifestJson.ok).toBe(true);
  const validated = validateManifest(manifestJson.ok ? manifestJson.value : undefined);
  expect(validated.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(validated.manifest?.entry).toBe("./dist/index.js");
  expect(validated.manifest?.methods?.map((decl) => decl.verb)).toEqual(["list", "count"]);

  const entry = await readFile(join(outDir, "dist", "index.js"), "utf8");
  expect(entry).toContain('from "@fresnel/orchestration-sdk"');
  expect(entry).not.toContain("@fresnel/ext-host");

  const view = parseJson(await readFile(join(outDir, "ui", "suggest.view.json"), "utf8"));
  expect(view).toMatchObject({ ok: true, value: { type: "Stack" } });
  const ko = parseJson(await readFile(join(outDir, "locales", "ko.json"), "utf8"));
  const en = parseJson(await readFile(join(outDir, "locales", "en.json"), "utf8"));
  expect(ko).toMatchObject({
    ok: true,
    value: { "suggest.page.title": "제안", "suggest.page.intro": expect.any(String) },
  });
  expect(en).toMatchObject({
    ok: true,
    value: { "suggest.page.title": "Suggestions", "suggest.page.intro": expect.any(String) },
  });
});

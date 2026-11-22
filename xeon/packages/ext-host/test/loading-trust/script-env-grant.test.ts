import { expect, test } from "bun:test";
import type { ExtensionCandidate } from "../../src/loading-trust/discover.ts";
import { scriptEnvGrantOf } from "../../src/loading-trust/discover.ts";

// AGE-58 [제안]: 환경 모드를 받을 자격은 호스트가 검토본 기록에서 채운 `importedScripts`뿐이다. 매니페스트나 다른 후보 모양은 자격을 만들지 못한다.

const BASE: ExtensionCandidate = {
  source: "user",
  root: "/store/reviewed/x/tree",
  manifestPath: "/store/reviewed/x/tree/.fresnel-plugin/plugin.json",
  builtin: null,
  contentHash: `sha256:${"a".repeat(64)}`,
};

test("a reviewed candidate marked as imported gets a grant without a folder; its project source is carried", () => {
  expect(scriptEnvGrantOf({ ...BASE, importedScripts: true })).toEqual({
    granted: true,
    projectDir: null,
    fromProject: false,
  });
  expect(scriptEnvGrantOf({ ...BASE, source: "project", importedScripts: true })).toEqual({
    granted: true,
    projectDir: null,
    fromProject: true,
  });
});

test("no mark, a false mark, a draft, a built-in and a plain folder candidate get no grant", () => {
  expect(scriptEnvGrantOf(BASE)).toBeUndefined();
  expect(scriptEnvGrantOf({ ...BASE, importedScripts: false })).toBeUndefined();
  expect(
    scriptEnvGrantOf({
      ...BASE,
      importedScripts: true,
      draft: {
        plugin: "notes",
        draftId: "d1",
        internalName: "notes-d1",
        contentHash: BASE.contentHash ?? "",
      },
    }),
  ).toBeUndefined();
  expect(
    scriptEnvGrantOf({ ...BASE, source: "builtin", root: null, manifestPath: null }),
  ).toBeUndefined();
  expect(scriptEnvGrantOf({ ...BASE, contentHash: null })).toBeUndefined();
});

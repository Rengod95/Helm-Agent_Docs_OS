// 가져온 Hook 플러그인의 출처 범위(enFp [제안]): 엔진이 훑기가 읽은 설정 파일의 자리에서 정한다. 매니페스트에는 싣지 않는다.
import { expect, test } from "bun:test";
import { emit, type PlannedPluginWithMigration } from "../src/index.ts";
import { HOME, PROJECT_ROOT, USER_ROOT, proposeFrom, projectFiles } from "./hook-support.ts";

const SETTINGS = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo ok" }] }] } };

function hookPluginsOf(proposal: Awaited<ReturnType<typeof proposeFrom>>["proposal"]) {
  return proposal.plugins.filter((plugin) => plugin.runtime !== undefined);
}

test("a hook from the user settings is planned with the user origin and no label", async () => {
  const { proposal } = await proposeFrom({
    [`${HOME}/.claude/settings.json`]: JSON.stringify(SETTINGS),
  });
  const plugins = hookPluginsOf(proposal);
  expect(plugins.map((plugin) => plugin.hookOrigin)).toEqual([{ kind: "user", label: null }]);
});

test("a hook from the project settings is planned with the project origin and the project folder as a human label", async () => {
  const { proposal } = await proposeFrom(projectFiles(SETTINGS), [PROJECT_ROOT]);
  const plugins = hookPluginsOf(proposal);
  expect(plugins.map((plugin) => plugin.hookOrigin)).toEqual([
    { kind: "project", label: "~/work/app" },
  ]);
});

test("a hook from the project's local settings is also project origin", async () => {
  const { proposal } = await proposeFrom(
    { [`${PROJECT_ROOT.path}/.claude/settings.local.json`]: JSON.stringify(SETTINGS) },
    [PROJECT_ROOT],
  );
  expect(hookPluginsOf(proposal).map((plugin) => plugin.hookOrigin)).toEqual([
    { kind: "project", label: "~/work/app" },
  ]);
});

test("user and project hooks of one scan become separate plugins, each with its own origin", async () => {
  const { proposal } = await proposeFrom(
    {
      ...projectFiles(SETTINGS),
      [`${HOME}/.claude/settings.json`]: JSON.stringify(SETTINGS),
    },
    [USER_ROOT, PROJECT_ROOT],
  );
  const kinds = hookPluginsOf(proposal).map((plugin) => plugin.hookOrigin?.kind);
  expect(kinds.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["project", "user"]);
});

test("the origin never reaches the emitted manifest", async () => {
  const { proposal } = await proposeFrom(projectFiles(SETTINGS), [PROJECT_ROOT]);
  const plugin = hookPluginsOf(proposal)[0];
  if (plugin === undefined) throw new Error("a hook plugin is expected");
  if (plugin.hookOrigin === undefined) throw new Error("the plan must carry the origin");
  const planned: PlannedPluginWithMigration = {
    ...plugin,
    migration: { rulesVersions: {}, sources: [], report: [] },
  };
  const files = emit(planned);
  const manifest = new TextDecoder().decode(files.get(".fresnel-plugin/plugin.json"));
  expect(manifest.includes('"origin"')).toBe(false);
  expect(manifest.includes("~/work/app")).toBe(false);
});

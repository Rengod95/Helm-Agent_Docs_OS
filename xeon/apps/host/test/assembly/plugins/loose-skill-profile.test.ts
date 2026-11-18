import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parseJson, type Logger, type Result } from "@fresnel/contracts";
import { pluginFactOf, type PluginFact } from "../../../src/assembly/m4/plugin-fact.ts";
import {
  addMigratedSkillsToCommon,
  createPluginStore,
  reviewStartupPlugins,
  type PluginStore,
} from "../../../src/assembly/plugins/index.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §7.5, 사용자 결정 2026-11-18(AGE-41): 느슨한 스킬 폴더에서 옮긴 플러그인은 공통 묶음(모든 프로필에 드는 묶음)에 한 번 들어간다.
// 옮김 기록(`migration.log`)의 `loose_skill_profile` 줄이 그 한 번을 지킨다. 사용자가 공통 묶음에서 뺀 뒤 다음 시작에는 다시 넣지 않는다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

const NOW = "2026-11-18T02:00:00.000Z";
const SKILL = "good-skill";

interface Rig {
  readonly root: string;
  readonly store: PluginStore;
  readonly logPath: string;
  readonly looseDir: string;
}

function rigOf(): Rig {
  const root = tempRoot("plugin-loose-profile-");
  roots.push(root);
  return {
    root,
    store: createPluginStore({ root: join(root, "plugin-store"), fileLock: passThroughFileLock }),
    logPath: join(root, "state", "migration.log"),
    looseDir: join(root, "data", "skills"),
  };
}

/** 느슨한 스킬 폴더를 한 번 옮긴다. 옮김 결과는 `migration.log`에 적힌다 */
async function migrateSkill(rig: Rig): Promise<void> {
  await reviewStartupPlugins({
    store: rig.store,
    bundleDir: join(rig.root, "bundle"),
    bundledNames: [],
    installedDir: join(rig.root, "config", "extensions"),
    userPluginsDir: join(rig.root, "config", "plugins"),
    looseSkillsDir: rig.looseDir,
    migrationLogPath: rig.logPath,
    logger: SILENT,
    now: () => NOW,
  });
}

function writeSkill(rig: Rig): void {
  writeFiles(join(rig.looseDir, SKILL), {
    "SKILL.md": "---\nname: good-skill\ndescription: Writes good notes\n---\nBody\n",
  });
}

/** 로더가 실은 플러그인의 사실. 이름만 본다 */
function factOf(name: string): PluginFact {
  return pluginFactOf(
    { schemaVersion: 2, name, version: "0.0.0", plugins: [{ layer: "plugin", hooks: [] }] },
    "/unused",
  );
}

/** 공통 묶음을 흉내 낸다: 플러그인 이름 목록과 넣기 호출 기록 */
function commonSet(initial: readonly string[]) {
  const state: { names: string[]; added: string[]; failNext: boolean } = {
    names: [...initial],
    added: [],
    failNext: false,
  };
  return {
    state,
    commonNames: (): Promise<Result<readonly string[], { readonly kind: string }>> =>
      Promise.resolve(ok([...state.names])),
    addToCommon: (fact: PluginFact): Promise<Result<unknown, { readonly kind: string }>> => {
      if (state.failNext) {
        state.failNext = false;
        return Promise.resolve(err({ kind: "plugin_invalid" }));
      }
      state.added.push(fact.name);
      state.names.push(fact.name);
      return Promise.resolve(ok(undefined));
    },
  };
}

/** `migration.log`의 줄마다 값을 준다. 파일이 없으면 빈 목록이다 */
function logLinesOf(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const json = parseJson(line);
      return json.ok ? json.value : line;
    });
}

/** 줄의 `step` 칸만 모은다 */
function stepsOf(path: string): unknown[] {
  return logLinesOf(path).map((line) =>
    typeof line === "object" && line !== null && "step" in line ? line.step : null,
  );
}

/** 옮김 줄의 내용 해시: 이 시험이 쓰는 값은 옮김 기록에 적힌 그대로다 */
function migratedHashOf(path: string): unknown {
  const line = logLinesOf(path).find(
    (item) =>
      typeof item === "object" && item !== null && "step" in item && item.step === "loose_skill",
  );
  return typeof line === "object" && line !== null && "contentHash" in line
    ? line.contentHash
    : null;
}

test("a migrated loose skill joins the common set once, and a second start adds nothing", async () => {
  const rig = rigOf();
  writeSkill(rig);
  await migrateSkill(rig);
  const common = commonSet(["helm"]);
  const deps = {
    logPath: rig.logPath,
    logger: SILENT,
    now: () => NOW,
    commonNames: common.commonNames,
    factOf,
    addToCommon: common.addToCommon,
  };

  expect(await addMigratedSkillsToCommon(deps)).toEqual([SKILL]);
  expect(common.state.added).toEqual([SKILL]);
  expect(common.state.names).toEqual(["helm", SKILL]);
  // 이 단계의 줄은 옮김 기록의 내용 해시를 그대로 싣는다
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill", "loose_skill_profile"]);
  expect(logLinesOf(rig.logPath)[1]).toEqual({
    at: NOW,
    step: "loose_skill_profile",
    name: SKILL,
    outcome: "migrated",
    contentHash: migratedHashOf(rig.logPath),
    reason: null,
  });

  expect(await addMigratedSkillsToCommon(deps)).toEqual([]);
  expect(common.state.added).toEqual([SKILL]);
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill", "loose_skill_profile"]);
});

test("a skill the user removed from the common set after the first add is not added again", async () => {
  const rig = rigOf();
  writeSkill(rig);
  await migrateSkill(rig);
  const common = commonSet(["helm"]);
  const deps = {
    logPath: rig.logPath,
    logger: SILENT,
    now: () => NOW,
    commonNames: common.commonNames,
    factOf,
    addToCommon: common.addToCommon,
  };
  await addMigratedSkillsToCommon(deps);
  common.state.names = common.state.names.filter((name) => name !== SKILL);

  expect(await addMigratedSkillsToCommon(deps)).toEqual([]);
  expect(common.state.added).toEqual([SKILL]);
  expect(common.state.names).toEqual(["helm"]);
});

test("a skill the common set already has is recorded without a write", async () => {
  const rig = rigOf();
  writeSkill(rig);
  await migrateSkill(rig);
  // 공통 묶음에 이미 든 이름이다. 넣지 않고 줄만 적는다
  const common = commonSet(["helm", SKILL]);

  expect(
    await addMigratedSkillsToCommon({
      logPath: rig.logPath,
      logger: SILENT,
      now: () => NOW,
      commonNames: common.commonNames,
      factOf,
      addToCommon: common.addToCommon,
    }),
  ).toEqual([SKILL]);
  expect(common.state.added).toEqual([]);
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill", "loose_skill_profile"]);
});

test("a failed write and a plugin the loader has not loaded yet are not recorded, so the next start tries again", async () => {
  const rig = rigOf();
  writeSkill(rig);
  await migrateSkill(rig);
  const common = commonSet(["helm"]);
  common.state.failNext = true;
  const deps = {
    logPath: rig.logPath,
    logger: SILENT,
    now: () => NOW,
    commonNames: common.commonNames,
    factOf,
    addToCommon: common.addToCommon,
  };

  expect(await addMigratedSkillsToCommon(deps)).toEqual([]);
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill"]);
  expect(await addMigratedSkillsToCommon({ ...deps, factOf: () => undefined })).toEqual([]);
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill"]);

  expect(await addMigratedSkillsToCommon(deps)).toEqual([SKILL]);
  expect(common.state.names).toEqual(["helm", SKILL]);
  expect(stepsOf(rig.logPath)).toEqual(["loose_skill", "loose_skill_profile"]);
});

test("with no migration log nothing is added and no line is written", async () => {
  const rig = rigOf();
  const common = commonSet(["helm"]);

  expect(
    await addMigratedSkillsToCommon({
      logPath: rig.logPath,
      logger: SILENT,
      now: () => NOW,
      commonNames: common.commonNames,
      factOf,
      addToCommon: common.addToCommon,
    }),
  ).toEqual([]);
  expect(common.state.added).toEqual([]);
  expect(existsSync(rig.logPath)).toBe(false);
});

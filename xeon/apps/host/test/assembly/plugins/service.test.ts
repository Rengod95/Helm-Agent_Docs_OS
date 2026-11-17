import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import { validateManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import type { PluginListFilter, Profile, ProfileListResult } from "@fresnel/contracts/wire";
import type { ProfilePortFailure } from "../../../src/handlers/m4/profile-test-run.ts";
import {
  createPluginService,
  type PluginRecordSource,
  type PluginService,
} from "../../../src/assembly/plugins/service.ts";
import { createPluginStore, type PluginStoreReader } from "../../../src/assembly/plugins/index.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §3.4 `plugin.list`, `plugin.get`, §4.5: 원본 폴더와 로드된 레코드에서 카드를 만들고, 사용처와 필터를 계산하고, 캐시를 `scan`으로 바꾼다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

interface LogLine {
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

interface Harness {
  readonly configDir: string;
  readonly service: PluginService;
  readonly logged: LogLine[];
}

interface HarnessOptions {
  /** 상대 경로 → 내용. `configDir` 아래에 쓴다 */
  readonly files?: Readonly<Record<string, string>>;
  readonly records?: readonly PluginRecordSource[];
  readonly profiles?: Result<ProfileListResult, ProfilePortFailure>;
  /** 검토본 저장소. 없으면 `configDir` 아래의 빈 실제 저장소다 */
  readonly store?: PluginStoreReader;
}

const EMPTY_LIST: ProfileListResult = {
  profiles: [],
  common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
  rev: 1,
};

function harnessOf(options: HarnessOptions = {}): Harness {
  const configDir = tempRoot("plugin-service-");
  roots.push(configDir);
  writeFiles(configDir, options.files ?? {});
  const logged: LogLine[] = [];
  const profiles = options.profiles ?? ok(EMPTY_LIST);
  const store =
    options.store ??
    createPluginStore({ root: join(configDir, "plugin-store"), fileLock: passThroughFileLock });
  const service = createPluginService({
    configDir,
    projectRoots: () => [],
    managedDir: null,
    bundleDir: null,
    records: () => options.records ?? [],
    profiles: { list: () => Promise.resolve(profiles) },
    store,
    log: {
      info: (message, fields) => {
        logged.push({ message, fields });
      },
    },
  });
  return { configDir, service, logged };
}

function manifestOf(input: unknown): ExtensionManifest {
  const checked = validateManifest(input);
  if (checked.manifest === undefined) {
    throw new Error(`manifest invalid: ${checked.issues.map((issue) => issue.code).join(",")}`);
  }
  return checked.manifest;
}

function profileOf(id: string, plugins: readonly string[]): Profile {
  return {
    id,
    title: id,
    builtin: false,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-18T00:00:00.000Z",
    rev: 1,
  };
}

function listedOf(profiles: readonly Profile[], common: readonly string[]): ProfileListResult {
  return {
    profiles,
    common: {
      plugins: common.map((name) => ({ name })),
      settings: [],
      updatedAt: "2026-11-18T00:00:00.000Z",
      rev: 1,
    },
    rev: 1,
  };
}

async function namesOf(service: PluginService, filter: PluginListFilter = {}): Promise<string[]> {
  const listed = await service.list(filter);
  if (!listed.ok) throw new Error(`list failed: ${listed.error.kind}`);
  return listed.value.plugins.map((card) => card.name);
}

const SKILL = `---\nname: greeter\ndescription: "Say hello politely"\n---\nBody\n`;

test("SKILL.md만 든 폴더는 스킬 한 칸, 검토 대기, 사용자 출처의 카드다", async () => {
  const { configDir, service } = harnessOf({ files: { "plugins/greeter/SKILL.md": SKILL } });
  const listed = await service.list({});
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.value.plugins).toHaveLength(1);
  const card = listed.value.plugins[0];
  expect(card?.name).toBe("greeter");
  expect(card?.purpose).toBe("Say hello politely");
  expect(card?.origin).toEqual({ kind: "user" });
  expect(card?.review).toEqual({
    state: "none",
    currentHash: null,
    pendingItemId: null,
    approvedAt: null,
  });
  expect(card?.does.inject?.instructions.skills).toEqual([
    { name: "greeter", path: "SKILL.md", descriptionChars: 18 },
  ]);

  const got = await service.get("greeter");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.source).toEqual({
    path: join(configDir, "plugins", "greeter"),
    matchesReviewed: false,
  });
  expect(got.value.versions).toEqual([]);
  expect(got.value.entries).toEqual([]);
  expect(got.value.settingsDefs).toEqual([]);
});

test("instructions.md만 든 폴더는 항상 싣는 지침 한 칸이고 목적이 없다", async () => {
  const { service } = harnessOf({
    files: { "plugins/house-rules/instructions.md": "Always be brief." },
  });
  const got = await service.get("house-rules");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.card.purpose).toBeNull();
  expect(got.value.card.does.inject?.instructions.always).toEqual([
    { path: "instructions.md", bytes: 16 },
  ]);
  expect(got.value.card.runs).toEqual({ code: false, isolated: null });
});

test("매니페스트와 드라이브 선언이 있는 코드 폴더는 격리와 강제력을 선언대로 카드에 적는다", async () => {
  const { service } = harnessOf({
    files: {
      "plugins/driver-kit/.fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "driver-kit",
        version: "1.0.0",
        purpose: "Drives the flow",
        entry: "./plugin.ts",
        plugins: [{ layer: "plugin", hooks: ["input.user.before"], drives: true }],
      }),
      "plugins/driver-kit/plugin.ts": "export {};",
    },
  });
  const got = await service.get("driver-kit");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.card.purpose).toBe("Drives the flow");
  expect(got.value.card.runs).toEqual({ code: true, isolated: true });
  expect(got.value.card.does.drive).toEqual({ start: true, commands: [] });
  expect(got.value.card.enforcement).toBe("enforced");
});

test("같은 이름이 두 위치에 있으면 먼저 발견된 것만 카드가 되고 name_conflict가 진단과 로그에 남는다", async () => {
  const { service, logged } = harnessOf({
    files: {
      "plugins/dup/SKILL.md": SKILL,
      "extensions/dup/SKILL.md": SKILL,
    },
  });
  const names = await namesOf(service);
  expect(names).toEqual(["dup"]);
  const diagnostics = await service.diagnostics();
  if (!diagnostics.ok) throw new Error(`diagnostics failed: ${diagnostics.error.kind}`);
  const conflicts = diagnostics.value.filter((item) => item.code === "name_conflict");
  expect(conflicts).toHaveLength(1);
  expect(logged.some((line) => line.fields["code"] === "name_conflict")).toBe(true);
});

test("로드된 내장 레코드는 매니페스트만으로 카드가 되고 검토 상태가 approved다", async () => {
  const manifest = manifestOf({
    schemaVersion: 2,
    name: "core-tasks",
    version: "1.0.0",
    purpose: "Keeps the task list",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
  const { service } = harnessOf({
    records: [{ manifest, origin: "builtin", location: "builtin" }],
  });
  const got = await service.get("core-tasks");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.card.origin).toEqual({ kind: "builtin" });
  expect(got.value.card.review.state).toBe("approved");
  expect(got.value.card.runs).toEqual({ code: false, isolated: null });
  expect(got.value.source).toBeNull();
});

test("폴더 원본이 없는 레코드는 매니페스트 카드가 되고, 폴더 원본이 있는 이름은 원본이 카드다", async () => {
  const folderBacked = manifestOf({
    schemaVersion: 2,
    name: "greeter",
    version: "1.0.0",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
  const manifestOnly = manifestOf({
    schemaVersion: 2,
    name: "loaded-only",
    version: "1.0.0",
    purpose: "Loaded without a folder",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
  const { service } = harnessOf({
    files: { "plugins/greeter/SKILL.md": SKILL },
    records: [
      { manifest: folderBacked, origin: "user", location: "/x/greeter" },
      { manifest: manifestOnly, origin: "user", location: "/x/loaded-only" },
    ],
  });
  const listed = await service.list({});
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.value.plugins.map((card) => card.name)).toEqual(["greeter", "loaded-only"]);
  const greeter = listed.value.plugins[0];
  expect(greeter?.purpose).toBe("Say hello politely");
  expect(greeter?.does.inject?.instructions.skills).toHaveLength(1);
  const loaded = listed.value.plugins[1];
  expect(loaded?.purpose).toBe("Loaded without a folder");
  expect(loaded?.does.inject).toBeNull();
});

test("usedBy는 프로필의 plugins와 공통 묶음(common)에서 읽을 때 계산한다", async () => {
  const profiles = listedOf(
    [profileOf("work", ["greeter"]), profileOf("play", ["rules"])],
    ["rules"],
  );
  const { service } = harnessOf({
    files: { "plugins/greeter/SKILL.md": SKILL, "plugins/rules/instructions.md": "Rules." },
    profiles: ok(profiles),
  });
  const greeter = await service.get("greeter");
  const rules = await service.get("rules");
  expect(greeter.ok && greeter.value.card.usedBy).toEqual(["work"]);
  expect(rules.ok && rules.value.card.usedBy).toEqual(["play", "common"]);
});

test("목록 필터: profileId는 그 프로필과 공통 묶음에 든 것을, origin과 reviewState는 값이 같은 것만 보인다. 결과는 이름 순이다", async () => {
  const builtin = manifestOf({
    schemaVersion: 2,
    name: "core-tasks",
    version: "1.0.0",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
  const profiles = listedOf(
    [profileOf("work", ["greeter"]), profileOf("play", ["notes"])],
    ["rules"],
  );
  const { service } = harnessOf({
    files: {
      "plugins/greeter/SKILL.md": SKILL,
      "plugins/notes/SKILL.md": SKILL.replace("greeter", "notes"),
      "plugins/rules/instructions.md": "Rules.",
    },
    records: [{ manifest: builtin, origin: "builtin", location: "builtin" }],
    profiles: ok(profiles),
  });
  expect(await namesOf(service)).toEqual(["core-tasks", "greeter", "notes", "rules"]);
  expect(await namesOf(service, { profileId: "work" })).toEqual(["greeter", "rules"]);
  expect(await namesOf(service, { origin: "builtin" })).toEqual(["core-tasks"]);
  expect(await namesOf(service, { reviewState: "approved" })).toEqual(["core-tasks"]);
  expect(await namesOf(service, { origin: "user", reviewState: "none" })).toEqual([
    "greeter",
    "notes",
    "rules",
  ]);
});

test("없는 이름의 get은 unknown_plugin이다", async () => {
  const { service } = harnessOf();
  const got = await service.get("missing");
  expect(got).toEqual({ ok: false, error: { kind: "unknown_plugin", name: "missing" } });
});

test("프로필 목록을 읽지 못하면 list와 get은 그 실패를 그대로 준다", async () => {
  const { service } = harnessOf({
    files: { "plugins/greeter/SKILL.md": SKILL },
    profiles: err({ kind: "corrupt", path: "profiles.json", reason: "not json" }),
  });
  const listed = await service.list({});
  expect(listed.ok).toBe(false);
  if (listed.ok) return;
  expect(listed.error).toEqual({
    kind: "profiles",
    failure: { kind: "corrupt", path: "profiles.json", reason: "not json" },
  });
  const got = await service.get("greeter");
  expect(got.ok).toBe(false);
});

test("캐시는 scan()을 부를 때만 바뀐다. 처음 읽을 때 한 번 훑는다", async () => {
  const { configDir, service } = harnessOf({ files: { "plugins/greeter/SKILL.md": SKILL } });
  expect(await namesOf(service)).toEqual(["greeter"]);
  writeFiles(configDir, { "plugins/notes/SKILL.md": SKILL.replace("greeter", "notes") });
  expect(await namesOf(service)).toEqual(["greeter"]);
  expect((await service.scan()).ok).toBe(true);
  expect(await namesOf(service)).toEqual(["greeter", "notes"]);
});

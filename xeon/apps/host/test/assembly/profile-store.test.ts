import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { FileLock } from "@fresnel/platform-os";
import type { ProfilesChange } from "../../src/assembly/m4/profile-store.ts";
import { createProfileStore } from "../../src/assembly/m4/profile-store.ts";
import {
  migrateV1,
  type LegacyInputs,
  type V1Profile,
  type V1ProfilesFile,
} from "../../src/assembly/m4/profile-migrate.ts";

// M5c §3.2, §7.2·§7.3. 옮김은 v1 값을 v2 값으로 비교한다(파일 모양만 보지 않는다). 저장소 시험은 실제 임시 파일을 쓴다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-profile-store-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NOW = "2026-01-05T00:00:00.000Z";
const CLOCK_MS = Date.parse(NOW);

const LEGACY: LegacyInputs = {
  userEnabled: new Map([
    ["helm", true],
    ["account-rotation", false],
  ]),
  defaultEnabled: ["helm"],
  permissionMode: undefined,
  profileAllows: (key) => key !== "l1.tools.bypassAllowed",
};

const REVIEW_V1: V1Profile = {
  id: "review",
  title: "Review",
  enable: ["demo"],
  disable: ["helm"],
  settings: [
    { key: "l1.loop.maxSteps", value: 5 },
    { key: "ext.demo.enabled", value: true },
    { key: "l1.tools.bypassAllowed", value: true },
  ],
  driver: "demo",
  updatedAt: "2025-12-01T00:00:00.000Z",
  rev: 4,
};

const V1: V1ProfilesFile = { schemaVersion: 1, profiles: [REVIEW_V1] };

// 파일 잠금 대역: 잠금은 항상 얻는다(한 프로세스 시험)
const fileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};

function storeAt(dir: string, legacy: LegacyInputs = LEGACY) {
  return createProfileStore({
    path: join(dir, "profiles.json"),
    migrationLogPath: join(dir, "state", "migration.log"),
    fileLock,
    clock: { now: () => CLOCK_MS },
    signal: new AbortController().signal,
    legacy: () => legacy,
  });
}

test("migrateV1 turns the v1 values into the v2 values: default from the user switches, the review profile from the lists", () => {
  const migrated = migrateV1(V1, LEGACY, NOW);
  expect(migrated.file).toEqual({
    schemaVersion: 2,
    common: { plugins: [], settings: [], updatedAt: NOW, rev: 0 },
    profiles: [
      {
        id: "default",
        title: "default",
        builtin: true,
        plugins: [{ name: "helm" }],
        settings: [{ key: "l1.tools.permissionMode", value: "bypass" }],
        startDrive: null,
        updatedAt: NOW,
        rev: 1,
      },
      {
        id: "review",
        title: "Review",
        builtin: false,
        // default.plugins(helm) ∪ enable(demo) − disable(helm) = demo, 시작 Drive demo는 목록에 이미 있다
        plugins: [{ name: "demo" }],
        settings: [{ key: "l1.loop.maxSteps", value: 5 }],
        startDrive: "demo",
        updatedAt: NOW,
        rev: 4,
      },
    ],
  });
  expect(migrated.log).toEqual([
    { profileId: "default", plugins: 1, rejected: [], droppedEnabledKeys: 0 },
    {
      profileId: "review",
      plugins: 1,
      rejected: ["l1.tools.bypassAllowed"],
      droppedEnabledKeys: 1,
    },
  ]);
});

test("migrateV1 keeps the user's permission mode for default and skips a v1 profile that uses the built-in id", () => {
  const withMode = migrateV1(
    { schemaVersion: 1, profiles: [{ ...REVIEW_V1, id: "default" }] },
    { ...LEGACY, permissionMode: "ask" },
    NOW,
  );
  expect(withMode.file.profiles.map((profile) => profile.id)).toEqual(["default"]);
  expect(withMode.file.profiles[0]?.settings).toEqual([
    { key: "l1.tools.permissionMode", value: "ask" },
  ]);
  expect(withMode.log.at(-1)).toMatchObject({
    profileId: "default",
    skipped: "collides_with_builtin",
  });
});

test("a v1 file is moved on the first read: the backup holds the old text, the log has one line per profile, and the second read changes nothing", async () => {
  const dir = tempDir();
  const original = JSON.stringify(V1, null, 2);
  writeFileSync(join(dir, "profiles.json"), original);
  const store = storeAt(dir);

  const first = await store.read();
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.value.profiles.map((profile) => profile.id)).toEqual(["default", "review"]);
  expect(readFileSync(join(dir, "profiles.json.v1.bak"), "utf8")).toBe(original);
  expect(JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8"))).toMatchObject({
    schemaVersion: 2,
    common: { plugins: [], settings: [], rev: 0 },
  });
  const log = readFileSync(join(dir, "state", "migration.log"), "utf8")
    .trim()
    .split("\n");
  expect(log).toHaveLength(2);
  expect(JSON.parse(log[1] ?? "")).toMatchObject({
    from: 1,
    to: 2,
    profileId: "review",
    rejected: ["l1.tools.bypassAllowed"],
    droppedEnabledKeys: 1,
  });

  const second = await store.read();
  expect(second.ok).toBe(true);
  expect(
    readFileSync(join(dir, "state", "migration.log"), "utf8")
      .trim()
      .split("\n"),
  ).toHaveLength(2);
  expect(readFileSync(join(dir, "profiles.json.v1.bak"), "utf8")).toBe(original);
});

test("a file that is neither v1 nor v2 is corrupt and is left as it is", async () => {
  const dir = tempDir();
  const text = '{"schemaVersion":3,"profiles":"nope"}';
  writeFileSync(join(dir, "profiles.json"), text);
  const store = storeAt(dir);
  const read = await store.read();
  expect(read).toMatchObject({ ok: false, error: { kind: "corrupt" } });
  const changed = await store.transact(() =>
    ok({
      profiles: [],
      common: { plugins: [], settings: [], updatedAt: NOW, rev: 0 },
      value: undefined,
    }),
  );
  expect(changed).toMatchObject({ ok: false, error: { kind: "corrupt" } });
  expect(readFileSync(join(dir, "profiles.json"), "utf8")).toBe(text);
});

test("transact writes version 2, reports the changed ids and whether the common set changed, and bumps the list rev", async () => {
  const dir = tempDir();
  const store = storeAt(dir);
  const changes: ProfilesChange[] = [];
  store.onChange((change) => {
    changes.push(change);
  });
  expect((await store.read()).ok).toBe(true);
  const created = await store.transact((snapshot) =>
    ok({
      profiles: [
        ...snapshot.profiles,
        {
          id: "alpha",
          title: "A",
          builtin: false,
          plugins: [],
          settings: [],
          startDrive: null,
          updatedAt: NOW,
          rev: 1,
        },
      ],
      common: snapshot.common,
      value: "created",
    }),
  );
  // 파일이 없던 것을 처음 쓰면 개정이 1이다
  expect(created).toEqual(ok({ value: "created", rev: 1 }));
  expect(changes).toEqual([{ rev: 1, ids: ["alpha"], commonChanged: false }]);
  expect(JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8"))).toMatchObject({
    schemaVersion: 2,
    profiles: [{ id: "alpha", rev: 1 }],
  });
});

test("a change that returns a failure writes nothing and says nothing", async () => {
  const dir = tempDir();
  const store = storeAt(dir);
  const changes: ProfilesChange[] = [];
  store.onChange((change) => {
    changes.push(change);
  });
  const refused = await store.transact<undefined, { readonly kind: "refused" }>(() =>
    err({ kind: "refused" }),
  );
  expect(refused).toEqual({ ok: false, error: { kind: "refused" } });
  expect(existsSync(join(dir, "profiles.json"))).toBe(false);
  expect(changes).toEqual([]);
});

test("migrateFirstStart adds the migrated default row in front of the other profiles and keeps the common set, and does nothing once a default row is stored", async () => {
  const dir = tempDir();
  const alpha = {
    id: "alpha",
    title: "Alpha",
    builtin: false,
    plugins: [{ name: "demo" }],
    settings: [],
    startDrive: null,
    updatedAt: NOW,
    rev: 2,
  };
  const common = { plugins: [], settings: [], updatedAt: NOW, rev: 3 };
  writeFileSync(
    join(dir, "profiles.json"),
    JSON.stringify({ schemaVersion: 2, common, profiles: [alpha] }, null, 2),
  );
  const store = storeAt(dir);

  const added = await store.migrateFirstStart(LEGACY);
  expect(added).toEqual({ ok: true, value: "default_added" });
  const after = await store.read();
  expect(after.ok && after.value.profiles.map((profile) => profile.id)).toEqual([
    "default",
    "alpha",
  ]);
  expect(after.ok && after.value.common).toEqual(common);
  expect(after.ok && after.value.profiles[0]?.plugins).toEqual([{ name: "helm" }]);
  expect(
    readFileSync(join(dir, "state", "migration.log"), "utf8")
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line)),
  ).toMatchObject([{ step: "default_added", profileId: "default", plugins: 1 }]);

  const again = await store.migrateFirstStart(LEGACY);
  expect(again).toEqual({ ok: true, value: "unchanged" });
});

test("migrateFirstStart writes nothing when there are no user values and no profiles file", async () => {
  const dir = tempDir();
  const store = storeAt(dir, { ...LEGACY, userEnabled: new Map() });

  const outcome = await store.migrateFirstStart({ ...LEGACY, userEnabled: new Map() });

  expect(outcome).toEqual({ ok: true, value: "unchanged" });
  expect(existsSync(join(dir, "profiles.json"))).toBe(false);
});

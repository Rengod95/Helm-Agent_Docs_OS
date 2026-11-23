import { dependenciesOf, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { CommonSet, Profile, ProfileIssue, ProfilePlan } from "@fresnel/contracts/wire";
import {
  COMMON_ID,
  planPluginEdit,
  type PluginEditRequest,
} from "../../src/assembly/m4/plugin-edit.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import {
  validateProfile,
  type ProfileBody,
  type ProfileCatalog,
  type ProfileLibrary,
  type ProfileLibraryEntry,
  type ProfilePrevious,
} from "../../src/assembly/m4/profile-validate.ts";

// M5c §4.7.3: 승인의 프로필 반영 계산. 바뀌는 프로필과 공통 묶음을 새 값으로 만들고, 이름이 든 대상 프로필을 모두 검사한다.
// 검사 함수는 가짜다. 드라이버가 목록에 없으면 오류라는 한 가지 규칙만 둔다.

/** 시험용 최소 매니페스트. 의존과 구성원이 없다 */
function manifestStub(name: string): ExtensionManifest {
  return { schemaVersion: 2, name, version: "1.0.0" };
}

const NOW = "2026-11-18T00:00:00.000Z";
const FACT: PluginFact = {
  name: "kit",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("kit"),
  declared: { code: false, root: "", tools: [], instructions: [], skills: [] },
};

function profileOf(
  id: string,
  plugins: readonly string[],
  options: {
    readonly startDrive?: string | null;
    readonly settings?: readonly { readonly key: string; readonly value: unknown }[];
    readonly rev?: number;
  } = {},
): Profile {
  return {
    id,
    title: id,
    builtin: false,
    plugins: plugins.map((name) => ({ name })),
    settings: [...(options.settings ?? [])],
    startDrive: options.startDrive ?? null,
    updatedAt: "2026-11-01T00:00:00.000Z",
    rev: options.rev ?? 1,
  };
}

const COMMON: CommonSet = {
  plugins: [{ name: "helm" }],
  settings: [],
  updatedAt: "2026-11-01T00:00:00.000Z",
  rev: 1,
};

/** 드라이버가 목록에 없으면 오류다. 다른 검사는 없다 */
function driverCheck(body: ProfileBody): readonly ProfileIssue[] {
  if (body.startDrive === null || body.plugins.some((ref) => ref.name === body.startDrive))
    return [];
  return [{ code: "driver_not_in_list", severity: "error", plugin: body.startDrive }];
}

function planOf(
  request: PluginEditRequest,
  profiles: readonly Profile[],
  validate: (
    body: ProfileBody,
    common: CommonSet,
    previous: ProfilePrevious,
  ) => readonly ProfileIssue[] = driverCheck,
  common: CommonSet = COMMON,
) {
  return planPluginEdit({ profiles, common, request, validate, updatedAt: NOW });
}

test("add appends the plugin to the chosen profile only and bumps that profile's revision", () => {
  const profiles = [profileOf("p1", ["helm"]), profileOf("p2", ["helm"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["p1"] }, profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("add to a profile that already lists the plugin changes nothing", () => {
  const profiles = [profileOf("p1", ["helm", "kit"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["p1"] }, profiles)).toEqual(
    ok({ changed: [], common: null, missingPlugins: [] }),
  );
});

test("add to a profile that was deleted in the meantime answers profile_not_found and writes nothing", () => {
  const profiles = [profileOf("p1", ["helm"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["gone"] }, profiles)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [{ profile: "gone", code: "profile_not_found", severity: "error" }],
    }),
  );
});

test("a failing check in any target fails the whole edit and names that profile", () => {
  const profiles = [profileOf("p1", ["helm"]), profileOf("p2", ["helm"], { startDrive: "other" })];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["p1", "p2"] }, profiles)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [{ profile: "p2", code: "driver_not_in_list", severity: "error", plugin: "other" }],
    }),
  );
});

/** 어느 프로필이든 검사가 실패한다. 수정 승인이 이름이 든 프로필만 보는지 가린다 */
function alwaysFails(): readonly ProfileIssue[] {
  return [{ code: "plugin_not_reviewed", severity: "error", plugin: "kit" }];
}

/** 프로필이 목록을 비우면 제한 오류다. 공통 묶음도 같은 검사를 받는다 */
function limitOnEmpty(body: ProfileBody): readonly ProfileIssue[] {
  return body.plugins.length === 0 ? [{ code: "limit", severity: "error" }] : [];
}

test("keep changes no list and checks only the profiles that list the plugin", () => {
  const profiles = [profileOf("p1", ["kit"]), profileOf("p2", ["helm"])];
  expect(planOf({ kind: "keep", plugin: FACT }, profiles, alwaysFails)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [{ profile: "p1", code: "plugin_not_reviewed", severity: "error", plugin: "kit" }],
    }),
  );
  expect(planOf({ kind: "keep", plugin: FACT }, profiles)).toEqual(
    ok({ changed: [], common: null, missingPlugins: [] }),
  );
});

test("remove takes the plugin, its settings, and its driver role out of every profile and the common set", () => {
  const profiles = [
    profileOf("p1", ["helm", "kit"], {
      startDrive: "kit",
      settings: [
        { key: "ext.kit.token", value: "x" },
        { key: "l2.keep.value", value: 1 },
      ],
    }),
    profileOf("p2", ["kit"]),
    profileOf("p3", ["helm"]),
  ];
  const common: CommonSet = {
    plugins: [{ name: "helm" }, { name: "kit" }],
    settings: [{ key: "ext.kit.user", value: "y" }],
    updatedAt: "2026-11-01T00:00:00.000Z",
    rev: 1,
  };
  expect(planOf({ kind: "remove", plugin: "kit" }, profiles, driverCheck, common)).toEqual(
    ok({
      changed: [
        {
          ...profileOf("p1", ["helm"], { rev: 2, settings: [{ key: "l2.keep.value", value: 1 }] }),
          updatedAt: NOW,
        },
        { ...profileOf("p2", [], { rev: 2 }), updatedAt: NOW },
      ],
      common: { plugins: [{ name: "helm" }], settings: [], updatedAt: NOW, rev: 2 },
      missingPlugins: [],
    }),
  );
});

test("a remove that leaves a profile invalid is refused and names the profile, then the common set", () => {
  const profiles = [profileOf("p1", ["helm", "kit"]), profileOf("p2", ["kit"])];
  const common: CommonSet = { ...COMMON, plugins: [{ name: "kit" }] };
  expect(planOf({ kind: "remove", plugin: "kit" }, profiles, limitOnEmpty, common)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [
        { profile: "p2", code: "limit", severity: "error" },
        { profile: "common", code: "limit", severity: "error" },
      ],
    }),
  );
});

test("a factory default profile that is not stored yet is returned as a changed profile", () => {
  const profiles = [profileOf("default", ["helm"], { rev: 0 })];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["default"] }, profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("default", ["helm", "kit"], { rev: 1 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("add to the common id appends the plugin to the common set, bumps its revision, and changes no profile", () => {
  const profiles = [profileOf("p1", ["helm"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: [COMMON_ID] }, profiles)).toEqual(
    ok({
      changed: [],
      common: {
        plugins: [{ name: "helm" }, { name: "kit" }],
        settings: [],
        updatedAt: NOW,
        rev: 2,
      },
      missingPlugins: [],
    }),
  );
});

test("add to the common id when the common set already lists the plugin changes nothing", () => {
  const common: CommonSet = { ...COMMON, plugins: [{ name: "kit" }] };
  expect(
    planOf({ kind: "add", plugin: FACT, profileIds: [COMMON_ID] }, [], driverCheck, common),
  ).toEqual(ok({ changed: [], common: null, missingPlugins: [] }));
});

test("add to a profile and the common id at once changes both", () => {
  const profiles = [profileOf("p1", ["helm"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["p1", COMMON_ID] }, profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit"], { rev: 2 }), updatedAt: NOW }],
      common: {
        plugins: [{ name: "helm" }, { name: "kit" }],
        settings: [],
        updatedAt: NOW,
        rev: 2,
      },
      missingPlugins: [],
    }),
  );
});

test("an add to the common id that fails the common check is refused and names the common set, writing nothing", () => {
  expect(planOf({ kind: "add", plugin: FACT, profileIds: [COMMON_ID] }, [], alwaysFails)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [
        { profile: "common", code: "plugin_not_reviewed", severity: "error", plugin: "kit" },
      ],
    }),
  );
});

// AGE-72: 합치기·떼기 계획. 계획이 없으면 위의 맨 뒤 동작이 그대로다.

const DRIVER: PluginFact = { ...FACT, drives: true };

/** 대상 프로필에 계획을 건 `add` 요청. 빠진 칸은 "아무것도 하지 않음"이다 */
function planRequest(
  plugin: PluginFact,
  profileIds: readonly string[],
  plan: Partial<ProfilePlan> = {},
): PluginEditRequest {
  return {
    kind: "add",
    plugin,
    profileIds,
    plan: { swapOut: [], placeAfter: null, driveFrom: null, ...plan },
  };
}

test("a merge puts the new plugin where the earlier original stood and takes both originals out of each chosen profile", () => {
  const profiles = [
    profileOf("p1", ["helm", "a", "x", "b"]),
    profileOf("p2", ["helm", "a", "b"]),
    profileOf("p3", ["a", "b"]),
  ];
  expect(planOf(planRequest(FACT, ["p1", "p2"], { swapOut: ["a", "b"] }), profiles)).toEqual(
    ok({
      changed: [
        { ...profileOf("p1", ["helm", "kit", "x"], { rev: 2 }), updatedAt: NOW },
        { ...profileOf("p2", ["helm", "kit"], { rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("a profile that lists only one of the originals puts the new plugin in that one's place", () => {
  const profiles = [profileOf("p1", ["helm", "b", "y"])];
  expect(planOf(planRequest(FACT, ["p1"], { swapOut: ["a", "b"] }), profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit", "y"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("떼기: placeAfter puts the new plugin right after the bundle member, and a member the profile lacks means the end", () => {
  const profiles = [profileOf("p1", ["helm", "base", "other"]), profileOf("p2", ["helm", "other"])];
  expect(planOf(planRequest(FACT, ["p1"], { placeAfter: "base" }), profiles)).toEqual(
    ok({
      changed: [
        { ...profileOf("p1", ["helm", "base", "kit", "other"], { rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
  expect(planOf(planRequest(FACT, ["p2"], { placeAfter: "base" }), profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("p2", ["helm", "other", "kit"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("the start Drive moves to the new plugin when the swapped-out plugin drove, and is cleared when the new plugin cannot drive", () => {
  const profiles = [
    profileOf("p1", ["helm", "a"], { startDrive: "a" }),
    profileOf("p2", ["helm", "a"], { startDrive: "helm" }),
  ];
  expect(planOf(planRequest(DRIVER, ["p1"], { swapOut: ["a"] }), profiles)).toEqual(
    ok({
      changed: [
        { ...profileOf("p1", ["helm", "kit"], { startDrive: "kit", rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
  expect(planOf(planRequest(FACT, ["p1"], { swapOut: ["a"] }), profiles)).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
  // 시작 Drive가 `driveFrom`과 같으면 옮긴다. 다른 이름이면 그대로 둔다
  expect(
    planOf(planRequest(DRIVER, ["p2"], { swapOut: ["a"], driveFrom: "helm" }), profiles),
  ).toEqual(
    ok({
      changed: [
        { ...profileOf("p2", ["helm", "kit"], { startDrive: "kit", rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
  expect(
    planOf(planRequest(DRIVER, ["p1"], { swapOut: ["a"], driveFrom: "other" }), [
      profileOf("p1", ["helm", "a", "z"], { startDrive: "z" }),
    ]),
  ).toEqual(
    ok({
      changed: [
        { ...profileOf("p1", ["helm", "kit", "z"], { startDrive: "z", rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("the settings a swapped-out plugin owned leave with it, in the chosen profile only", () => {
  const owned = { key: "ext.a.port", value: 1 };
  const helmKey = { key: "ext.helm.key", value: 2 };
  const prefixOnly = { key: "ext.ab.x", value: 3 };
  const settings = [owned, helmKey, prefixOnly];
  const profiles = [
    profileOf("p1", ["helm", "a"], { settings }),
    profileOf("p2", ["helm", "a"], { settings }),
  ];
  expect(planOf(planRequest(FACT, ["p1"], { swapOut: ["a"] }), profiles)).toEqual(
    ok({
      changed: [
        {
          ...profileOf("p1", ["helm", "kit"], { settings: [helmKey, prefixOnly], rev: 2 }),
          updatedAt: NOW,
        },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("a new plugin that the profile already lists stays where it is and appears once", () => {
  const profiles = [profileOf("p1", ["helm", "kit", "a"]), profileOf("p2", ["kit", "helm", "a"])];
  expect(planOf(planRequest(FACT, ["p1", "p2"], { swapOut: ["a"] }), profiles)).toEqual(
    ok({
      changed: [
        { ...profileOf("p1", ["helm", "kit"], { rev: 2 }), updatedAt: NOW },
        { ...profileOf("p2", ["kit", "helm"], { rev: 2 }), updatedAt: NOW },
      ],
      common: null,
      missingPlugins: [],
    }),
  );
});

test("a plan that has nothing to take out and a new plugin already listed changes nothing", () => {
  const profiles = [profileOf("p1", ["helm", "kit"])];
  expect(planOf(planRequest(FACT, ["p1"], { swapOut: ["b"] }), profiles)).toEqual(
    ok({ changed: [], common: null, missingPlugins: [] }),
  );
});

test("the common set is never swapped by a plan, even when it lists an original", () => {
  const common: CommonSet = { ...COMMON, plugins: [{ name: "helm" }, { name: "a" }] };
  const profiles = [profileOf("p1", ["helm", "a"])];
  expect(
    planOf(planRequest(FACT, ["p1"], { swapOut: ["a"] }), profiles, driverCheck, common),
  ).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

/** 실제 검증기(`validateProfile`)를 라이브러리 몇 줄에 묶는다. 의존 거절을 검증 결과 그대로 본다 */
function realValidate(entries: readonly ProfileLibraryEntry[]) {
  const library: ProfileLibrary = {
    lookup: (name) => entries.find((entry) => entry.name === name),
  };
  const catalog: ProfileCatalog = {
    lookup: () => undefined,
    secretExists: () => false,
    managedDisabled: () => false,
    unavailable: () => false,
  };
  return (body: ProfileBody, common: CommonSet, previous: ProfilePrevious) =>
    validateProfile(body, common, library, catalog, previous);
}

function libraryEntry(
  name: string,
  dependencies: ProfileLibraryEntry["dependencies"] = [],
): ProfileLibraryEntry {
  return {
    name,
    reviewed: true,
    replaces: [],
    drives: false,
    unmet: false,
    requiredKeys: [],
    version: "1.0.0",
    dependencies,
    members: [],
  };
}

/** `app`이 `a`에 건 의존(종류는 인자). 매니페스트를 `dependenciesOf`로 읽은 결과와 같다 */
function appDependsOnA(kind: "hard" | "soft"): ProfileLibraryEntry["dependencies"] {
  return dependenciesOf({
    name: "app",
    plugins: [{ layer: "plugin", hooks: [], dependsOn: [{ plugin: "a", kind }] }],
  });
}

/** 라이브러리: 병합 대상 `a`, 새 플러그인 `kit`, 그리고 `a`에 기대는 `app`. `helm`은 공통 묶음의 것이다 */
function appLibrary(kind: "hard" | "soft"): readonly ProfileLibraryEntry[] {
  return [
    libraryEntry("helm"),
    libraryEntry("a"),
    libraryEntry("kit"),
    libraryEntry("app", appDependsOnA(kind)),
  ];
}

test("an app that hard-depends on a swapped-out plugin refuses the merge as dependency_disabled; a soft dependency only warns", () => {
  const profiles = [profileOf("p1", ["helm", "a", "app"])];
  expect(
    planOf(
      planRequest(FACT, ["p1"], { swapOut: ["a"] }),
      profiles,
      realValidate(appLibrary("hard")),
    ),
  ).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [
        {
          profile: "p1",
          code: "dependency_disabled",
          severity: "error",
          plugin: "app",
          other: "a",
        },
      ],
    }),
  );
  expect(
    planOf(
      planRequest(FACT, ["p1"], { swapOut: ["a"] }),
      profiles,
      realValidate(appLibrary("soft")),
    ),
  ).toEqual(
    ok({
      changed: [{ ...profileOf("p1", ["helm", "kit", "app"], { rev: 2 }), updatedAt: NOW }],
      common: null,
      missingPlugins: [],
    }),
  );
});

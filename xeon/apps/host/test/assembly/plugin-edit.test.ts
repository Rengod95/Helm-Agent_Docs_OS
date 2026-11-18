import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { CommonSet, Profile, ProfileIssue } from "@fresnel/contracts/wire";
import {
  COMMON_ID,
  planPluginEdit,
  type PluginEditRequest,
} from "../../src/assembly/m4/plugin-edit.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { ProfileBody } from "../../src/assembly/m4/profile-validate.ts";

// M5c §4.7.3: 승인의 프로필 반영 계산. 바뀌는 프로필과 공통 묶음을 새 값으로 만들고, 이름이 든 대상 프로필을 모두 검사한다.
// 검사 함수는 가짜다. 드라이버가 목록에 없으면 오류라는 한 가지 규칙만 둔다.

const NOW = "2026-11-18T00:00:00.000Z";
const FACT: PluginFact = {
  name: "kit",
  replaces: [],
  drives: false,
  requiredKeys: [],
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
  validate: (body: ProfileBody, common: CommonSet) => readonly ProfileIssue[] = driverCheck,
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
    }),
  );
});

test("add to a profile that already lists the plugin changes nothing", () => {
  const profiles = [profileOf("p1", ["helm", "kit"])];
  expect(planOf({ kind: "add", plugin: FACT, profileIds: ["p1"] }, profiles)).toEqual(
    ok({ changed: [], common: null }),
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
    ok({ changed: [], common: null }),
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
    }),
  );
});

test("add to the common id when the common set already lists the plugin changes nothing", () => {
  const common: CommonSet = { ...COMMON, plugins: [{ name: "kit" }] };
  expect(
    planOf({ kind: "add", plugin: FACT, profileIds: [COMMON_ID] }, [], driverCheck, common),
  ).toEqual(ok({ changed: [], common: null }));
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

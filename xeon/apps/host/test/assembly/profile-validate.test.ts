import { expect, test } from "bun:test";
import { dependenciesOf, type DependencyDecl } from "@fresnel/contracts/extensions";
import {
  hasBlockingIssue,
  previousOf,
  restartKeysOf,
  validateProfile,
  type ProfileCatalog,
  type ProfileLibrary,
  type ProfileLibraryEntry,
  type ProfileSettingInfo,
} from "../../src/assembly/m4/profile-validate.ts";

// M5c §4.2.7. 검증은 순수 함수다. 라이브러리와 카탈로그를 시험이 직접 만든다. 이슈 코드 하나마다 한 시험이다.

function entry(name: string, over: Partial<ProfileLibraryEntry> = {}): ProfileLibraryEntry {
  return {
    name,
    reviewed: true,
    replaces: [],
    drives: false,
    unmet: false,
    requiredKeys: [],
    version: "1.0.0",
    dependencies: [],
    members: [],
    ...over,
  };
}

/** `name`이 `dependsOn`으로 건 의존. 매니페스트를 `dependenciesOf`로 읽은 결과와 같다 */
function dependsOn(name: string, decls: DependencyDecl[]): ProfileLibraryEntry["dependencies"] {
  return dependenciesOf({ name, plugins: [{ layer: "plugin", hooks: [], dependsOn: decls }] });
}

function libraryOf(entries: readonly ProfileLibraryEntry[]): ProfileLibrary {
  const byName = new Map(entries.map((item) => [item.name, item] as const));
  return { lookup: (name) => byName.get(name) };
}

interface SettingSpec {
  readonly key: string;
  readonly scopes?: readonly ("profile" | "user" | "managed")[];
  readonly owner?: string | null;
  readonly secret?: boolean;
  readonly restart?: boolean;
  readonly valid?: (value: unknown) => "ok" | "invalid" | "secret_literal";
}

function settingOf(spec: SettingSpec): ProfileSettingInfo {
  const valid = spec.valid ?? (() => "ok");
  return {
    key: spec.key,
    allowedScopes: [...(spec.scopes ?? ["profile"])],
    secret: spec.secret === true,
    owner: spec.owner ?? null,
    restart: spec.restart === true,
    checkValue(value) {
      const verdict = valid(value);
      return verdict === "ok"
        ? { ok: true }
        : { ok: false, reason: verdict === "invalid" ? "invalid" : "secret_literal" };
    },
  };
}

function catalogOf(
  settings: readonly ProfileSettingInfo[],
  options: {
    readonly secrets?: readonly string[];
    readonly managedOff?: readonly string[];
    readonly stopped?: readonly string[];
  } = {},
): ProfileCatalog {
  const byKey = new Map(settings.map((item) => [item.key, item] as const));
  const secrets = new Set(options.secrets ?? []);
  const managedOff = new Set(options.managedOff ?? []);
  const stopped = new Set(options.stopped ?? []);
  return {
    lookup: (key) => byKey.get(key),
    secretExists: (name) => secrets.has(name),
    managedDisabled: (plugin) => managedOff.has(plugin),
    unavailable: (plugin) => stopped.has(plugin) || managedOff.has(plugin),
  };
}

const EMPTY = { plugins: [], settings: [], startDrive: null };
const NO_COMMON = { plugins: [], settings: [] };

test("a clean profile has no issues", () => {
  const issues = validateProfile(
    { plugins: [{ name: "demo" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([entry("demo")]),
    catalogOf([]),
  );
  expect(issues).toEqual([]);
});

test("plugin_unknown: a plugin the library does not have is an error", () => {
  const issues = validateProfile(
    { plugins: [{ name: "ghost" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([]),
    catalogOf([]),
  );
  expect(issues).toEqual([{ code: "plugin_unknown", severity: "error", plugin: "ghost" }]);
});

test("plugin_unknown is a warning for a plugin the profile already listed before this save, and an error for a plugin this save adds", () => {
  const before = previousOf(
    { plugins: [{ name: "ghost" }], settings: [] },
    { plugins: [{ name: "gone-common" }], settings: [] },
  );
  const issues = validateProfile(
    {
      plugins: [{ name: "ghost" }, { name: "newghost" }],
      settings: [],
      startDrive: null,
    },
    { plugins: [{ name: "gone-common" }], settings: [] },
    libraryOf([]),
    catalogOf([]),
    before,
  );
  expect(issues).toEqual([
    { code: "plugin_unknown", severity: "warning", plugin: "gone-common" },
    { code: "plugin_unknown", severity: "warning", plugin: "ghost" },
    { code: "plugin_unknown", severity: "error", plugin: "newghost" },
  ]);
  expect(hasBlockingIssue(issues)).toBe(true);
});

test("a setting owned by a plugin that is gone stays a warning only when the key was stored before", () => {
  const body = {
    plugins: [{ name: "ghost" }],
    settings: [
      { key: "ext.ghost.old", value: 1 },
      { key: "ext.ghost.fresh", value: 2 },
    ],
    startDrive: "ghost",
  };
  const issues = validateProfile(
    body,
    NO_COMMON,
    libraryOf([]),
    catalogOf([]),
    previousOf({ plugins: [{ name: "ghost" }], settings: [{ key: "ext.ghost.old" }] }, NO_COMMON),
  );
  expect(issues).toEqual([
    { code: "plugin_unknown", severity: "warning", plugin: "ghost" },
    { code: "setting_unknown_key", severity: "warning", key: "ext.ghost.old" },
    { code: "setting_unknown_key", severity: "error", key: "ext.ghost.fresh" },
  ]);
});

test("without a previous profile every unknown plugin is an error (first save)", () => {
  const issues = validateProfile(
    { plugins: [{ name: "ghost" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([]),
    catalogOf([]),
    previousOf(undefined, NO_COMMON),
  );
  expect(issues).toEqual([{ code: "plugin_unknown", severity: "error", plugin: "ghost" }]);
});

test("plugin_not_reviewed: an installed plugin without a reviewed copy is an error", () => {
  const issues = validateProfile(
    { plugins: [{ name: "draft" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([entry("draft", { reviewed: false })]),
    catalogOf([]),
  );
  expect(issues).toEqual([{ code: "plugin_not_reviewed", severity: "error", plugin: "draft" }]);
});

test("replace_conflict: two plugins in the resolved list that replace the same built-in tool name both", () => {
  const issues = validateProfile(
    { plugins: [{ name: "b" }], settings: [], startDrive: null },
    { plugins: [{ name: "a" }], settings: [] },
    libraryOf([entry("a", { replaces: ["web.fetch"] }), entry("b", { replaces: ["web.fetch"] })]),
    catalogOf([]),
  );
  expect(issues).toEqual([
    { code: "replace_conflict", severity: "error", plugin: "b", other: "a", tool: "web.fetch" },
  ]);
});

test("driver_unavailable: a start drive that is stopped or managed off is a warning that it will not start", () => {
  const library = libraryOf([entry("runner", { drives: true })]);
  const profile = { plugins: [{ name: "runner" }], settings: [], startDrive: "runner" };
  expect(
    validateProfile(profile, NO_COMMON, library, catalogOf([], { stopped: ["runner"] })),
  ).toEqual([{ code: "driver_unavailable", severity: "warning", plugin: "runner" }]);
  expect(
    validateProfile(profile, NO_COMMON, library, catalogOf([], { managedOff: ["runner"] })),
  ).toEqual([
    { code: "managed_forbidden", severity: "warning", plugin: "runner" },
    { code: "driver_unavailable", severity: "warning", plugin: "runner" },
  ]);
});

test("driver_not_in_list and driver_cannot_drive: the start startDrive must be in the resolved list and must be able to drive", () => {
  const library = libraryOf([entry("steady"), entry("runner", { drives: true })]);
  expect(
    validateProfile(
      { plugins: [{ name: "steady" }], settings: [], startDrive: "runner" },
      NO_COMMON,
      library,
      catalogOf([]),
    ),
  ).toEqual([{ code: "driver_not_in_list", severity: "error", plugin: "runner" }]);
  expect(
    validateProfile(
      { plugins: [{ name: "steady" }], settings: [], startDrive: "steady" },
      NO_COMMON,
      library,
      catalogOf([]),
    ),
  ).toEqual([{ code: "driver_cannot_drive", severity: "error", plugin: "steady" }]);
  expect(
    validateProfile(
      { plugins: [{ name: "runner" }], settings: [], startDrive: "runner" },
      NO_COMMON,
      library,
      catalogOf([]),
    ),
  ).toEqual([]);
});

test("setting_unknown_key: a key the catalog does not have, or whose owner is not in the resolved list", () => {
  const catalog = catalogOf([settingOf({ key: "ext.demo.token", owner: "demo" })]);
  expect(
    validateProfile(
      { plugins: [], settings: [{ key: "nope.key", value: 1 }], startDrive: null },
      NO_COMMON,
      libraryOf([]),
      catalog,
    ),
  ).toEqual([{ code: "setting_unknown_key", severity: "error", key: "nope.key" }]);
  expect(
    validateProfile(
      { plugins: [], settings: [{ key: "ext.demo.token", value: null }], startDrive: null },
      NO_COMMON,
      libraryOf([]),
      catalog,
    ),
  ).toEqual([{ code: "setting_unknown_key", severity: "error", key: "ext.demo.token" }]);
});

test("setting_scope_not_allowed: a key whose catalog scopes do not include profile", () => {
  const catalog = catalogOf([settingOf({ key: "ext.x.enabled", scopes: ["managed"] })]);
  expect(
    validateProfile(
      { plugins: [], settings: [{ key: "ext.x.enabled", value: true }], startDrive: null },
      NO_COMMON,
      libraryOf([]),
      catalog,
    ),
  ).toEqual([{ code: "setting_scope_not_allowed", severity: "error", key: "ext.x.enabled" }]);
});

test("setting_invalid_value: a value the key's schema refuses", () => {
  const catalog = catalogOf([
    settingOf({
      key: "l1.loop.maxSteps",
      valid: (value) => (typeof value === "number" ? "ok" : "invalid"),
    }),
  ]);
  expect(
    validateProfile(
      { plugins: [], settings: [{ key: "l1.loop.maxSteps", value: "many" }], startDrive: null },
      NO_COMMON,
      libraryOf([]),
      catalog,
    ),
  ).toEqual([{ code: "setting_invalid_value", severity: "error", key: "l1.loop.maxSteps" }]);
});

test("secret_literal is an error and secret_missing a warning; the literal value is never put in an issue", () => {
  const catalog = catalogOf(
    [
      settingOf({
        key: "ext.demo.token",
        owner: "demo",
        secret: true,
        valid: (value) =>
          value === null || (typeof value === "string" && value.startsWith("secret://"))
            ? "ok"
            : "secret_literal",
      }),
    ],
    { secrets: [] },
  );
  const library = libraryOf([entry("demo")]);
  const literal = validateProfile(
    {
      plugins: [{ name: "demo" }],
      settings: [{ key: "ext.demo.token", value: "sk-123" }],
      startDrive: null,
    },
    NO_COMMON,
    library,
    catalog,
  );
  expect(literal).toEqual([{ code: "secret_literal", severity: "error", key: "ext.demo.token" }]);
  expect(JSON.stringify(literal)).not.toContain("sk-123");
  const missing = validateProfile(
    {
      plugins: [{ name: "demo" }],
      settings: [{ key: "ext.demo.token", value: "secret://gone" }],
      startDrive: null,
    },
    NO_COMMON,
    library,
    catalog,
  );
  expect(missing).toEqual([{ code: "secret_missing", severity: "warning", key: "ext.demo.token" }]);
  const found = validateProfile(
    {
      plugins: [{ name: "demo" }],
      settings: [{ key: "ext.demo.token", value: "secret://here" }],
      startDrive: null,
    },
    NO_COMMON,
    library,
    catalogOf(
      [settingOf({ key: "ext.demo.token", owner: "demo", secret: true, valid: () => "ok" })],
      { secrets: ["here"] },
    ),
  );
  expect(found).toEqual([]);
});

test("required_unset is a warning for a required key that no layer sets", () => {
  const issues = validateProfile(
    { plugins: [{ name: "demo" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([entry("demo", { requiredKeys: ["ext.demo.token"] })]),
    catalogOf([]),
  );
  expect(issues).toEqual([
    { code: "required_unset", severity: "warning", plugin: "demo", key: "ext.demo.token" },
  ]);
});

test("requirement_unmet is a warning for a plugin whose required capability is missing", () => {
  const issues = validateProfile(
    { plugins: [{ name: "demo" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([entry("demo", { unmet: true })]),
    catalogOf([]),
  );
  expect(issues).toEqual([{ code: "requirement_unmet", severity: "warning", plugin: "demo" }]);
});

test("managed_forbidden is a warning for a plugin the managed scope turns off", () => {
  const issues = validateProfile(
    { plugins: [{ name: "demo" }], settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([entry("demo")]),
    catalogOf([], { managedOff: ["demo"] }),
  );
  expect(issues).toEqual([{ code: "managed_forbidden", severity: "warning", plugin: "demo" }]);
});

test("limit: more plugins than the profile may hold is an error", () => {
  const many = Array.from({ length: 129 }, (_, at) => ({ name: `p${String(at)}` }));
  const issues = validateProfile(
    { plugins: many, settings: [], startDrive: null },
    NO_COMMON,
    libraryOf([]),
    catalogOf([]),
  );
  expect(issues[0]).toEqual({ code: "limit", severity: "error" });
});

test("the common set is resolved before the profile; a setting from the common set is checked too", () => {
  const catalog = catalogOf([settingOf({ key: "l1.loop.maxSteps", valid: () => "invalid" })]);
  const issues = validateProfile(
    EMPTY,
    { plugins: [], settings: [{ key: "l1.loop.maxSteps", value: 1 }] },
    libraryOf([]),
    catalog,
  );
  expect(issues).toEqual([
    { code: "setting_invalid_value", severity: "error", key: "l1.loop.maxSteps" },
  ]);
  expect(hasBlockingIssue(issues)).toBe(true);
  expect(hasBlockingIssue([{ code: "required_unset", severity: "warning" }])).toBe(false);
});

// M5c §4.1.7. 다시 시작해야 적용되는 키는 카탈로그 정의의 `runtimeChange`에서 온다. 지금 프로필에 허용된 그런 키는 없다

test("restartKeysOf lists the profile settings whose catalog definition needs a restart, once each, in order", () => {
  const catalog = catalogOf([
    settingOf({ key: "ext.demo.isolation", owner: "demo", restart: true }),
    settingOf({ key: "ext.demo.port", owner: "demo", restart: true }),
    settingOf({ key: "ext.demo.label", owner: "demo" }),
  ]);
  expect(
    restartKeysOf(
      [
        { key: "ext.demo.port", value: 1 },
        { key: "ext.demo.label", value: "a" },
        { key: "ext.demo.isolation", value: "none" },
        { key: "ext.demo.isolation", value: "process" },
      ],
      catalog,
    ),
  ).toEqual(["ext.demo.port", "ext.demo.isolation"]);
});

test("restartKeysOf leaves out keys the catalog does not define", () => {
  const catalog = catalogOf([
    settingOf({ key: "ext.demo.isolation", owner: "demo", restart: true }),
  ]);
  expect(restartKeysOf([{ key: "ext.ghost.isolation", value: "none" }], catalog)).toEqual([]);
  expect(restartKeysOf([], catalog)).toEqual([]);
});

// AGE-33. 플러그인 의존(`dependsOn`)은 해소된 목록 안의 플러그인이 건 것만 본다(공통 묶음 포함).

test("dependency_disabled: a hard dependency whose target is installed but not in the list is an error that names the dependent and the target", () => {
  const library = libraryOf([
    entry("app", { dependencies: dependsOn("app", [{ plugin: "core", kind: "hard" }]) }),
    entry("core"),
  ]);
  const issues = validateProfile(
    { plugins: [{ name: "app" }], settings: [], startDrive: null },
    NO_COMMON,
    library,
    catalogOf([]),
  );
  expect(issues).toEqual([
    { code: "dependency_disabled", severity: "error", plugin: "app", other: "core" },
  ]);
  expect(hasBlockingIssue(issues)).toBe(true);
  // 대상이 목록에 들어 있으면 이슈가 없다
  expect(
    validateProfile(
      { plugins: [{ name: "app" }, { name: "core" }], settings: [], startDrive: null },
      NO_COMMON,
      library,
      catalogOf([]),
    ),
  ).toEqual([]);
});

test("dependency_missing: a target the library lacks, or one without a reviewed copy, is an error for a hard dependency", () => {
  const profile = { plugins: [{ name: "app" }], settings: [], startDrive: null };
  const app = entry("app", { dependencies: dependsOn("app", [{ plugin: "core", kind: "hard" }]) });
  expect(validateProfile(profile, NO_COMMON, libraryOf([app]), catalogOf([]))).toEqual([
    { code: "dependency_missing", severity: "error", plugin: "app", other: "core" },
  ]);
  expect(
    validateProfile(
      profile,
      NO_COMMON,
      libraryOf([app, entry("core", { reviewed: false })]),
      catalogOf([]),
    ),
  ).toEqual([{ code: "dependency_missing", severity: "error", plugin: "app", other: "core" }]);
});

test("dependency_missing: a member the target does not have is an error, and a member it has is clean", () => {
  const app = entry("app", {
    dependencies: dependsOn("app", [{ plugin: "core/drive", kind: "hard" }]),
  });
  const profile = { plugins: [{ name: "app" }, { name: "core" }], settings: [], startDrive: null };
  expect(
    validateProfile(
      profile,
      NO_COMMON,
      libraryOf([app, entry("core", { members: ["other"] })]),
      catalogOf([]),
    ),
  ).toEqual([
    { code: "dependency_missing", severity: "error", plugin: "app", other: "core/drive" },
  ]);
  expect(
    validateProfile(
      profile,
      NO_COMMON,
      libraryOf([app, entry("core", { members: ["drive"] })]),
      catalogOf([]),
    ),
  ).toEqual([]);
});

test("the same dependency problems are warnings for a soft dependency, so the save goes through", () => {
  const profile = { plugins: [{ name: "app" }], settings: [], startDrive: null };
  const soft = entry("app", { dependencies: dependsOn("app", [{ plugin: "core", kind: "soft" }]) });
  const disabled = validateProfile(
    profile,
    NO_COMMON,
    libraryOf([soft, entry("core")]),
    catalogOf([]),
  );
  expect(disabled).toEqual([
    { code: "dependency_disabled", severity: "warning", plugin: "app", other: "core" },
  ]);
  expect(hasBlockingIssue(disabled)).toBe(false);
  expect(validateProfile(profile, NO_COMMON, libraryOf([soft]), catalogOf([]))).toEqual([
    { code: "dependency_missing", severity: "warning", plugin: "app", other: "core" },
  ]);
});

test("a dependent in the common set is checked against the resolved list too", () => {
  const library = libraryOf([
    entry("app", { dependencies: dependsOn("app", [{ plugin: "core", kind: "hard" }]) }),
    entry("core"),
  ]);
  expect(
    validateProfile(
      { plugins: [], settings: [], startDrive: null },
      { plugins: [{ name: "app" }], settings: [] },
      library,
      catalogOf([]),
    ),
  ).toEqual([{ code: "dependency_disabled", severity: "error", plugin: "app", other: "core" }]);
});

test("dependency_range: a target version outside the range is an error for hard and a warning for soft", () => {
  const library = libraryOf([
    entry("app", {
      dependencies: dependsOn("app", [
        { plugin: "core", kind: "hard", range: "^2.0.0" },
        { plugin: "notes", range: "^2.0.0" },
      ]),
    }),
    entry("core", { version: "1.4.0" }),
    entry("notes", { version: "1.0.0" }),
  ]);
  const issues = validateProfile(
    {
      plugins: [{ name: "app" }, { name: "core" }, { name: "notes" }],
      settings: [],
      startDrive: null,
    },
    NO_COMMON,
    library,
    catalogOf([]),
  );
  expect(issues).toEqual([
    { code: "dependency_range", severity: "error", plugin: "app", other: "core" },
    { code: "dependency_range", severity: "warning", plugin: "app", other: "notes" },
  ]);
});

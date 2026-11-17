import { expect, test } from "bun:test";
import {
  hasBlockingIssue,
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
    ...over,
  };
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
  readonly valid?: (value: unknown) => "ok" | "invalid" | "secret_literal";
}

function settingOf(spec: SettingSpec): ProfileSettingInfo {
  const valid = spec.valid ?? (() => "ok");
  return {
    key: spec.key,
    allowedScopes: [...(spec.scopes ?? ["profile"])],
    secret: spec.secret === true,
    owner: spec.owner ?? null,
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
  options: { readonly secrets?: readonly string[]; readonly managedOff?: readonly string[] } = {},
): ProfileCatalog {
  const byKey = new Map(settings.map((item) => [item.key, item] as const));
  const secrets = new Set(options.secrets ?? []);
  const managedOff = new Set(options.managedOff ?? []);
  return {
    lookup: (key) => byKey.get(key),
    secretExists: (name) => secrets.has(name),
    managedDisabled: (plugin) => managedOff.has(plugin),
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

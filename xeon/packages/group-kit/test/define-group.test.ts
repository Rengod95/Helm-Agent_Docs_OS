import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { validateManifest, type ExtensionManifest } from "@xeon/contracts/extensions";
import { defineSettings } from "@xeon/contracts/settings";
import { Type } from "typebox";
import {
  GROUP_NAME_PATTERN,
  RESERVED_GROUP_NAMES,
  defineGroup,
  groupManifest,
  validateGroupDef,
  type GroupDefShape,
} from "../src/index.ts";
import { checkGroup } from "../src/testing/index.ts";
import { groupManifestOf } from "./support/manifests.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });

function codes(def: GroupDefShape): string[] {
  return validateGroupDef(def)
    .filter((found) => found.severity === "error")
    .map((found) => found.code);
}

function shape(name: string, extra: Partial<GroupDefShape> = {}): GroupDefShape {
  const manifest: ExtensionManifest = groupManifestOf({ name });
  return { manifest, ...extra };
}

test("define-group.rejects-usage-without-manifest-point", async () => {
  const module = defineGroup({
    manifest: groupManifestOf({ name: "needs-point", points: [] }),
    setup(g) {
      g.on("tool_call", () => undefined);
    },
  });
  const issues = await checkGroup(module);
  expect(issues.map((found) => found.code)).toContain("point_undeclared");
});

test("define-group.check-group-passes-a-correct-group", async () => {
  const module = defineGroup({
    manifest: groupManifestOf({
      name: "correct-group",
      points: ["tool_call"],
      usesDrive: true,
    }),
    state: { schema: CounterSchema, initial: { n: 0 }, version: 1 },
    setup(g) {
      g.on("tool_call", () => undefined);
      g.drive(async (loop, state) => {
        await loop.turn({ input: { kind: "user", content: "go" } });
        await g.commit({ n: state.n + 1 });
      });
    },
  });
  expect((await checkGroup(module)).filter((found) => found.severity === "error")).toEqual([]);
});

test("define-group.check-group-reports-a-setup-that-throws", async () => {
  const module = defineGroup({
    manifest: groupManifestOf({ name: "throws-in-setup" }),
    setup() {
      throw new TypeError("boom");
    },
  });
  const issues = await checkGroup(module);
  expect(issues).toMatchObject([{ severity: "error", code: "setup_threw" }]);
  expect(issues[0]?.message).toContain("boom");
});

test("define-group.check-group-maps-undeclared-registrations", async () => {
  const noPost = defineGroup({
    manifest: groupManifestOf({ name: "posts-undeclared" }),
    async setup(g) {
      await g.post({ kind: "user", content: "x" }, { when: "next", requestId: "r1" });
    },
  });
  expect((await checkGroup(noPost)).map((found) => found.code)).toContain("post_undeclared");
});

test("define-group.rejects-reserved-name", () => {
  for (const name of ["auto", "core", "web", "focus_lens", "-abc"]) {
    expect(codes(shape(name))).toContain("group_name");
  }
  // 하이픈 이름은 예약어와 정확히 같지 않으면 통과한다(review.decisions-2 U-18)
  expect(codes(shape("web-exa"))).not.toContain("group_name");
  expect(RESERVED_GROUP_NAMES).toContain("auto");
  expect(new RegExp(GROUP_NAME_PATTERN).test("helm")).toBe(true);
});

test("define-group.rejects-wrong-kind-and-layer", () => {
  const plugin: ExtensionManifest = { ...groupManifestOf({ name: "not-a-group" }), kind: "plugin" };
  expect(codes({ manifest: plugin })).toContain("group_kind");
});

test("define-group.accepts-stateless-group", () => {
  const module = defineGroup({
    manifest: groupManifestOf({ name: "stateless", points: ["tool_call"] }),
    setup(g) {
      g.on("tool_call", () => undefined);
    },
  });
  expect(module.stateVersion).toBe(0);
  expect(module.stateUpcasters).toEqual([]);
  // migrations만 있고 상태가 없으면 state_version이다
  expect(codes(shape("stateless", { migrations: { 1: (previous) => previous } }))).toEqual([
    "state_version",
  ]);
});

test("define-group.validates-state-declaration", () => {
  const initialBroken = { schema: CounterSchema, initial: { n: -1 }, version: 1 };
  expect(codes(shape("bad-initial", { state: initialBroken }))).toEqual(["state_initial_invalid"]);
  const versionZero = { schema: CounterSchema, initial: { n: 0 }, version: 0 };
  expect(codes(shape("bad-version", { state: versionZero }))).toEqual(["state_version"]);
});

test("define-group.migration-required-on-version-bump", () => {
  const v2 = { schema: CounterSchema, initial: { n: 0 }, version: 3 };
  expect(codes(shape("needs-migration", { state: v2 }))).toEqual([
    "state_migration_missing",
    "state_migration_missing",
  ]);
  expect(codes(shape("needs-migration", { state: v2, migrations: { 1: (p) => p } }))).toEqual([
    "state_migration_missing",
  ]);
  const module = defineGroup({
    manifest: groupManifestOf({ name: "migrated" }),
    state: { schema: CounterSchema, initial: { n: 0 }, version: 3 },
    migrations: { 1: (p) => p, 2: (p) => p },
    setup() {},
  });
  expect(module.stateVersion).toBe(3);
  expect(module.stateUpcasters).toHaveLength(2);
});

test("define-group.rejects-wrong-settings-namespace", () => {
  const builtinWrong = defineSettings("ext.builtin-one", {
    flag: {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  expect(codes(shape("builtin-one", { settings: builtinWrong }))).toEqual(["settings_namespace"]);
  const external: ExtensionManifest = groupManifestOf({ name: "external-one", builtin: false });
  const externalWrong = defineSettings("l3.external-one", {
    flag: {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  expect(codes({ manifest: external, settings: externalWrong })).toEqual(["settings_namespace"]);
  const right = defineSettings("l3.builtin-one", {
    flag: {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  expect(codes(shape("builtin-one", { settings: right }))).toEqual([]);
});

function brokenGroup(): unknown {
  return defineGroup({
    manifest: groupManifestOf({ name: "auto" }),
    state: { schema: CounterSchema, initial: { n: -1 }, version: 2 },
    setup() {},
  });
}

test("define-group.throws-bug-on-invalid", () => {
  expect(brokenGroup).toThrow(Bug);
  expect(brokenGroup).toThrow(/group_name/);
  expect(brokenGroup).toThrow(/state_initial_invalid/);
  expect(brokenGroup).toThrow(/state_migration_missing/);
});

test("define-group.group-manifest-from-json", () => {
  const value = JSON.parse(JSON.stringify(groupManifestOf({ name: "from-json" })));
  const parsed = groupManifest(value);
  expect(parsed.name).toBe("from-json");
  expect(validateManifest(parsed).issues).toEqual([]);

  const plugin = {
    schemaVersion: 1,
    name: "just-plugin",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
  };
  expect(() => groupManifest(plugin)).toThrow(Bug);
  expect(() => groupManifest({ ...value, points: ["nope"] })).toThrow(Bug);
  expect(() => groupManifest("not an object")).toThrow(Bug);
});

test("define-group.module-carries-settings-and-manifest", () => {
  const settings = defineSettings("l3.with-settings", {
    mode: {
      type: Type.String(),
      default: "a",
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const module = defineGroup({
    manifest: groupManifestOf({ name: "with-settings" }),
    settings,
    setup() {},
  });
  expect(module.manifest.name).toBe("with-settings");
  expect(module.settings?.namespace).toBe("l3.with-settings");
  expect(module.settings?.defs.map((def) => def.key)).toEqual(["l3.with-settings.mode"]);
});

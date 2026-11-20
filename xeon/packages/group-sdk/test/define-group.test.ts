import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { validateManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { defineSettings } from "@fresnel/contracts/settings";
import { Type } from "typebox";
import {
  ORCHESTRATION_NAME_PATTERN,
  RESERVED_ORCHESTRATION_NAMES,
  defineOrchestration,
  orchestrationManifest,
  isOrchestrationModule,
  validateOrchestrationDef,
  type OrchestrationDefShape,
  type OrchestrationManifest,
} from "../src/index.ts";
import { checkOrchestration } from "../src/testing/index.ts";
import { orchestrationManifestOf, pluginManifestOf } from "./support/manifests.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });

function codes(def: OrchestrationDefShape): string[] {
  return validateOrchestrationDef(def)
    .filter((found) => found.severity === "error")
    .map((found) => found.code);
}

function shape(name: string, extra: Partial<OrchestrationDefShape> = {}): OrchestrationDefShape {
  const manifest: ExtensionManifest = orchestrationManifestOf({ name });
  return { manifest, ...extra };
}

test("define-group.rejects-usage-without-manifest-point", async () => {
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "needs-point", hooks: [] }),
    setup(g) {
      g.on("tool.call.before", () => undefined);
    },
  });
  const issues = await checkOrchestration(module);
  expect(issues.map((found) => found.code)).toContain("hook_undeclared");
});

test("define-group.check-group-passes-a-correct-group", async () => {
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({
      name: "correct-group",
      hooks: ["tool.call.before"],
      drives: true,
    }),
    state: { schema: CounterSchema, initial: { n: 0 }, version: 1 },
    setup(g) {
      g.on("tool.call.before", () => undefined);
      g.drive(async ({ state }) => ({
        do: "commit",
        state: { n: state.n + 1 },
        next: { do: "yield" },
      }));
    },
  });
  expect((await checkOrchestration(module)).filter((found) => found.severity === "error")).toEqual(
    [],
  );
});

test("define-group.check-group-reports-a-setup-that-throws", async () => {
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "throws-in-setup" }),
    setup() {
      throw new TypeError("boom");
    },
  });
  const issues = await checkOrchestration(module);
  expect(issues).toMatchObject([{ severity: "error", code: "setup_threw" }]);
  expect(issues[0]?.message).toContain("boom");
});

test("define-group.check-group-maps-undeclared-registrations", async () => {
  const noPost = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "posts-undeclared" }),
    async setup(g) {
      await g.post({ kind: "user", content: "x" }, { when: "next", requestId: "r1" });
    },
  });
  expect((await checkOrchestration(noPost)).map((found) => found.code)).toContain(
    "post_undeclared",
  );
});

test("define-group.check-group-reports-usage-at-the-root-plugin", async () => {
  // 루트 플러그인은 plugins 목록의 어느 자리에 있어도 된다. 검사 경로는 그 자리를 가리킨다
  const hookGroup = defineOrchestration({
    manifest: {
      ...orchestrationManifestOf({ name: "root-second" }),
      plugins: [
        { id: "worker", layer: "L3", hooks: [] },
        { layer: "L3", hooks: [] },
      ],
    },
    setup(g) {
      g.on("tool.call.before", () => undefined);
    },
  });
  expect((await checkOrchestration(hookGroup)).map((found) => [found.code, found.path])).toEqual([
    ["hook_undeclared", "/plugins/1/hooks"],
  ]);

  // drive를 쓰는데 drives가 없으면 루트 플러그인의 drives 자리를 가리킨다
  const driveGroup = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "drive-undeclared" }),
    setup(g) {
      g.drive(async () => ({ do: "yield" }));
    },
  });
  expect((await checkOrchestration(driveGroup)).map((found) => [found.code, found.path])).toEqual([
    ["drive_undeclared", "/plugins/0/drives"],
  ]);
});

test("define-group.rejects-reserved-name", () => {
  for (const name of ["auto", "core", "web", "focus_lens", "-abc"]) {
    expect(codes(shape(name))).toContain("orchestration_name");
  }
  // 하이픈 이름은 예약어와 정확히 같지 않으면 통과한다(review.decisions-2 U-18)
  expect(codes(shape("web-exa"))).not.toContain("orchestration_name");
  expect(RESERVED_ORCHESTRATION_NAMES).toContain("auto");
  expect(new RegExp(ORCHESTRATION_NAME_PATTERN).test("helm")).toBe(true);
});

test("define-group.rejects-manifest-without-orchestration", () => {
  // group 선언이 없는 외부 플러그인은 그룹이 아니다
  const plugin = pluginManifestOf("not-a-group");
  expect(codes({ manifest: plugin })).toEqual(["orchestration_missing"]);

  // group 선언은 있지만 L3 플러그인에 id가 있다. 루트(id 없음)가 아니면 오케스트레이션이 아니다
  const nonRoot: OrchestrationManifest = {
    ...orchestrationManifestOf({ name: "non-root" }),
    plugins: [{ id: "worker", layer: "L3", hooks: [] }],
  };
  expect(codes({ manifest: nonRoot })).toEqual(["orchestration_missing"]);
  expect(
    validateOrchestrationDef({ manifest: nonRoot })
      .filter((found) => found.code === "orchestration_missing")
      .map((found) => found.path),
  ).toEqual(["/manifest/orchestration"]);
});

test("define-group.accepts-group-with-root-orchestration", () => {
  expect(codes(shape("root-only"))).toEqual([]);
  // 루트가 목록의 어디에 있든 오케스트레이션은 루트 플러그인이 맡는다
  const namedFirst: OrchestrationManifest = {
    ...orchestrationManifestOf({ name: "named-first" }),
    plugins: [
      { id: "worker", layer: "L3", hooks: [] },
      { layer: "L3", hooks: [] },
    ],
  };
  expect(codes({ manifest: namedFirst })).toEqual([]);
  expect(() => defineOrchestration({ manifest: namedFirst, setup() {} })).not.toThrow();
});

test("define-group.accepts-stateless-group", () => {
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "stateless", hooks: ["tool.call.before"] }),
    setup(g) {
      g.on("tool.call.before", () => undefined);
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
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "migrated" }),
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
  const external: ExtensionManifest = orchestrationManifestOf({
    name: "external-one",
    builtin: false,
  });
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

function brokenOrchestration(): unknown {
  return defineOrchestration({
    manifest: orchestrationManifestOf({ name: "auto" }),
    state: { schema: CounterSchema, initial: { n: -1 }, version: 2 },
    setup() {},
  });
}

test("define-group.throws-bug-on-invalid", () => {
  expect(brokenOrchestration).toThrow(Bug);
  expect(brokenOrchestration).toThrow(/orchestration_name/);
  expect(brokenOrchestration).toThrow(/state_initial_invalid/);
  expect(brokenOrchestration).toThrow(/state_migration_missing/);
});

test("define-group.group-manifest-from-json", () => {
  const value = JSON.parse(JSON.stringify(orchestrationManifestOf({ name: "from-json" })));
  const parsed = orchestrationManifest(value);
  expect(parsed.name).toBe("from-json");
  expect(validateManifest(parsed).issues).toEqual([]);

  // 그룹이 아닌 매니페스트는 검증을 통과해도 오케스트레이션이 없어 Bug다
  const plugin = JSON.parse(JSON.stringify(pluginManifestOf("just-plugin")));
  expect(() => orchestrationManifest(plugin)).toThrow(Bug);
  expect(() => orchestrationManifest(plugin)).toThrow(/orchestration_missing/);
  expect(() =>
    orchestrationManifest({ ...value, plugins: [{ layer: "L3", hooks: ["nope"] }] }),
  ).toThrow(Bug);
  expect(() => orchestrationManifest("not an object")).toThrow(Bug);
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
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "with-settings" }),
    settings,
    setup() {},
  });
  expect(module.manifest.name).toBe("with-settings");
  expect(module.settings?.namespace).toBe("l3.with-settings");
  expect(module.settings?.defs.map((def) => def.key)).toEqual(["l3.with-settings.mode"]);
});

test("define-group.is-group-module-only-for-define-group-results", () => {
  const module = defineOrchestration({
    manifest: orchestrationManifestOf({ name: "brand-check" }),
    setup() {},
  });
  // 같은 필드를 가진 손으로 쓴 객체는 defineGroup을 거치지 않았으므로 GroupModule이 아니다
  const handWritten = { ...module };
  expect(isOrchestrationModule(module)).toBe(true);
  expect(isOrchestrationModule(handWritten)).toBe(false);
  expect(isOrchestrationModule(null)).toBe(false);
  expect(isOrchestrationModule(undefined)).toBe(false);
  expect(isOrchestrationModule("brand-check")).toBe(false);
  expect(isOrchestrationModule([module.manifest])).toBe(false);
});

const COMPOSITION = {
  blocks: [{ id: "main", stage: "work", op: "drive" as const }],
};

test("define-group.composition-fills-manifest-group-without-touching-the-constant", () => {
  const manifest = orchestrationManifestOf({ name: "composed", drives: true });
  const module = defineOrchestration({ manifest, composition: COMPOSITION, setup() {} });
  expect(module.manifest.orchestration.composition).toEqual(COMPOSITION);
  expect(manifest.orchestration.composition).toBeUndefined();
  expect(validateManifest(module.manifest).issues.filter((i) => i.severity === "error")).toEqual(
    [],
  );
});

test("define-group.composition-conflict-with-manifest-is-rejected", () => {
  const manifest: OrchestrationManifest = {
    ...orchestrationManifestOf({ name: "twice", drives: true }),
    orchestration: { composition: { blocks: [{ id: "other", stage: "work", op: "drive" }] } },
  };
  expect(codes({ manifest, composition: COMPOSITION })).toContain("composition_conflict");
  expect(() => defineOrchestration({ manifest, composition: COMPOSITION, setup() {} })).toThrow(
    Bug,
  );
  // 같은 값이면 충돌이 아니다
  expect(
    codes({ manifest, composition: { blocks: [{ id: "other", stage: "work", op: "drive" }] } }),
  ).toEqual([]);
});

test("define-group.composition-block-with-unknown-plugin-surfaces-manifest-issue", () => {
  const manifest = orchestrationManifestOf({ name: "badblock", drives: true });
  const bad = { blocks: [{ id: "x", stage: "work", op: "drive" as const, plugin: "ghost" }] };
  expect(codes({ manifest, composition: bad })).toContain("composition_plugin_unknown");
});

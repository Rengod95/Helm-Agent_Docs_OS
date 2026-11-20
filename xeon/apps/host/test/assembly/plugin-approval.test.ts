import { expect, test } from "bun:test";
import { err, ok, type Logger } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import type { ExtensionLoader, LoadedExtensionInfo, ReloadApplied } from "@fresnel/ext-host";
import type { PluginEditIssue } from "../../src/assembly/m4/plugin-edit.ts";
import type { PluginEditFailure } from "../../src/handlers/m4/profile-test-run.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import {
  approvalHooksOf,
  editOf,
  type ApprovalHookDeps,
} from "../../src/assembly/plugins/approval.ts";
import type { ApprovalContext } from "../../src/assembly/plugins/review.ts";
import { partial } from "../fixtures/unsafe.ts";

// M5c §4.7.3 승인 훅: 승인 한 번이 프로필에 하는 일과, 커밋 뒤 실행 중인 판을 맞추는 일. 프로필 쪽과 로더는 가짜다.

const NOW = "2026-11-18T00:00:00.000Z";
const FACT: PluginFact = {
  name: "kit",
  replaces: [],
  drives: false,
  requiredKeys: [],
  declared: { code: false, root: "", tools: [], instructions: [], skills: [] },
};
const APPROVE = { kind: "approve", profileIds: [], libraryOnly: false } as const;

function contextOf(
  item: Partial<ReviewItem>,
  facts: PluginFact | null,
  decision: ApprovalContext["decision"] = APPROVE,
): ApprovalContext {
  return { item: partial<ReviewItem>({ name: "kit", ...item }), decision, approvedAt: NOW, facts };
}

test("a removal asks for a removal in every profile by name", () => {
  expect(editOf(contextOf({ kind: "remove" }, null))).toEqual({ kind: "remove", plugin: "kit" });
});

test("a new plugin goes to the chosen profiles, then to the profile it came from, and nowhere when library only", () => {
  expect(
    editOf(
      contextOf({ kind: "new", originProfileId: "p9" }, FACT, { ...APPROVE, profileIds: ["p1"] }),
    ),
  ).toEqual({ kind: "add", plugin: FACT, profileIds: ["p1"] });
  expect(editOf(contextOf({ kind: "new", originProfileId: "p9" }, FACT))).toEqual({
    kind: "add",
    plugin: FACT,
    profileIds: ["p9"],
  });
  expect(
    editOf(
      contextOf({ kind: "new", originProfileId: "p9" }, FACT, { ...APPROVE, libraryOnly: true }),
    ),
  ).toEqual({ kind: "add", plugin: FACT, profileIds: [] });
});

test("an update only checks the profiles that list the plugin", () => {
  expect(editOf(contextOf({ kind: "update" }, FACT))).toEqual({ kind: "keep", plugin: FACT });
});

function depsOf(
  overrides: {
    readonly check?: ApprovalHookDeps["profiles"]["checkPluginEdit"];
    readonly apply?: ApprovalHookDeps["profiles"]["applyPluginEdit"];
    readonly loader?: ExtensionLoader | undefined;
    readonly refreshes?: { count: number };
    readonly warnings?: string[];
  } = {},
): ApprovalHookDeps {
  const refreshes = overrides.refreshes ?? { count: 0 };
  const warnings = overrides.warnings ?? [];
  return {
    profiles: {
      checkPluginEdit: overrides.check ?? (() => Promise.resolve(ok(undefined))),
      applyPluginEdit:
        overrides.apply ?? (() => Promise.resolve(ok({ profileIds: [], missingPlugins: [] }))),
    },
    loader: () => overrides.loader,
    refreshPluginSet: () => {
      refreshes.count += 1;
      return Promise.resolve();
    },
    log: partial<Logger>({
      warn: (message: string) => {
        warnings.push(message);
      },
      error: () => undefined,
    }),
  };
}

test("a failing profile check before the commit answers profile_invalid with the issues; a library-only approval has no profile to check", async () => {
  const issues: PluginEditIssue[] = [
    { profile: "p1", code: "plugin_not_reviewed", severity: "error", plugin: "kit" },
  ];
  // 대상 프로필이 없는 요청(보관만)은 검사할 것이 없어 통과한다. 검사 함수가 이 규칙을 흉내 낸다
  const hooks = approvalHooksOf(
    depsOf({
      check: (request) =>
        Promise.resolve(
          request.kind === "add" && request.profileIds.length === 0
            ? ok(undefined)
            : err({ kind: "plugin_invalid", issues }),
        ),
    }),
  );
  expect(await hooks.beforeCommit?.(contextOf({ kind: "new" }, FACT))).toEqual(
    err({ kind: "profile_invalid", issues }),
  );
  expect(
    await hooks.beforeCommit?.(contextOf({ kind: "new" }, FACT, { ...APPROVE, libraryOnly: true })),
  ).toEqual(ok(undefined));
});

test("a profile store failure after the swap is answered as a profiles failure", async () => {
  const failure: PluginEditFailure = { kind: "io", path: "profiles.json", code: "EIO" };
  const hooks = approvalHooksOf(depsOf({ apply: () => Promise.resolve(err(failure)) }));
  expect(
    await hooks.afterCommit?.(contextOf({ kind: "new", originProfileId: "p1" }, FACT)),
  ).toEqual(err({ kind: "profiles", failure }));
});

test("reflect reloads an updated plugin from its reviewed copy and refreshes the plugin set", async () => {
  const reloads: string[] = [];
  const refreshes = { count: 0 };
  const applied: ReloadApplied = { status: "superseded" };
  const loader = partial<ExtensionLoader>({
    // 실린 확장 하나. 반영은 이름만 본다
    list: () => [partial<LoadedExtensionInfo>({ name: "kit", state: "active" })],
    reloadFromReviewed: (name) => {
      reloads.push(name);
      return Promise.resolve(ok({ appliesAt: "now", applied: Promise.resolve(applied) }));
    },
  });
  const hooks = approvalHooksOf(depsOf({ loader, refreshes }));
  await hooks.reflect?.(contextOf({ kind: "update" }, FACT));
  expect(reloads).toEqual(["kit"]);
  expect(refreshes.count).toBeGreaterThan(0);
});

test("reflect records an approved new plugin as deferred without starting its code", async () => {
  const installs: { readonly name: string; readonly deferStart: boolean | undefined }[] = [];
  const warnings: string[] = [];
  const refreshes = { count: 0 };
  const loader = partial<ExtensionLoader>({
    list: () => [],
    loadInstalled: (name, _signal, options) => {
      installs.push({ name, deferStart: options?.deferStart });
      return Promise.resolve(err({ kind: "not_active", state: "disabled", diagnostics: [] }));
    },
  });
  const hooks = approvalHooksOf(depsOf({ loader, refreshes, warnings }));
  await hooks.reflect?.(contextOf({ kind: "new" }, FACT));
  expect(installs).toEqual([{ name: "kit", deferStart: true }]);
  expect(warnings).toEqual([]);
  expect(refreshes.count).toBe(1);
});

test("reflect warns when the reviewed copy of a new plugin cannot be recorded", async () => {
  const warnings: string[] = [];
  const loader = partial<ExtensionLoader>({
    list: () => [],
    loadInstalled: () => Promise.resolve(err({ kind: "not_found", diagnostics: [] })),
  });
  const hooks = approvalHooksOf(depsOf({ loader, warnings }));
  await hooks.reflect?.(contextOf({ kind: "new" }, FACT));
  expect(warnings).toEqual(["plugin.review.load_skipped"]);
});

test("a removal reflects only the plugin set, without touching the loader", async () => {
  const refreshes = { count: 0 };
  const hooks = approvalHooksOf(
    depsOf({
      refreshes,
      loader: partial<ExtensionLoader>({
        reloadFromReviewed: () => Promise.reject(new Error("must not reload a removal")),
      }),
    }),
  );
  await hooks.reflect?.(contextOf({ kind: "remove" }, null));
  expect(refreshes.count).toBe(1);
});

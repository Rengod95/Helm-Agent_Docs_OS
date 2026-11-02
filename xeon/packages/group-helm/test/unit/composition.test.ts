import { expect, test } from "bun:test";
import {
  validateComposition,
  validateManifest,
  type CompositionDecl,
} from "@fresnel/contracts/extensions";
import { validateGroupDef } from "@fresnel/group-sdk";
import { helmComposition } from "../../src/composition.ts";
import { helmGroup, helmManifest } from "../../src/index.ts";
import { HELM_RECORD_KINDS } from "../../src/records.ts";
import { helmStateDecl } from "../../src/state.ts";
import { helmSettings } from "../../src/settings.ts";

// 구성 선언(X-16)과 단계 머신 선언. 전이는 phase.ts TRANSITIONS에서 만들므로 시험은 표의 정본 값을 따로 적는다.

function errorsOf<T extends { readonly severity: string }>(issues: readonly T[]): T[] {
  return issues.filter((issue) => issue.severity === "error");
}

test("composition.defined: the group module carries the composition and both manifests pass validation", () => {
  expect(helmGroup.manifest.group.composition).toEqual(helmComposition);
  expect(helmManifest.group.composition).toEqual(helmComposition);
  expect(errorsOf(validateManifest(helmGroup.manifest).issues)).toEqual([]);
  expect(errorsOf(validateManifest(helmManifest).issues)).toEqual([]);
  expect(errorsOf(validateComposition(helmComposition, { manifest: helmManifest }))).toEqual([]);
  expect(
    errorsOf(
      validateGroupDef({
        manifest: helmManifest,
        composition: helmComposition,
        state: helmStateDecl,
        settings: helmSettings,
      }),
    ),
  ).toEqual([]);
});

test("composition.phases: the declared phase transitions are the TRANSITIONS table, row for row", () => {
  const phases = helmComposition.phases;
  if (phases === undefined) throw new Error("helm declares no phases");
  expect(phases.initial).toBe("idle");
  expect(phases.nodes.map((node) => [node.id, node.kind])).toEqual([
    ["idle", "phase"],
    ["diverge", "phase"],
    ["explore", "phase"],
    ["converge", "phase"],
    ["apply", "phase"],
  ]);
  expect(phases.transitions.map((row) => [row.from, row.to, row.event])).toEqual([
    ["idle", "idle", "requested"],
    ["idle", "diverge", "leaseGranted"],
    ["idle", "idle", "stopRequested"],
    ["diverge", "explore", "diverged"],
    ["diverge", "idle", "stopRequested"],
    ["diverge", "idle", "limitReached"],
    ["diverge", "idle", "failed"],
    ["explore", "explore", "lensesStarted"],
    ["explore", "converge", "explored"],
    ["explore", "idle", "stopRequested"],
    ["explore", "idle", "limitReached"],
    ["explore", "idle", "failed"],
    ["converge", "apply", "converged"],
    ["converge", "idle", "stopRequested"],
    ["converge", "idle", "limitReached"],
    ["converge", "idle", "failed"],
    ["apply", "idle", "applied"],
    ["apply", "idle", "stopRequested"],
    ["apply", "idle", "limitReached"],
    ["apply", "idle", "failed"],
  ]);
});

test("composition.blocks: one drive block, hooks are the root plugin's hooks, produced kinds are Helm's record kinds", () => {
  const blocks = helmComposition.blocks;
  expect(blocks.map((block) => [block.id, block.op])).toEqual([
    ["input-lens", "on"],
    ["write-guard", "on"],
    ["tool-observe", "on"],
    ["signal-settle", "on"],
    ["restore", "on"],
    ["lease-rejected", "on"],
    ["command", "register"],
    ["methods", "register"],
    ["drive", "drive"],
  ]);
  const rootHooks = helmManifest.plugins[0]?.hooks ?? [];
  const hooks = blocks.flatMap((block) => block.hooks ?? []);
  expect(hooks.filter((hook) => !rootHooks.includes(hook))).toEqual([]);
  expect(hooks.toSorted()).toEqual([...rootHooks].toSorted());
  const kinds = blocks.flatMap((block) =>
    (block.produces ?? []).flatMap((product) =>
      product.kind === "record" ? [product.recordKind] : [],
    ),
  );
  const declared = new Set(HELM_RECORD_KINDS.map((decl) => decl.kind));
  expect(kinds.filter((kind) => !declared.has(kind))).toEqual([]);
  expect(kinds.toSorted()).toEqual([
    "grp.helm.discovery.recorded",
    "grp.helm.inquiry.finished",
    "grp.helm.inquiry.finished",
    "grp.helm.signal.detected",
  ]);
});

test("composition.negative: a declaration that names an undeclared hook or a missing phase is refused", () => {
  const badHook: CompositionDecl = {
    blocks: [{ id: "bad", stage: "inject", op: "on", hooks: ["input.user.before"] }],
  };
  expect(
    validateComposition(badHook, { manifest: helmManifest }).map((issue) => issue.code),
  ).toEqual(["hook_undeclared"]);
  const phases = helmComposition.phases;
  if (phases === undefined) throw new Error("helm declares no phases");
  const danglingStart: CompositionDecl = {
    blocks: helmComposition.blocks,
    phases: { ...phases, initial: "nowhere" },
  };
  expect(
    validateComposition(danglingStart, { manifest: helmManifest }).map((issue) => issue.code),
  ).toEqual(["phase_invalid"]);
});

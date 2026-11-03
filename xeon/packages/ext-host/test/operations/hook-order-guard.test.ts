// 훅 순서 덮어쓰기와 guard tier를 실제 조립으로 확인한다: 실제 createOperationsPolicy(admit이 assignTier로 등급을 준다),
// 실제 createExtHost, 실제 디스패처, 실제 훅 순서 상태. 2026-11-03 사용자 결정: guard도 덮어쓰기로 옮길 수 있다.
// 덮어쓰기가 없으면 guard가 맨 앞이다. 내장 core-tools(guard)가 아직 호스트에 없어서 이 층에서 증명한다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { FIRST_DENY, type ExtensionLayer, type HookName } from "@fresnel/contracts/extensions";
import {
  checkOrder,
  hookOrderOf,
  hookOrderValue,
  previewOrder,
  TIERS,
  type HookOrderMap,
  type OperationsPolicy,
  type OrderRow,
  type PreviewRef,
  type PreviewRow,
} from "../../src/operations/index.ts";
import { extReadViewOf, type ExtensionUnit } from "../../src/primitives/index.ts";
import type { TestHost } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

/** 순서 덮어쓰기 시험에 쓰는 tap 훅(페이로드가 단순하다) */
const TAP = "boundary.settle.after";
/** 건너뜀과 거부 시험에 쓰는 first·closed 훅 */
const FIRST = "tool.call.before";

const GUARD = TIERS.indexOf("guard");
const USER = TIERS.indexOf("user");
const BUILTIN = TIERS.indexOf("builtin");
const CORE = TIERS.indexOf("core");

/** 덮어쓰기가 없을 때의 실행 순서: guard가 먼저, 그다음 tier(사용자 → 내장), loadIndex 순 */
const DEFAULT_ORDER = ["core-tools", "user-a", "user-b", "plugin-c"];

interface Rig {
  readonly t: TestHost;
  readonly policy: OperationsPolicy;
  /** 저장된 설정 값. 이 객체의 hookOrder를 바꾸면 저장 값이 바뀐다(다음 단계 경계에서 적용) */
  readonly settings: { hookOrder?: HookOrderMap };
  /** boundary.settle.after 한 번 디스패치하고 실행된 핸들러 이름을 호출 순서대로 돌려준다 */
  settle(): Promise<string[]>;
  /** boundary.step.before 디스패치. 보류 중인 순서를 이때 적용한다 */
  stepBoundary(): Promise<void>;
}

function orderOf(ids: readonly string[]): HookOrderMap {
  return hookOrderOf({ [TAP]: ids });
}

/** 확장 하나의 단위. 두 훅 모두 등록하고, tap 훅은 이름을 호출 기록에 넣는다 */
function unitOf(
  name: string,
  loadIndex: number,
  layer: ExtensionLayer,
  builtin: boolean,
  calls: string[],
): ExtensionUnit {
  return makeUnit({ name, loadIndex, layer, builtin, hooks: [TAP, FIRST] }, (g) => {
    g.on(TAP, () => {
      calls.push(name);
    });
    g.on(FIRST, () => undefined);
  });
}

/** 실제 정책과 호스트를 조립하고 네 확장을 싣는다. 설치 순서는 로드 순서와 다르게 둔다 */
async function assemble(): Promise<Rig> {
  // 설정 값은 객체의 속성을 바꿔 교체한다. createStaticOperationsSettings가 읽을 때마다 현재 값을 본다
  const settings: { hookOrder?: HookOrderMap } = {};
  const { t, policy } = await createOperationsHarness({ settings });
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];

  // admit이 실제 assignTier로 등급을 준다. core-tools는 builtin 원천·신뢰라서 guard가 된다
  expect(
    policy.admit({ name: "plugin-c", source: "builtin", trust: "builtin", essential: false }, "L2"),
  ).toEqual({ ok: true, value: "builtin" });
  await t.host.install(unitOf("plugin-c", 3, "L2", true, calls));
  expect(
    policy.admit({ name: "user-b", source: "user", trust: "user", essential: false }, "plugin"),
  ).toEqual({ ok: true, value: "user" });
  await t.host.install(unitOf("user-b", 2, "plugin", false, calls));
  expect(
    policy.admit({ name: "user-a", source: "user", trust: "user", essential: false }, "plugin"),
  ).toEqual({ ok: true, value: "user" });
  await t.host.install(unitOf("user-a", 1, "plugin", false, calls));
  expect(
    policy.admit(
      { name: "core-tools", source: "builtin", trust: "builtin", essential: true },
      "L1",
    ),
  ).toEqual({ ok: true, value: "guard" });
  await t.host.install(unitOf("core-tools", 0, "L1", true, calls));

  // 적용 상태는 처음 읽을 때 원천 값을 든다. 설정을 바꾸기 전에 기본 순서를 먼저 읽어 둔다
  policy.hookOrder.applied(TAP);

  return {
    t,
    policy,
    settings,
    async settle() {
      calls.splice(0);
      const turnId = t.ids.next("trn");
      await t.host.dispatch(
        TAP,
        { turnId, aborted: false },
        { threadId: thread, dispatchKey: `${turnId}:${TAP}` },
      );
      return calls.splice(0);
    },
    async stepBoundary() {
      const stepId = t.ids.next("stp");
      await t.host.dispatch(
        "boundary.step.before",
        { stepIndex: 0, stepId, timestamp: 0 },
        { threadId: thread, dispatchKey: `${stepId}:boundary.step.before` },
      );
    },
  };
}

/** 읽기 조회의 한 훅 행을 검사 입력 행으로 옮긴다. tier는 조회가 준 실제 값이다 */
function rowsOf(t: TestHost, point: HookName): OrderRow[] {
  return extReadViewOf(t.host)
    .handlers()
    .filter((row) => row.point === point)
    .map((row) => ({ registrationId: row.scopeId, extension: row.extension, tier: row.tier }));
}

function refOf(name: string, tier: number): PreviewRef {
  return { registrationId: name, extension: name, tier };
}

test("hook order guard: the default order is guard, then user handlers by load index, then builtin", async () => {
  const rig = await assemble();
  expect(await rig.settle()).toEqual(DEFAULT_ORDER);
  expect(rig.policy.hookOrder.pending()).toBe(false);
});

test("hook order guard: a saved order can put a regular handler before the guard, and dispatch follows it at the step boundary", async () => {
  const rig = await assemble();
  expect(await rig.settle()).toEqual(DEFAULT_ORDER);

  rig.settings.hookOrder = orderOf(["user-a", "core-tools"]);
  expect(rig.policy.hookOrder.pending()).toBe(true);
  // 경계 전에는 기본 순서로 실행된다
  expect(await rig.settle()).toEqual(DEFAULT_ORDER);

  await rig.stepBoundary();
  expect(rig.policy.hookOrder.pending()).toBe(false);
  // user-a가 저장한 순서대로 guard보다 먼저 돈다. 이름이 없는 user-b와 plugin-c는 자리를 지킨다
  expect(await rig.settle()).toEqual(["user-a", "core-tools", "user-b", "plugin-c"]);
});

test("hook order guard: a saved order that names the guard last moves it to that last place", async () => {
  const rig = await assemble();
  rig.settings.hookOrder = orderOf(["plugin-c", "user-b", "user-a", "core-tools"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["plugin-c", "user-b", "user-a", "core-tools"]);
});

test("hook order guard: with no saved order the guard stays first, and clearing an override restores that order", async () => {
  const rig = await assemble();
  rig.settings.hookOrder = orderOf(["plugin-c", "core-tools"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["plugin-c", "user-a", "user-b", "core-tools"]);

  rig.settings.hookOrder = new Map();
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(DEFAULT_ORDER);
});

test("hook order guard: a stored value that names the guard in the middle runs it where the value puts it", async () => {
  // checkOrder를 거치지 않은 저장 값(손으로 고친 설정)을 가정한다. 디스패치는 저장 값을 그대로 따른다
  const rig = await assemble();
  rig.settings.hookOrder = orderOf(["user-b", "core-tools", "plugin-c", "user-a"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["user-b", "core-tools", "plugin-c", "user-a"]);
});

test("hook order guard: the read view lists the hook's handlers in the executed order and with the real tiers", async () => {
  const rig = await assemble();
  expect(rowsOf(rig.t, TAP).map((row) => row.registrationId)).toEqual(DEFAULT_ORDER);
  expect(await rig.settle()).toEqual(DEFAULT_ORDER);

  rig.settings.hookOrder = orderOf(["plugin-c", "user-b", "user-a"]);
  await rig.stepBoundary();
  const executed = await rig.settle();
  expect(executed).toEqual(["core-tools", "plugin-c", "user-b", "user-a"]);
  expect(rowsOf(rig.t, TAP)).toEqual([
    { registrationId: "core-tools", extension: "core-tools", tier: GUARD },
    { registrationId: "plugin-c", extension: "plugin-c", tier: BUILTIN },
    { registrationId: "user-b", extension: "user-b", tier: USER },
    { registrationId: "user-a", extension: "user-a", tier: USER },
  ]);
  expect(rowsOf(rig.t, TAP).map((row) => row.registrationId)).toEqual(executed);
});

test("hook order guard: checkOrder keeps the guard in the saved list, and the saved value moves it when applied", async () => {
  const rig = await assemble();
  expect(checkOrder(["user-a", "core-tools", "user-b", "plugin-c"])).toEqual([
    "user-a",
    "core-tools",
    "user-b",
    "plugin-c",
  ]);

  rig.settings.hookOrder = orderOf(["user-a", "core-tools"]);
  expect(hookOrderValue(rig.policy.hookOrder.saved())).toEqual({
    [TAP]: ["user-a", "core-tools"],
  });
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["user-a", "core-tools", "user-b", "plugin-c"]);
});

test("hook order guard: previewOrder exempts the guard from auto-disable and gives exact notes for the view's rows", async () => {
  const rig = await assemble();
  // 면제는 자동 끄기와 같은 tier(guard, core)로 정한다
  const exemptTiers = new Set<number>([GUARD, CORE]);
  const rows: PreviewRow[] = rowsOf(rig.t, FIRST).map((row) => ({
    registrationId: row.registrationId,
    extension: row.extension,
    tier: row.tier,
    exempt: exemptTiers.has(row.tier),
  }));
  expect(rows.find((row) => row.registrationId === "core-tools")?.exempt).toBe(true);

  const preview = previewOrder(FIRST, ["plugin-c", "user-b", "user-a"], rows);
  const core = refOf("core-tools", GUARD);
  const plugin = refOf("plugin-c", BUILTIN);
  const userB = refOf("user-b", USER);
  const userA = refOf("user-a", USER);
  expect(preview).toEqual({
    hook: FIRST,
    order: ["core-tools", "plugin-c", "user-b", "user-a"],
    skips: [
      {
        registrationId: "plugin-c",
        extension: "plugin-c",
        reason: "first_answer",
        by: [core],
      },
      {
        registrationId: "plugin-c",
        extension: "plugin-c",
        reason: "first_failure_deny",
        by: [core],
      },
      {
        registrationId: "user-b",
        extension: "user-b",
        reason: "first_answer",
        by: [core, plugin],
      },
      {
        registrationId: "user-b",
        extension: "user-b",
        reason: "first_failure_deny",
        by: [core, plugin],
      },
      {
        registrationId: "user-a",
        extension: "user-a",
        reason: "first_answer",
        by: [core, plugin, userB],
      },
      {
        registrationId: "user-a",
        extension: "user-a",
        reason: "first_failure_deny",
        by: [core, plugin, userB],
      },
    ],
    valueChanges: [],
    // core-tools는 면제라 노트가 없다. plugin-c와 user-b는 뒤에 핸들러가 있어 노트가 있다
    autoDisable: [
      {
        registrationId: "plugin-c",
        extension: "plugin-c",
        affects: [userB, userA],
      },
      {
        registrationId: "user-b",
        extension: "user-b",
        affects: [userA],
      },
    ],
    // guard가 맨 앞에 남으므로 건너뛰어질 수도 맨 앞을 잃을 수도 없다
    guardRisk: [],
  });
});

test("hook order guard: an override naming a removed user handler is ignored and the rest keep their order", async () => {
  const rig = await assemble();
  await rig.t.host.uninstall("user-a");
  rig.settings.hookOrder = orderOf(["plugin-c", "user-a", "user-b"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["core-tools", "plugin-c", "user-b"]);
});

test("hook order guard: when the guard is removed, an override naming it is ignored and the rest keep their order", async () => {
  const rig = await assemble();
  await rig.t.host.uninstall("core-tools");
  rig.settings.hookOrder = orderOf(["user-b", "core-tools", "user-a", "plugin-c"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["user-b", "user-a", "plugin-c"]);
});

test("hook order guard: when the guard is disabled, it does not run and an override naming it does not move the rest", async () => {
  const rig = await assemble();
  expect(rig.t.host.registration("core-tools")?.status).toBe("enabled");
  rig.t.host.registration("core-tools")?.disable();
  await rig.t.settled();
  expect(rig.t.host.registration("core-tools")?.status).toBe("disabled");

  rig.settings.hookOrder = orderOf(["user-b", "core-tools", "user-a", "plugin-c"]);
  await rig.stepBoundary();
  expect(await rig.settle()).toEqual(["user-b", "user-a", "plugin-c"]);
});

// ── first 훅에서 guard의 실패와 건너뜀 ─────────────────────────────────────────

interface FirstRig {
  readonly t: TestHost;
  readonly policy: OperationsPolicy;
  /** 저장된 설정 값. 이 객체의 hookOrder를 바꾸면 다음 단계 경계에서 적용된다 */
  readonly settings: { hookOrder?: HookOrderMap };
  /** 저장 값이 없을 때의 행(기본 순서). 미리보기 입력이다 */
  readonly defaultRows: readonly PreviewRow[];
  stepBoundary(): Promise<void>;
  /** tool.call.before를 한 번 디스패치한다. 결정, 결정한 핸들러, 그 호출에서 실행된 핸들러 이름을 돌려준다 */
  decide(): Promise<{
    readonly decision: unknown;
    readonly decidedBy: string | null;
    readonly calls: readonly string[];
  }>;
}

/** 결정할 수 있는 사용자 핸들러. decides가 참이면 `{ block: true }`로 결정하고, 아니면 아무것도 답하지 않는다 */
function firstUnitOf(
  name: string,
  loadIndex: number,
  calls: string[],
  decides: boolean,
): ExtensionUnit {
  return makeUnit({ name, loadIndex, layer: "plugin", builtin: false, hooks: [FIRST] }, (g) => {
    g.on(FIRST, () => {
      calls.push(name);
      return decides ? { block: true, reason: `decided by ${name}` } : undefined;
    });
  });
}

/** guard 대역. 실행되면 호출을 기록하고 예외를 던진다(실패) */
function failingGuardUnit(calls: string[]): ExtensionUnit {
  return makeUnit(
    { name: "core-tools", loadIndex: 0, layer: "L1", builtin: true, hooks: [FIRST] },
    (g) => {
      g.on(FIRST, () => {
        calls.push("core-tools");
        throw new Error("guard handler failed");
      });
    },
  );
}

function firstOrderOf(ids: readonly string[]): HookOrderMap {
  return hookOrderOf({ [FIRST]: ids });
}

async function firstRig(options: { readonly decider?: string } = {}): Promise<FirstRig> {
  const settings: { hookOrder?: HookOrderMap } = {};
  const { t, policy } = await createOperationsHarness({ settings });
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];

  expect(
    policy.admit({ name: "fold-a", source: "user", trust: "user", essential: false }, "plugin"),
  ).toEqual({ ok: true, value: "user" });
  await t.host.install(firstUnitOf("fold-a", 1, calls, options.decider === "fold-a"));
  expect(
    policy.admit({ name: "fold-b", source: "user", trust: "user", essential: false }, "plugin"),
  ).toEqual({ ok: true, value: "user" });
  await t.host.install(firstUnitOf("fold-b", 2, calls, options.decider === "fold-b"));
  expect(
    policy.admit(
      { name: "core-tools", source: "builtin", trust: "builtin", essential: true },
      "L1",
    ),
  ).toEqual({ ok: true, value: "guard" });
  await t.host.install(failingGuardUnit(calls));

  // 저장 값이 없을 때의 행을 먼저 잡고, 적용 상태도 기본 순서로 읽어 둔다
  const defaultRows: PreviewRow[] = rowsOf(t, FIRST).map((row) => ({
    registrationId: row.registrationId,
    extension: row.extension,
    tier: row.tier,
    exempt: row.tier === GUARD || row.tier === CORE,
  }));
  policy.hookOrder.applied(FIRST);

  return {
    t,
    policy,
    settings,
    defaultRows,
    async stepBoundary() {
      const stepId = t.ids.next("stp");
      await t.host.dispatch(
        "boundary.step.before",
        { stepIndex: 0, stepId, timestamp: 0 },
        { threadId: thread, dispatchKey: `${stepId}:boundary.step.before` },
      );
    },
    async decide() {
      calls.splice(0);
      const turnId = t.ids.next("trn");
      const outcome = await t.host.dispatch(
        FIRST,
        { toolCallId: `call_${turnId}`, toolName: "read", input: { path: "a" } },
        { threadId: thread, dispatchKey: `${turnId}:${FIRST}` },
      );
      return {
        decision: outcome.decision,
        decidedBy: outcome.decidedBy?.scopeId ?? null,
        calls: calls.splice(0),
      };
    },
  };
}

test("hook order guard: a guard that fails denies under the first fold wherever it sits, when it runs", async () => {
  const rig = await firstRig();
  // 기본 순서: guard가 맨 앞이라 실패하면 바로 거부다
  expect(await rig.decide()).toEqual({
    decision: FIRST_DENY[FIRST],
    decidedBy: "core-tools",
    calls: ["core-tools"],
  });

  // 저장한 순서: 사용자 핸들러 둘이 결정 없이 지나간 뒤 맨 뒤의 guard가 실패해도 거부다
  rig.settings.hookOrder = firstOrderOf(["fold-a", "fold-b", "core-tools"]);
  await rig.stepBoundary();
  expect(await rig.decide()).toEqual({
    decision: FIRST_DENY[FIRST],
    decidedBy: "core-tools",
    calls: ["fold-a", "fold-b", "core-tools"],
  });
});

test("hook order guard: a regular handler that decides before the guard skips it, and the preview reports the guard as skippable", async () => {
  const rig = await firstRig({ decider: "fold-a" });
  rig.settings.hookOrder = firstOrderOf(["fold-a", "core-tools", "fold-b"]);
  await rig.stepBoundary();

  const result = await rig.decide();
  // fold-a가 결정하면 guard는 실행되지 않는다(first_answer)
  expect(result.calls).toEqual(["fold-a"]);
  expect(result.decidedBy).toBe("fold-a");
  expect(result.decision).toEqual({ block: true, reason: "decided by fold-a" });

  // 저장 전 미리보기는 같은 위험을 guardRisk로 알린다. 저장은 막지 않는다
  const preview = previewOrder(FIRST, ["fold-a", "core-tools", "fold-b"], rig.defaultRows);
  expect(preview.order).toEqual(["fold-a", "core-tools", "fold-b"]);
  expect(preview.guardRisk).toEqual([
    {
      registrationId: "core-tools",
      extension: "core-tools",
      mayBeSkipped: true,
      losesFirstPosition: true,
      by: [refOf("fold-a", USER)],
    },
  ]);
});

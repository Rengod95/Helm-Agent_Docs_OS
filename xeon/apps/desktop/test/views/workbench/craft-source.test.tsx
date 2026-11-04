import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  INITIAL_WORKBENCH,
  listLoaded,
  markPending,
  ordersLoaded,
  snapshotOf,
} from "@fresnel/client/workbench";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  TraceFailureReason,
  TraceHandlerEntry,
  TraceHandlerResult,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import type { OrderPortError } from "@fresnel/client/workbench/canvas";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import type { MirrorInput } from "../../../src/state/engine/input.ts";
import { reduceMirror } from "../../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createWorkbenchStore, WorkbenchStoreContext } from "../../../src/state/workbench/index.ts";
import {
  CommandsContext,
  type Commands,
  type CommandError,
  type WorkbenchCommands,
} from "../../../src/views/commands.ts";
import type { CraftSource } from "../../../src/views/craft/craft-context.tsx";
import {
  commandErrorText,
  commandFailure,
  namesToToggle,
  orderPortOf,
  recentRunsOf,
  runEntriesOf,
  useCraftSource,
  withPending,
  type RequestToggle,
} from "../../../src/views/workbench/craft-source.ts";
import type { WorkbenchController } from "../../../src/views/workbench/controller.ts";
import { evt, harness, STORE, SUB, thr, trn } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { seededEngine } from "./support.tsx";

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 1,
    ...over,
  };
}

/** 그룹 `review`는 구성원 `review/lint` 하나를 가진다 */
const GROUP = entry("review", {
  isGroup: true,
  plugins: [
    { registrationId: "review", layer: "L2", status: "enabled", inGroup: true },
    { registrationId: "review/lint", id: "lint", layer: "L2", status: "enabled", inGroup: true },
  ],
});

const CORE = entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" });

const onOf = (snapshot: {
  readonly plugins: readonly { readonly id: string; readonly on: boolean }[];
}) => snapshot.plugins.map((p) => [p.id, p.on]);

describe("withPending: 대기 중인 확장은 목표 값으로 보인다", () => {
  const base = snapshotOf({
    entries: [entry("web"), CORE, GROUP],
    details: {},
    health: {},
  });

  test("대기 목표가 있는 확장의 플러그인만 바뀌고, 그룹 구성원은 함께 바뀐다", () => {
    expect(onOf(withPending(base, { web: false, review: false }))).toEqual([
      ["web", false],
      ["core-loop", true],
      ["review", false],
      ["review/lint", false],
    ]);
  });

  test("대기 표시가 없으면 스냅샷 값 그대로다", () => {
    expect(onOf(withPending(base, {}))).toEqual([
      ["web", true],
      ["core-loop", true],
      ["review", true],
      ["review/lint", true],
    ]);
  });
});

describe("namesToToggle: 확장 이름마다 한 번, 잠긴 확장과 모르는 확장은 뺀다", () => {
  const state = listLoaded(INITIAL_WORKBENCH, [entry("web"), CORE, GROUP]);

  test("구성원 id는 확장 이름으로 모이고, 잠긴 core와 모르는 이름은 빠진다", () => {
    expect(
      namesToToggle(state, ["web", "review/lint", "review", "core-loop", "ghost", "web"], false),
    ).toEqual(["web", "review"]);
  });
});

/** trace.turn의 핸들러 한 칸. 시각과 크기는 이 시험이 보지 않아 0으로 둔다 */
function handler(
  registrationId: string,
  ms: number,
  result: TraceHandlerResult,
  reason: TraceFailureReason | null = null,
): TraceHandlerEntry {
  return { registrationId, ms, result, atMs: 0, size: 0, skippedBy: null, reason };
}

describe("runEntriesOf: trace.turn을 이 플러그인의 최근 실행 줄로", () => {
  const trace: TraceTurnResult = {
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 1,
        hook: "tool.call.before",
        step: 0,
        handlers: [handler("web", 3, "passed"), handler("other", 9, "blocked")],
      },
      {
        seq: 2,
        hook: "boundary.settle.after",
        step: 1,
        handlers: [handler("web", 30000, "failed", "threw")],
      },
    ],
  };

  test("이 플러그인의 핸들러만 훅 순서대로 나오고 이유도 그대로 옮긴다", () => {
    expect(runEntriesOf(trace, "web")).toEqual([
      { hook: "tool.call.before", registrationId: "web", ms: 3, result: "passed", reason: null },
      {
        hook: "boundary.settle.after",
        registrationId: "web",
        ms: 30000,
        result: "failed",
        reason: "threw",
      },
    ]);
  });

  test("이 턴에 이 플러그인의 기록이 없으면 빈 목록이다(null이 아니다)", () => {
    expect(runEntriesOf(trace, "nobody")).toEqual([]);
  });

  test("계측이 꺼져 있거나 링 버퍼에서 밀렸으면 null이다", () => {
    expect(
      runEntriesOf({ ...trace, traceEnabled: false, retained: false, entries: [] }, "web"),
    ).toBeNull();
    expect(runEntriesOf({ ...trace, retained: false, entries: [] }, "web")).toBeNull();
  });
});

/** `trace`만 바꾼 명령 대역. 불린 대화·턴 id를 `calls`에 쌓는다 */
function recording(result: Result<TraceTurnResult, CommandError>): {
  readonly workbench: WorkbenchCommands;
  readonly commands: Commands;
  readonly calls: { threadId: string; turnId: string }[];
} {
  const calls: { threadId: string; turnId: string }[] = [];
  const commands = fakeCommands({
    workbench: {
      ...fakeCommands().workbench,
      trace: (threadId, turnId) => {
        calls.push({ threadId, turnId });
        return Promise.resolve(result);
      },
    },
  });
  return { workbench: commands.workbench, commands, calls };
}

describe("recentRunsOf: 열린 대화와 턴 id가 있을 때만 trace.turn을 부른다", () => {
  const trace: TraceTurnResult = {
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 1,
        hook: "tool.call.before",
        step: 0,
        handlers: [handler("web", 3, "passed")],
      },
    ],
  };

  test("대화나 턴 id가 없으면 호출 없이 null이다", async () => {
    const { workbench, calls } = recording(ok(trace));
    expect(await recentRunsOf(workbench, null, trn(1), "web")).toBeNull();
    expect(await recentRunsOf(workbench, thr(1), null, "web")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("대화와 턴이 있으면 두 id로 한 번 부르고 이 플러그인의 줄을 돌려준다", async () => {
    const { workbench, calls } = recording(ok(trace));
    expect(await recentRunsOf(workbench, thr(1), trn(1), "web")).toEqual([
      { hook: "tool.call.before", registrationId: "web", ms: 3, result: "passed", reason: null },
    ]);
    expect(calls).toEqual([{ threadId: thr(1), turnId: trn(1) }]);
  });

  test("명령이 실패하면 거부한다. 거부는 null(계측 잠김)과 다른 값이다", async () => {
    const { workbench } = recording(err({ kind: "unsupported" }));
    const reason = await recentRunsOf(workbench, thr(1), trn(1), "web").then(
      () => null,
      (caught: unknown) => (caught instanceof Error ? caught.message : "not an Error"),
    );
    expect(reason).toBe("unsupported");
  });
});

describe("명령 실패의 글과 거부 값", () => {
  test("kind와 코드가 글이 되고, 거부 오류는 원래 값을 cause에 남긴다", () => {
    expect(commandErrorText({ kind: "rejected", code: 3102 })).toBe("rejected:3102");
    expect(commandErrorText({ kind: "rejected", code: null })).toBe("rejected:null");
    expect(commandErrorText({ kind: "locked", ownerKind: "cli", options: [] })).toBe("locked:cli");
    expect(commandErrorText({ kind: "switching" })).toBe("switching");
    const failure = commandFailure({ kind: "failed" });
    expect([failure.message, failure.cause]).toEqual(["failed", { kind: "failed" }]);
  });
});

describe("orderPortOf: 명령 결과를 포트 계약으로 옮긴다", () => {
  test("읽기와 미리보기는 성공 값을 ok로 돌려준다", async () => {
    const body = { hooks: [{ hook: "h", saved: [], applied: ["a"], pending: false }] };
    const preview = {
      hook: "h",
      order: ["b", "a"],
      saveable: true,
      skips: [],
      valueChanges: [],
      autoDisable: [],
      guardRisk: [],
    };
    const workbench = fakeCommands({
      workbench: {
        ...fakeCommands().workbench,
        orderGet: () => Promise.resolve(ok(body)),
        orderPreview: () => Promise.resolve(ok(preview)),
      },
    }).workbench;
    const port = orderPortOf(workbench, () => undefined);
    expect(await port.get()).toEqual(ok(body));
    expect(await port.preview({ hook: "h", order: ["b", "a"] })).toEqual(ok(preview));
  });

  test("쓰기가 성공하면 afterWrite를 부르고, 실패하면 err 값을 돌려주며 afterWrite는 부르지 않는다", async () => {
    const wrote: string[] = [];
    const workbench = fakeCommands({
      workbench: {
        ...fakeCommands().workbench,
        orderSet: (hook, order) =>
          hook === "fails"
            ? Promise.resolve(err({ kind: "locked", ownerKind: "cli", options: [] }))
            : Promise.resolve(ok({ hook, saved: [...order], appliesAt: "nextStepBoundary" })),
        orderReset: (hook) =>
          hook === "fails"
            ? Promise.resolve(err({ kind: "failed" }))
            : Promise.resolve(ok({ hooks: [], appliesAt: "nextStepBoundary" })),
      },
    }).workbench;
    const port = orderPortOf(workbench, () => {
      wrote.push("after");
    });
    expect(await port.set({ hook: "h", order: ["a"] })).toEqual(
      ok({ hook: "h", saved: ["a"], appliesAt: "nextStepBoundary" }),
    );
    expect(wrote).toEqual(["after"]);
    expect(await port.set({ hook: "fails", order: [] })).toEqual(
      err({ kind: "locked", ownerKind: "cli" }),
    );
    expect(await port.reset({ hook: "fails" })).toEqual(err({ kind: "failed" }));
    expect(wrote).toEqual(["after"]);
  });

  test("명령 실패의 종류와 값을 포트 오류로 옮긴다(locked의 선택지 목록만 뺀다)", async () => {
    const cases: readonly (readonly [CommandError, OrderPortError])[] = [
      [{ kind: "offline" }, { kind: "offline" }],
      [{ kind: "unsupported" }, { kind: "unsupported" }],
      [
        { kind: "locked", ownerKind: "cli", options: [] },
        { kind: "locked", ownerKind: "cli" },
      ],
      [
        { kind: "rejected", code: 3102, detail: "bad value" },
        { kind: "rejected", code: 3102, detail: "bad value" },
      ],
      [
        { kind: "rejected", code: null },
        { kind: "rejected", code: null },
      ],
      [{ kind: "failed" }, { kind: "failed" }],
      [{ kind: "switching" }, { kind: "switching" }],
    ];
    const previews = await Promise.all(
      cases.map(([failure]) => {
        const workbench = fakeCommands({
          workbench: {
            ...fakeCommands().workbench,
            orderPreview: () => Promise.resolve(err(failure)),
          },
        }).workbench;
        return orderPortOf(workbench, () => undefined).preview({ hook: "h", order: [] });
      }),
    );
    expect(previews).toStrictEqual(cases.map(([, expected]) => err(expected)));
  });

  test("reset은 hook을 생략하면 undefined를, 주면 그 훅을 명령에 넘긴다", async () => {
    const seen: (string | null)[] = [];
    const workbench = fakeCommands({
      workbench: {
        ...fakeCommands().workbench,
        orderReset: (hook) => {
          seen.push(hook ?? null);
          return Promise.resolve(ok({ hooks: [], appliesAt: "nextStepBoundary" }));
        },
      },
    }).workbench;
    const port = orderPortOf(workbench, () => undefined);
    await port.reset({});
    await port.reset({ hook: "h" });
    expect(seen).toEqual([null, "h"]);
  });
});

/**
 * 열린 대화(`threadId`)에 turn.started 사실 하나를 넣은 엔진 거울의 읽기 면. 서버 렌더는 스토어의 처음 상태를 읽으므로
 * 엔진 거울의 처음 상태 자체를 이 입력들로 만든다(reducer 순서 그대로).
 */
function engineWithTurn(threadId: ThreadId, turnId: TurnId): ReadonlyStore<EngineMirror> {
  const inputs: readonly MirrorInput[] = [
    { type: "subscribed", sub: SUB, storeId: STORE, start: 5, live: true, from: "head" },
    { type: "transcript_opening", threadId },
    { type: "transcript", threadId, asOfSeq: 5, items: [] },
    {
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "turn.started",
          seq: 6,
          eventId: evt(6),
          threadId,
          turnId,
          at: "2026-11-04T10:00:00.000Z",
        },
      ],
    },
  ];
  return seededEngine(
    inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR),
  );
}

/** 원천을 한 번 그려 얻는다. 효과 없이 읽기만 하는 훅이라 서버 렌더로 충분하다 */
function sourceOf(
  store: ReturnType<typeof createWorkbenchStore>,
  request: RequestToggle,
  controller: WorkbenchController,
  engine: ReadonlyStore<EngineMirror> = harness().store.read,
  commands: Commands = fakeCommands(),
): CraftSource {
  const seen: { source: CraftSource | null } = { source: null };
  function Probe(): ReactNode {
    seen.source = useCraftSource(controller, request);
    return null;
  }
  renderToString(
    <EngineStoreContext value={engine}>
      <CommandsContext value={commands}>
        <WorkbenchStoreContext value={store}>
          <Probe />
        </WorkbenchStoreContext>
      </CommandsContext>
    </EngineStoreContext>,
  );
  if (seen.source === null) throw new Error("probe did not render");
  return seen.source;
}

const noop = (): Promise<void> => Promise.resolve();
const refuse = (): Promise<boolean> => Promise.resolve(false);

describe("useCraftSource: 스토어와 명령에서 원천을 만든다", () => {
  const controller: WorkbenchController = {
    reload: noop,
    reloadOrders: noop,
    toggle: noop,
    reenable: noop,
    keepOff: noop,
    applyProfile: refuse,
  };

  test("스냅샷은 대기 표시를 덮고, 순서와 빌더 요청은 스토어를 따르며, 켜기는 잠긴 확장을 뺀다", async () => {
    // 서버 렌더는 스토어의 처음 상태를 읽으므로(zustand getInitialState) 대기 표시와 순서를 처음 상태에 넣는다
    const store = createWorkbenchStore((s) =>
      ordersLoaded(markPending(listLoaded(s, [entry("web"), CORE]), "web", false), {
        "tool.call.before": ["core-loop", "web"],
      }),
    );
    const requests: [string, boolean][] = [];
    const source = sourceOf(
      store,
      (name, target) => {
        requests.push([name, target]);
      },
      controller,
    );

    expect(onOf(source.snapshot)).toEqual([
      ["web", false],
      ["core-loop", true],
    ]);
    expect(source.order).toEqual({ "tool.call.before": ["core-loop", "web"] });

    await source.setOn(["web", "core-loop"], false);
    expect(requests).toEqual([["web", false]]);

    source.openBuilder("tool.call.before");
    expect(store.actions.snapshot().builder).toEqual({ hook: "tool.call.before" });
  });

  test("열린 대화가 없으면 최근 실행은 null이다", async () => {
    const store = createWorkbenchStore((s) => listLoaded(s, [entry("web")]));
    const source = sourceOf(store, () => undefined, controller);
    expect(await source.recentRuns("web")).toBeNull();
  });

  test("열린 대화의 가장 최근 turn으로 trace.turn을 읽어 이 플러그인의 최근 실행을 준다", async () => {
    const trace: TraceTurnResult = {
      traceEnabled: true,
      retained: true,
      entries: [
        {
          seq: 1,
          hook: "tool.call.before",
          step: 0,
          handlers: [handler("web", 3, "passed"), handler("other", 9, "blocked")],
        },
      ],
    };
    const { commands, calls } = recording(ok(trace));
    const store = createWorkbenchStore((s) => listLoaded(s, [entry("web")]));
    const source = sourceOf(
      store,
      () => undefined,
      controller,
      engineWithTurn(thr(1), trn(2)),
      commands,
    );
    expect(await source.recentRuns("web")).toEqual([
      { hook: "tool.call.before", registrationId: "web", ms: 3, result: "passed", reason: null },
    ]);
    expect(calls).toEqual([{ threadId: thr(1), turnId: trn(2) }]);
  });
});

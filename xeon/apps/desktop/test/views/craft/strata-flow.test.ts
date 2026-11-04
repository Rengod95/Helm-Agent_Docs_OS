import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type {
  HookOrderPort,
  HookOrderState,
  OrderPortError,
} from "@fresnel/client/workbench/canvas";
import type {
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import {
  keyReorder,
  requestReorder,
  saveConfirmed,
  readOrderView,
  warningsOf,
  type ReorderStep,
} from "../../../src/views/craft/strata-flow.ts";

type Call =
  | { readonly op: "preview"; readonly hook: string; readonly order: readonly string[] }
  | { readonly op: "set"; readonly hook: string; readonly order: readonly string[] };

interface FakeOptions {
  /** 미리보기에 실을 경고. 없으면 아무 것도 없는 깨끗한 제안이다 */
  readonly preview?: Partial<Omit<HooksOrderPreviewResult, "hook" | "order">>;
  /** 있으면 미리보기가 이 오류 값을 err로 돌려준다 */
  readonly previewError?: OrderPortError;
  /** 있으면 저장이 이 오류 값을 err로 돌려준다 */
  readonly setError?: OrderPortError;
}

const nameOf = (id: string): string => `name:${id}`;

/** 호출을 기록하는 가짜 포트. get과 reset은 이 흐름에서 쓰지 않는다 */
function fakePort(opts: FakeOptions = {}): { port: HookOrderPort; calls: Call[] } {
  const calls: Call[] = [];
  const port: HookOrderPort = {
    get: () => Promise.reject(new Error("get is not used by the reorder flow")),
    set: (params): Promise<Result<HooksOrderSetResult, OrderPortError>> => {
      calls.push({ op: "set", hook: params.hook, order: [...params.order] });
      if (opts.setError !== undefined) return Promise.resolve(err(opts.setError));
      return Promise.resolve(
        ok({
          hook: params.hook,
          saved: [...params.order],
          appliesAt: "nextStepBoundary",
        }),
      );
    },
    reset: (): Promise<Result<HooksOrderResetResult, OrderPortError>> =>
      Promise.reject(new Error("reset is not used by the reorder flow")),
    preview: (params): Promise<Result<HooksOrderPreviewResult, OrderPortError>> => {
      calls.push({ op: "preview", hook: params.hook, order: [...params.order] });
      if (opts.previewError !== undefined) return Promise.resolve(err(opts.previewError));
      return Promise.resolve(
        ok({
          hook: params.hook,
          order: [...params.order],
          saveable: true,
          skips: [],
          valueChanges: [],
          autoDisable: [],
          guardRisk: [],
          ...opts.preview,
        }),
      );
    },
  };
  return { port, calls };
}

/** 흐름이 돌려준 단계. err면 시험을 실패시킨다 */
function stepOf(r: Result<ReorderStep, OrderPortError>): ReorderStep {
  if (!r.ok) throw new Error(`expected a step, got ${r.error.kind}`);
  return r.value;
}

const guardFirstLost: Partial<Omit<HooksOrderPreviewResult, "hook" | "order">> = {
  guardRisk: [
    {
      registrationId: "guard.scan",
      extension: "guard",
      mayBeSkipped: false,
      losesFirstPosition: true,
      by: [],
    },
  ],
};

describe("requestReorder", () => {
  test("(a) a no-op drop makes zero port calls", async () => {
    const { port, calls } = fakePort();
    const result = await requestReorder(
      port,
      "tool.call.before",
      ["a", "b", "c"],
      ["a", "b", "c"],
      nameOf,
    );
    expect(result).toEqual(ok({ k: "unchanged" }));
    expect(calls).toEqual([]);
  });

  test("(b) a benign move previews, then sets exactly that order", async () => {
    const { port, calls } = fakePort();
    const result = await requestReorder(
      port,
      "tool.result",
      ["a", "b", "c"],
      ["b", "a", "c"],
      nameOf,
    );
    expect(calls).toEqual([
      { op: "preview", hook: "tool.result", order: ["b", "a", "c"] },
      { op: "set", hook: "tool.result", order: ["b", "a", "c"] },
    ]);
    expect(result).toEqual(
      ok({
        k: "saved",
        hook: "tool.result",
        committed: { saved: ["b", "a", "c"], appliesAt: "nextStepBoundary" },
      }),
    );
  });

  test("(c) a guard that loses the first position previews and does not set until confirmed", async () => {
    const { port, calls } = fakePort({ preview: guardFirstLost });
    const step = stepOf(
      await requestReorder(
        port,
        "tool.call.before",
        ["scan", "guard.scan"],
        ["guard.scan", "scan"],
        nameOf,
      ),
    );
    expect(calls).toEqual([
      { op: "preview", hook: "tool.call.before", order: ["guard.scan", "scan"] },
    ]);
    expect(step.k).toBe("confirm");
    if (step.k !== "confirm") throw new Error("expected a confirm step");
    expect(step.order).toEqual(["guard.scan", "scan"]);
    expect(step.warning.severity).toBe("guard");
    expect(step.warning.guardLosesFirst).toEqual(["name:guard.scan"]);

    const committed = await saveConfirmed(port, step);
    expect(calls).toEqual([
      { op: "preview", hook: "tool.call.before", order: ["guard.scan", "scan"] },
      { op: "set", hook: "tool.call.before", order: ["guard.scan", "scan"] },
    ]);
    expect(committed).toEqual(ok({ saved: ["guard.scan", "scan"], appliesAt: "nextStepBoundary" }));
  });

  test("(d) cancelling the confirm never sets", async () => {
    const { port, calls } = fakePort({ preview: guardFirstLost });
    const step = stepOf(
      await requestReorder(
        port,
        "tool.call.before",
        ["scan", "guard.scan"],
        ["guard.scan", "scan"],
        nameOf,
      ),
    );
    // 취소는 저장 호출을 하지 않고 확인 상태만 버린다
    expect(step.k).toBe("confirm");
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
  });

  test("a skip warning (not guard) also asks before setting", async () => {
    const { port, calls } = fakePort({
      preview: {
        skips: [
          {
            registrationId: "late",
            extension: "x",
            reason: "first_answer",
            by: [{ registrationId: "early", extension: "y", tier: 1 }],
          },
        ],
      },
    });
    const step = stepOf(
      await requestReorder(port, "tool.call.before", ["late", "early"], ["early", "late"], nameOf),
    );
    expect(step.k).toBe("confirm");
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
    if (step.k !== "confirm") throw new Error("expected a confirm step");
    expect(step.warning.severity).toBe("skip");
    expect(step.warning.skipped).toEqual([
      {
        registrationId: "late",
        name: "name:late",
        reason: "first_answer",
        by: ["name:early"],
      },
    ]);
  });

  test("a value-change note alone asks before setting", async () => {
    const { port, calls } = fakePort({
      preview: { valueChanges: [{ registrationId: "patch", extension: "p", by: [] }] },
    });
    const step = stepOf(await requestReorder(port, "tool.result", ["a", "b"], ["b", "a"], nameOf));
    expect(step.k).toBe("confirm");
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
  });

  test("a port err on preview comes back as the value and nothing is saved", async () => {
    const { port, calls } = fakePort({ previewError: { kind: "offline" } });
    const result = await requestReorder(port, "tool.result", ["a", "b"], ["b", "a"], nameOf);
    expect(result).toEqual(err({ kind: "offline" }));
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
  });

  test("a port err on the save comes back as the value", async () => {
    const { port, calls } = fakePort({ setError: { kind: "locked", ownerKind: "cli" } });
    const result = await requestReorder(port, "tool.result", ["a", "b"], ["b", "a"], nameOf);
    expect(result).toEqual(err({ kind: "locked", ownerKind: "cli" }));
    expect(calls.map((c) => c.op)).toEqual(["preview", "set"]);
  });
});

describe("saveConfirmed", () => {
  test("a port err on the confirmed save comes back as the value", async () => {
    const { port, calls } = fakePort({ preview: guardFirstLost, setError: { kind: "failed" } });
    const step = stepOf(
      await requestReorder(
        port,
        "tool.call.before",
        ["scan", "guard.scan"],
        ["guard.scan", "scan"],
        nameOf,
      ),
    );
    if (step.k !== "confirm") throw new Error("expected a confirm step");

    expect(await saveConfirmed(port, step)).toEqual(err({ kind: "failed" }));
    expect(calls.map((c) => c.op)).toEqual(["preview", "set"]);
  });
});

describe("keyReorder (Alt+ArrowLeft/Right on a handler pill)", () => {
  test("Alt+ArrowRight moves the pill one step right and the flow previews it exactly once", async () => {
    const { port, calls } = fakePort();
    const next = keyReorder({ key: "ArrowRight", altKey: true }, ["a", "b", "c"], "a");
    expect(next).toEqual(["b", "a", "c"]);
    if (next === null) throw new Error("expected a moved order");
    await requestReorder(port, "tool.result", ["a", "b", "c"], next, nameOf);
    expect(calls.filter((c) => c.op === "preview")).toEqual([
      { op: "preview", hook: "tool.result", order: ["b", "a", "c"] },
    ]);
  });

  test("Alt+ArrowLeft moves one step left", () => {
    expect(keyReorder({ key: "ArrowLeft", altKey: true }, ["a", "b", "c"], "c")).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  test("without Alt, or at the end of the row, there is no move", () => {
    expect(keyReorder({ key: "ArrowRight", altKey: false }, ["a", "b"], "a")).toBeNull();
    expect(keyReorder({ key: "ArrowRight", altKey: true }, ["a", "b"], "b")).toBeNull();
    expect(keyReorder({ key: "ArrowLeft", altKey: true }, ["a", "b"], "a")).toBeNull();
    expect(keyReorder({ key: "Enter", altKey: true }, ["a", "b"], "a")).toBeNull();
  });
});

/** 저장과 적용이 같은 순서이고 적용 중인 상태 */
const applied = (order: readonly string[]): HookOrderState => ({
  applied: order,
  saved: order,
  pending: false,
});

/** 허용 뒤의 거부가 건너뛰어지는 미리보기 결과 */
const SKIP_BY_ALLOW: Partial<Omit<HooksOrderPreviewResult, "hook" | "order">> = {
  skips: [
    {
      registrationId: "deny",
      extension: "x",
      reason: "first_answer",
      by: [{ registrationId: "allow", extension: "x", tier: 1 }],
    },
  ],
};

describe("warningsOf (the warning of the order in effect, per hook)", () => {
  test("previews only the applied order of saved, not-pending hooks with two or more handlers", async () => {
    const { port, calls } = fakePort({ preview: SKIP_BY_ALLOW });
    const orders: Record<string, HookOrderState> = {
      "tool.call.before": applied(["allow", "deny"]),
      "thread.start": applied(["allow"]),
      "input.user.before": { applied: ["allow", "deny"], saved: [], pending: false },
      "tool.result": { applied: ["deny", "allow"], saved: ["allow", "deny"], pending: true },
    };
    const r = await warningsOf(port, orders, nameOf);
    expect(calls).toEqual([{ op: "preview", hook: "tool.call.before", order: ["allow", "deny"] }]);
    expect(r.ok).toEqual(true);
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.value)).toEqual(["tool.call.before"]);
    expect(r.value["tool.call.before"]?.skipped.map((s) => s.name)).toEqual(["name:deny"]);
    expect(r.value["tool.call.before"]?.skipped[0]?.by).toEqual(["name:allow"]);
  });

  test("with no saved override (the default order) there is nothing to warn about and no call is made", async () => {
    const { port, calls } = fakePort({ preview: SKIP_BY_ALLOW });
    const defaultOrder: HookOrderState = { applied: ["allow", "deny"], saved: [], pending: false };
    const r = await warningsOf(port, { "tool.call.before": defaultOrder }, nameOf);
    expect(calls).toEqual([]);
    expect(r).toEqual(ok({}));
  });

  test("a clean order gives a none warning for its hook", async () => {
    const { port } = fakePort();
    const r = await warningsOf(port, { "tool.call.before": applied(["allow", "deny"]) }, nameOf);
    expect(r).toEqual(
      ok({
        "tool.call.before": {
          severity: "none",
          skipped: [],
          guardLosesFirst: [],
          guardMayBeSkipped: [],
          valueChanges: [],
          autoDisable: [],
        },
      }),
    );
  });

  test("a port err on a preview comes back as the value", async () => {
    const { port } = fakePort({ previewError: { kind: "offline" } });
    const r = await warningsOf(port, { "tool.call.before": applied(["allow", "deny"]) }, nameOf);
    expect(r).toEqual(err({ kind: "offline" }));
  });
});

describe("readOrderView (the saved orders and their warnings, read together)", () => {
  test("reads the saved state, then the warning of the order in effect", async () => {
    const base = fakePort({ preview: SKIP_BY_ALLOW });
    const port: HookOrderPort = {
      ...base.port,
      get: () =>
        Promise.resolve(
          ok({
            hooks: [
              {
                hook: "tool.call.before",
                saved: ["allow", "deny"],
                applied: ["allow", "deny"],
                pending: false,
              },
            ],
          }),
        ),
    };
    const r = await readOrderView(port, nameOf);
    expect(base.calls).toEqual([
      { op: "preview", hook: "tool.call.before", order: ["allow", "deny"] },
    ]);
    expect(r).toEqual(
      ok({
        orders: {
          "tool.call.before": {
            applied: ["allow", "deny"],
            saved: ["allow", "deny"],
            pending: false,
          },
        },
        warnings: {
          "tool.call.before": {
            severity: "skip",
            skipped: [
              {
                registrationId: "deny",
                name: "name:deny",
                reason: "first_answer",
                by: ["name:allow"],
              },
            ],
            guardLosesFirst: [],
            guardMayBeSkipped: [],
            valueChanges: [],
            autoDisable: [],
          },
        },
      }),
    );
  });

  test("a get err comes back as the value, and no preview is made", async () => {
    const base = fakePort();
    const port: HookOrderPort = {
      ...base.port,
      get: () => Promise.resolve(err({ kind: "offline" })),
    };
    expect(await readOrderView(port, nameOf)).toEqual(err({ kind: "offline" }));
    expect(base.calls).toEqual([]);
  });
});

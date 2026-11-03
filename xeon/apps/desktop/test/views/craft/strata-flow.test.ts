import { describe, expect, test } from "bun:test";
import type {
  HookOrderPort,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
} from "@fresnel/client/workbench/canvas";
import {
  keyReorder,
  requestReorder,
  saveConfirmed,
  type ReorderStep,
} from "../../../src/views/craft/strata-flow.ts";

type Call =
  | { readonly op: "preview"; readonly hook: string; readonly order: readonly string[] }
  | { readonly op: "set"; readonly hook: string; readonly order: readonly string[] };

interface FakeOptions {
  /** 미리보기에 실을 경고. 없으면 아무 것도 없는 깨끗한 제안이다 */
  readonly preview?: Partial<Omit<HooksOrderPreviewResult, "hook" | "order">>;
  readonly previewError?: string;
}

const nameOf = (id: string): string => `name:${id}`;

/** 호출을 기록하는 가짜 포트. get과 reset은 이 흐름에서 쓰지 않는다 */
function fakePort(opts: FakeOptions = {}): { port: HookOrderPort; calls: Call[] } {
  const calls: Call[] = [];
  const port: HookOrderPort = {
    get: () => Promise.reject(new Error("get is not used by the reorder flow")),
    set: (params): Promise<HooksOrderSetResult> => {
      calls.push({ op: "set", hook: params.hook, order: [...params.order] });
      return Promise.resolve({
        hook: params.hook,
        saved: [...params.order],
        appliesAt: "nextStepBoundary",
      });
    },
    reset: (): Promise<HooksOrderResetResult> =>
      Promise.reject(new Error("reset is not used by the reorder flow")),
    preview: (params): Promise<HooksOrderPreviewResult> => {
      calls.push({ op: "preview", hook: params.hook, order: [...params.order] });
      if (opts.previewError !== undefined) return Promise.reject(new Error(opts.previewError));
      return Promise.resolve({
        hook: params.hook,
        order: [...params.order],
        saveable: true,
        skips: [],
        valueChanges: [],
        autoDisable: [],
        guardRisk: [],
        ...opts.preview,
      });
    },
  };
  return { port, calls };
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
    const step = await requestReorder(
      port,
      "tool.call.before",
      ["a", "b", "c"],
      ["a", "b", "c"],
      nameOf,
    );
    expect(step).toEqual({ k: "unchanged" });
    expect(calls).toEqual([]);
  });

  test("(b) a benign move previews, then sets exactly that order", async () => {
    const { port, calls } = fakePort();
    const step = await requestReorder(
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
    expect(step).toEqual({
      k: "saved",
      hook: "tool.result",
      committed: { saved: ["b", "a", "c"], appliesAt: "nextStepBoundary" },
    });
  });

  test("(c) a guard that loses the first position previews and does not set until confirmed", async () => {
    const { port, calls } = fakePort({ preview: guardFirstLost });
    const step: ReorderStep = await requestReorder(
      port,
      "tool.call.before",
      ["scan", "guard.scan"],
      ["guard.scan", "scan"],
      nameOf,
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
    expect(committed).toEqual({ saved: ["guard.scan", "scan"], appliesAt: "nextStepBoundary" });
  });

  test("(d) cancelling the confirm never sets", async () => {
    const { port, calls } = fakePort({ preview: guardFirstLost });
    const step = await requestReorder(
      port,
      "tool.call.before",
      ["scan", "guard.scan"],
      ["guard.scan", "scan"],
      nameOf,
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
    const step = await requestReorder(
      port,
      "tool.call.before",
      ["late", "early"],
      ["early", "late"],
      nameOf,
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
    const step = await requestReorder(port, "tool.result", ["a", "b"], ["b", "a"], nameOf);
    expect(step.k).toBe("confirm");
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
  });

  test("a port error on preview is not swallowed", async () => {
    const { port, calls } = fakePort({ previewError: "wire down" });
    const error = await requestReorder(port, "tool.result", ["a", "b"], ["b", "a"], nameOf).then(
      () => "no error",
      (cause: unknown) => (cause instanceof Error ? cause.message : "not an Error"),
    );
    expect(error).toBe("wire down");
    expect(calls.map((c) => c.op)).toEqual(["preview"]);
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

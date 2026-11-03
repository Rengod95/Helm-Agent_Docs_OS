import { describe, expect, test } from "bun:test";
import { buildFixture, FIXTURE_ORDER, type CanvasPlugin } from "@fresnel/client/workbench/canvas";
import type { CraftRunEntry, CraftSource } from "../../../src/views/craft/craft-context.tsx";
import {
  activeMoments,
  columnsFor,
  loadRuns,
  MOMENTS,
  momentsFor,
  outcomeOf,
  runOverlay,
  timeLabel,
  TOOL_RUN,
} from "../../../src/views/craft/turn-flow.ts";

const snap = buildFixture(18);

function plugin(id: string): CanvasPlugin {
  const p = snap.plugins.find((x) => x.id === id);
  if (p === undefined) throw new Error(`fixture has no plugin ${id}`);
  return p;
}

/** 비교하기 쉬운 모양: [순간, 동사, 받는 값, 넘기는 값, 앞, 다음] */
function brief(parts: ReturnType<typeof momentsFor>): unknown[] {
  return parts.map((p) => [p.moment, p.verb, p.gets, p.hands, p.from, p.to]);
}

describe("생명선 순간", () => {
  test("14개이고 훅 13개 순서에 도구 실행이 tool.call.before 뒤에 끼어 있다", () => {
    expect(MOMENTS.map((m) => m.id)).toEqual([
      "thread.start",
      "input.user.before",
      "input.agent.before",
      "thread.compact.before",
      "request.provider.before",
      "guard.model.before",
      "request.model.after",
      "tool.call.before",
      "tool.run",
      "tool.result",
      "tool.execution.after",
      "boundary.step.after",
      "boundary.settle.after",
      "thread.shutdown",
    ]);
    expect(TOOL_RUN).toBe("tool.run");
  });

  test("도구 실행 순간만 fold가 없다", () => {
    const without = MOMENTS.filter((m) => m.fold === null).map((m) => m.id);
    expect(without).toEqual(["tool.run"]);
  });
});

describe("momentsFor: 플러그인이 끼는 순간", () => {
  test("helm은 순간 5개(순서 덮어쓰기 적용): 동사는 fold에서, 앞·다음은 줄 순서에서", () => {
    expect(brief(momentsFor(plugin("helm"), snap, FIXTURE_ORDER))).toEqual([
      ["thread.start", "observe", "thread", "unchanged", null, null],
      ["input.agent.before", "merge", "agent-input", "merged", null, "review/lens"],
      ["tool.call.before", "block", "tool-call", "decision", "secret-scan", null],
      ["tool.execution.after", "observe", "tool-result", "unchanged", null, null],
      ["boundary.settle.after", "observe", "turn", "unchanged", null, null],
    ]);
  });

  test("순서 덮어쓰기가 없으면 목록 순서가 줄 순서다", () => {
    const parts = momentsFor(plugin("helm"), snap, {});
    const block = parts.find((p) => p.moment === "tool.call.before");
    expect(block?.from).toBeNull();
    expect(block?.to).toBe("secret-scan");
  });

  test("수정 줄(chain)은 고친 값을 넘긴다", () => {
    expect(brief(momentsFor(plugin("cost-router"), snap, FIXTURE_ORDER))).toEqual([
      ["request.provider.before", "modify", "model-request", "modified", null, null],
      ["request.model.after", "observe", "model-response", "unchanged", null, null],
    ]);
  });

  test("뒤쪽 핸들러는 앞 핸들러에서 값을 받는다", () => {
    expect(brief(momentsFor(plugin("review/lens"), snap, FIXTURE_ORDER))).toEqual([
      ["input.agent.before", "merge", "agent-input", "merged", "helm", null],
    ]);
    expect(brief(momentsFor(plugin("secret-scan"), snap, FIXTURE_ORDER))).toEqual([
      ["tool.call.before", "block", "tool-call", "decision", null, "helm"],
    ]);
  });

  test("도구를 내놓는 플러그인은 도구 실행 순간에 불려 나온다(MCP 서버 포함)", () => {
    expect(brief(momentsFor(plugin("helm/explore"), snap, FIXTURE_ORDER))).toEqual([
      [TOOL_RUN, "call", "tool-call", "result", null, null],
    ]);
    expect(brief(momentsFor(plugin("acme-notes"), snap, FIXTURE_ORDER))).toEqual([
      [TOOL_RUN, "call", "tool-call", "result", null, null],
      ["tool.result", "modify", "tool-result", "modified", null, null],
    ]);
  });

  test("끼는 곳이 없는 플러그인은 빈 목록이다", () => {
    expect(momentsFor(plugin("helm/panel"), snap, FIXTURE_ORDER)).toEqual([]);
  });

  test("같은 훅을 건 플러그인 둘은 순서대로 한 줄을 나눈다", () => {
    expect(brief(momentsFor(plugin("learning"), snap, FIXTURE_ORDER))).toEqual([
      ["boundary.settle.after", "observe", "turn", "unchanged", null, null],
      ["thread.shutdown", "observe", "thread", "unchanged", null, null],
    ]);
  });
});

describe("columnsFor: 그룹은 구성원마다 열 하나", () => {
  test("helm 그룹: 세 열, 생명선 순간은 여섯 개(도구 실행 포함)", () => {
    const group = snap.groups.find((g) => g.id === "helm");
    if (group === undefined) throw new Error("fixture has no helm group");
    const members = group.members.map(plugin);
    const cols = columnsFor(members, snap, FIXTURE_ORDER);
    expect(cols.map((c) => c.plugin.id)).toEqual(["helm", "helm/explore", "helm/panel"]);
    expect(cols.map((c) => c.moments.length)).toEqual([5, 1, 0]);
    expect([...activeMoments(cols)].toSorted()).toEqual([
      "boundary.settle.after",
      "input.agent.before",
      "thread.start",
      "tool.call.before",
      "tool.execution.after",
      "tool.run",
    ]);
  });

  test("생명선 밖 훅은 열의 offTurn에 따로 나온다", () => {
    const cols = columnsFor([plugin("helm")], snap, FIXTURE_ORDER);
    expect(cols.flatMap((c) => c.offTurn)).toEqual([
      { hook: "lifecycle.lease.rejected", verb: "observe" },
    ]);
  });
});

describe("runOverlay: 걸린 시간은 trace.turn 값 그대로", () => {
  const entries: CraftRunEntry[] = [
    { hook: "tool.call.before", registrationId: "helm", ms: 3, result: "ok" },
    {
      hook: "boundary.settle.after",
      registrationId: "helm",
      ms: 30000,
      result: "error",
    },
    { hook: "tool.call.before", registrationId: "secret-scan", ms: 8123, result: "ok" },
  ];

  test("이 플러그인의 기록만 훅별로 모은다. ms 3과 30000이 그대로 남는다", () => {
    const marks = runOverlay(entries, plugin("helm"));
    expect(marks.get("tool.call.before")).toEqual([{ ms: 3, result: "ok", outcome: "passed" }]);
    expect(marks.get("boundary.settle.after")).toEqual([
      { ms: 30000, result: "error", outcome: "failed" },
    ]);
    expect([...marks.keys()].toSorted()).toEqual(["boundary.settle.after", "tool.call.before"]);
  });

  test("시간 표시: 1초 미만은 ms, 그 밖은 초로 나누기만 한다(반올림 없음)", () => {
    expect(timeLabel(3)).toEqual({ unit: "ms", n: 3 });
    expect(timeLabel(999)).toEqual({ unit: "ms", n: 999 });
    expect(timeLabel(1000)).toEqual({ unit: "s", n: 1 });
    expect(timeLabel(30000)).toEqual({ unit: "s", n: 30 });
    expect(timeLabel(8123)).toEqual({ unit: "s", n: 8.123 });
  });

  test("결과 대응: ok 지나감, error·over_budget 실패, denied 막음, skipped 건너뜀", () => {
    expect(outcomeOf("ok")).toBe("passed");
    expect(outcomeOf("error")).toBe("failed");
    expect(outcomeOf("over_budget")).toBe("failed");
    expect(outcomeOf("denied")).toBe("blocked");
    expect(outcomeOf("skipped")).toBe("skipped");
  });
});

function fakeRuns(
  runs: (id: string) => Promise<readonly CraftRunEntry[] | null>,
): Pick<CraftSource, "recentRuns"> {
  return { recentRuns: runs };
}

describe("loadRuns: 계측 꺼짐, 읽기 실패, 읽음", () => {
  test("계측이 꺼져 있으면(null) locked이고 숫자를 주지 않는다", async () => {
    const got = await loadRuns(
      fakeRuns((id) => Promise.resolve(id === "helm" ? [] : null)),
      [plugin("helm"), plugin("helm/explore")],
    );
    expect(got).toEqual({ k: "locked" });
  });

  test("읽기가 거부되면 error 값이고 거부한 값을 그대로 담는다", async () => {
    const boom = new Error("trace store gone");
    const got = await loadRuns(
      fakeRuns(() => Promise.reject(boom)),
      [plugin("helm")],
    );
    expect(got.k).toBe("error");
    if (got.k !== "error") throw new Error("expected error");
    expect(got.cause).toBe(boom);
  });

  test("기록이 있으면 ready이고 플러그인별 훅 기록을 준다", async () => {
    const got = await loadRuns(
      fakeRuns((id) =>
        Promise.resolve(
          id === "helm"
            ? [
                { hook: "tool.call.before", registrationId: "helm", ms: 3, result: "ok" },
                {
                  hook: "boundary.settle.after",
                  registrationId: "helm",
                  ms: 30000,
                  result: "error",
                },
              ]
            : [],
        ),
      ),
      [plugin("helm")],
    );
    expect(got.k).toBe("ready");
    if (got.k !== "ready") throw new Error("expected ready");
    expect(got.byPlugin.get("helm")?.get("boundary.settle.after")).toEqual([
      { ms: 30000, result: "error", outcome: "failed" },
    ]);
  });
});

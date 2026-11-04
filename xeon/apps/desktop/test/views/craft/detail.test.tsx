import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { buildFixture, FIXTURE_ORDER } from "@fresnel/client/workbench/canvas";
import { renderToString } from "react-dom/server";
import {
  CraftProvider,
  type CraftRunEntry,
  type CraftSource,
} from "../../../src/views/craft/craft-context.tsx";
import { Detail, DetailView, type RunsView } from "../../../src/views/craft/detail.tsx";
import { TraceCard, VerbChip } from "../../../src/views/craft/detail-flow.tsx";
import {
  membersOfTarget,
  targetOf,
  type DetailTarget,
} from "../../../src/views/craft/detail-model.ts";
import { columnsFor, loadRuns } from "../../../src/views/craft/turn-flow.ts";
import { describedTextOf, inStore } from "./render-support.tsx";

const snapshot = buildFixture(18);

function need(target: DetailTarget | null): DetailTarget {
  if (target === null) throw new Error("expected a target");
  return target;
}

/** 정적 마크업에서 글자 노드를 나오는 순서대로 뽑는다(태그 사이 글만) */
function textsOf(html: string): string[] {
  return [...html.matchAll(/>([^<>]+)</g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

/** 호출되면 실패하는 포트 자리. 이 시험은 그 포트를 부르지 않는다 */
const never = (): Promise<never> => Promise.reject(new Error("not used in this test"));

/** 읽기 함수만 다른 가짜 원천. 다른 포트는 이 시험에서 부르지 않는다 */
function fakeSource(recentRuns: CraftSource["recentRuns"]): CraftSource {
  return {
    snapshot,
    order: FIXTURE_ORDER,
    setOn: () => Promise.resolve(),
    orderPort: { get: never, set: never, reset: never, preview: never },
    openBuilder: () => undefined,
    recentRuns,
    scope: { kind: "global" },
  };
}

/** 실제 loadRuns로 읽은 결과를 그린다(효과는 서버 렌더에서 돌지 않으므로 읽기 결과를 직접 넣는다) */
function render(target: DetailTarget | null, runs: RunsView, mode: "example" | "recent"): string {
  const members = target === null ? [] : membersOfTarget(target);
  return renderToString(
    <DetailView
      snapshot={snapshot}
      target={target}
      columns={columnsFor(members, snapshot, FIXTURE_ORDER)}
      back="orbit"
      mode={mode}
      runs={runs}
      pending={false}
      switchFailed={false}
      onBack={() => undefined}
      onMode={() => undefined}
      onScope={() => undefined}
      onSwitch={() => undefined}
    />,
  );
}

describe("Detail: 계측이 꺼져 있을 때", () => {
  test("잠김 문장이 보이고 시간 숫자는 한 개도 없다", async () => {
    const source = fakeSource(() => Promise.resolve(null));
    const target = need(targetOf(source.snapshot, "helm"));
    const runs = await loadRuns(source, membersOfTarget(target));
    expect(runs.k).toBe("locked");
    const out = render(target, runs, "recent");
    expect(out).toContain(t("desktop.craft.detail.recent.locked"));
    expect(out).not.toMatch(/>\d+(\.\d+)?(ms|s)</);
  });
});

describe("Detail: 기록이 있을 때", () => {
  const entries: CraftRunEntry[] = [
    { hook: "tool.call.before", registrationId: "helm", ms: 3, result: "passed", reason: null },
    {
      hook: "boundary.settle.after",
      registrationId: "helm",
      ms: 30000,
      result: "failed",
      reason: "threw",
    },
  ];

  test("걸린 시간은 trace.turn 값 그대로(3ms, 30s)이고 결과와 실패 이유가 보인다", async () => {
    const source = fakeSource((id) => Promise.resolve(id === "helm" ? entries : []));
    const target = need(targetOf(source.snapshot, "helm"));
    const runs = await loadRuns(source, membersOfTarget(target));
    expect(runs.k).toBe("ready");
    const out = render(target, runs, "recent");
    expect(out).toContain(">3ms<");
    expect(out).toContain(">30s<");
    expect(out).toContain(t("desktop.craft.detail.outcome.passed"));
    expect(out).toContain(t("desktop.craft.detail.outcome.failed"));
    expect(out).toContain(t("desktop.craft.detail.reason.error"));
  });

  test("failed이고 이유가 timeout이면 시간 한도 넘김 줄이 보인다", async () => {
    const timedOut: CraftRunEntry[] = [
      {
        hook: "boundary.settle.after",
        registrationId: "helm",
        ms: 30000,
        result: "failed",
        reason: "timeout",
      },
    ];
    const source = fakeSource((id) => Promise.resolve(id === "helm" ? timedOut : []));
    const target = need(targetOf(source.snapshot, "helm"));
    const runs = await loadRuns(source, membersOfTarget(target));
    const out = render(target, runs, "recent");
    expect(out).toContain(t("desktop.craft.detail.reason.overBudget"));
    expect(out).not.toContain(t("desktop.craft.detail.reason.error"));
  });

  test("기록이 하나도 없으면 빈 기록 안내가 나온다", async () => {
    const source = fakeSource(() => Promise.resolve([]));
    const target = need(targetOf(source.snapshot, "helm"));
    const runs = await loadRuns(source, membersOfTarget(target));
    const out = render(target, runs, "recent");
    expect(out).toContain(t("desktop.craft.detail.recent.none"));
  });
});

describe("TraceCard: 기록 한 개의 자리", () => {
  const title = t("desktop.craft.detail.moment.tool.call.before");

  test("통과 기록은 순간 이름, 시간, 결과 칩 순서로 나온다. 하는 일은 카드에 없고 칩의 정보 아이콘에 있다", () => {
    const out = renderToString(
      <TraceCard title={title} mark={{ ms: 3, result: "passed", reason: null }} />,
    );
    expect(textsOf(out)).toEqual([
      "도구를 쓰기 전",
      "3ms",
      t("desktop.craft.detail.outcome.passed"),
    ]);
    expect(describedTextOf(out)).toBeNull();
  });

  test("실패 이유가 있으면 이유가 경고로 나오고 칩은 그대로다", () => {
    const out = renderToString(
      <TraceCard title={title} mark={{ ms: 30000, result: "failed", reason: "timeout" }} />,
    );
    expect(textsOf(out)).toEqual([
      "도구를 쓰기 전",
      "30s",
      t("desktop.craft.detail.reason.overBudget"),
      t("desktop.craft.detail.outcome.failed"),
    ]);
    expect(out).toContain('role="alert"');
  });

  test("이유가 없으면 설명 자리는 비고 칩만 남는다", () => {
    const out = renderToString(
      <TraceCard title={title} mark={{ ms: 12, result: "skipped", reason: null }} />,
    );
    expect(textsOf(out)).toEqual([
      "도구를 쓰기 전",
      "12ms",
      t("desktop.craft.detail.outcome.skipped"),
    ]);
  });
});

describe("VerbChip: 규칙 이름은 보이고 하는 일은 정보 아이콘 뒤에 있다", () => {
  test("차단 칩은 이름이 보이고, 한 줄 설명이 아이콘의 aria-describedby 글이다", () => {
    const out = renderToString(<VerbChip verb="block" />);
    expect(out).toContain(`>${t("desktop.craft.detail.verb.block")}<`);
    expect(describedTextOf(out)).toBe(t("desktop.craft.detail.verb.tip.block"));
    expect(out).toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
  });

  test("도구 실행(불려 나옴)은 설명이 없어 아이콘도 없다", () => {
    const out = renderToString(<VerbChip verb="call" />);
    expect(out).toContain(`>${t("desktop.craft.detail.verb.call")}<`);
    expect(describedTextOf(out)).toBeNull();
    expect(out).not.toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
  });
});

describe("Detail: 읽는 중, 읽기 실패, 대상 없음", () => {
  test("읽는 중이면 읽는 중 문장이 보인다", async () => {
    const target = need(targetOf(snapshot, "helm"));
    const out = render(target, { k: "loading" }, "recent");
    expect(out).toContain(t("desktop.craft.detail.recent.loading"));
  });

  test("읽기가 실패하면 실패 문장이 인라인으로 보인다", async () => {
    const target = need(targetOf(snapshot, "helm"));
    const out = render(target, { k: "error", cause: new Error("x") }, "recent");
    expect(out).toContain(t("desktop.craft.detail.recent.error"));
  });

  test("대상을 찾지 못하면 찾지 못했다는 문장과 돌아갈 단추가 있다", async () => {
    const out = render(null, { k: "loading" }, "example");
    expect(out).toContain(t("desktop.craft.detail.missing.title"));
  });
});

describe("Detail: 자세히 보기가 닫혀 있을 때", () => {
  test("state.detail이 없으면 아무것도 그리지 않는다", () => {
    const out = renderToString(
      inStore(
        <CraftProvider source={fakeSource(() => Promise.resolve(null))}>
          <Detail />
        </CraftProvider>,
      ),
    );
    expect(out).toBe("");
  });
});

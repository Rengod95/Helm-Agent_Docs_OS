import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NowState } from "../../src/state/engine/index.ts";
import { nowViewOf } from "../../src/views/now/now-model.ts";
import { NowStripView, stripAuroraOf } from "../../src/views/now/now-strip.tsx";

// 지금 띠(DP-100)의 서버 렌더: 접힌 줄의 본문과 곁 정보, 좁은 띠에서 숨는 곁 정보, 펼친 몸에서 목표를 되풀이하지 않음.

function nowOf(over: Partial<NowState> = {}): NowState {
  return {
    goalLine: null,
    goalStatus: null,
    judgment: null,
    tasks: [],
    progress: { done: 0, total: 0 },
    runningAgents: 0,
    pendingApprovals: 0,
    turnRunning: false,
    aborting: false,
    ...over,
  };
}

const noop = (): void => {};

function textOf(html: string): string {
  return html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

describe("NowStripView", () => {
  test("the collapsed line shows the goal with its judgment count and no body", () => {
    const view = nowViewOf(
      nowOf({ goalLine: "시험 통과", goalStatus: "active", judgment: { n: 1, max: 3 } }),
      [],
      [],
    );
    const html = renderToStaticMarkup(
      <NowStripView view={view} open={false} onOpenChange={noop} />,
    );
    expect(textOf(html)).toContain("시험 통과 · 판정 1/3");
    expect(html).toContain('aria-expanded="false"');
  });

  test("opened with the goal as the headline, the body does not repeat the goal", () => {
    const view = nowViewOf(nowOf({ goalLine: "시험 통과", goalStatus: "active" }), [], []);
    const html = renderToStaticMarkup(<NowStripView view={view} open onOpenChange={noop} />);
    expect(textOf(html).split("시험 통과")).toHaveLength(2);
  });

  test("pending approvals are main meta that stays on a narrow strip", () => {
    const view = nowViewOf(nowOf({ pendingApprovals: 2, runningAgents: 0 }), [], []);
    const html = renderToStaticMarkup(
      <NowStripView view={view} open={false} onOpenChange={noop} />,
    );
    expect(html).toContain('data-now-meta="main"');
    expect(textOf(html)).toContain("승인 2");
  });

  test("stopping replaces the headline", () => {
    const view = nowViewOf(nowOf({ aborting: true, turnRunning: true }), [], []);
    expect(
      textOf(renderToStaticMarkup(<NowStripView view={view} open={false} onOpenChange={noop} />)),
    ).toContain("멈추는 중…");
  });
});

describe("stripAuroraOf (dzE 시안 §2.4)", () => {
  test("승인 대기가 먼저, 그다음 도는 중·멈추는 중, 그 밖은 꺼짐", () => {
    expect(
      [
        { pulse: "running", pendingApprovals: 1 },
        { pulse: "idle", pendingApprovals: 2 },
        { pulse: "running", pendingApprovals: 0 },
        { pulse: "stopping", pendingApprovals: 0 },
        { pulse: "idle", pendingApprovals: 0 },
      ].map((view) =>
        stripAuroraOf({
          pulse:
            view.pulse === "running" ? "running" : view.pulse === "stopping" ? "stopping" : "idle",
          pendingApprovals: view.pendingApprovals,
        }),
      ),
    ).toEqual(["wait", "wait", "run", "stop", "off"]);
  });
});

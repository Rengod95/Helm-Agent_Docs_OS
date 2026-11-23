import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_FILTER } from "../../../src/views/craft/metrics/model.ts";
import type { TurnCurve } from "../../../src/views/craft/metrics/model.ts";
import { sampleData } from "../../../src/views/craft/metrics/sample.ts";
import { TurnCurveSection } from "../../../src/views/craft/metrics/sections.tsx";
import type { MetricsData } from "../../../src/views/craft/metrics/source.ts";

// 턴 번호 곡선 구역의 정적 마크업. 읽은 곡선은 두 그림(토큰, 호출 시간)의 글과 턴 번호 눈금으로 보이고,
// 곡선이 없거나 한 점뿐이면 "표본 부족"이다. 효과는 돌지 않으므로 누르기와 표 전환은 여기서 보지 않는다.

const POINTS = [
  { turnId: "trn_a", number: 1, totalTokens: 1200, usd: 0.01, durationMs: 800 },
  { turnId: "trn_b", number: 2, totalTokens: 2600, usd: 0.02, durationMs: 1500 },
  { turnId: "trn_c", number: 3, totalTokens: 4100, usd: 0.04, durationMs: 2300 },
];

function dataWith(curve: TurnCurve): MetricsData {
  const base = sampleData("sample", DEFAULT_FILTER, () => undefined, {});
  return { ...base, curve: { kind: "ready", value: curve, stale: false } };
}

function render(ui: ReactNode): string {
  return renderToString(<>{ui}</>);
}

describe("turn curve section", () => {
  test("a ready curve shows the conversation title, both chart captions, and the turn numbers", () => {
    const html = render(
      <TurnCurveSection
        data={dataWith({
          kind: "ready",
          threadId: "thr_sample_0",
          title: "결제 모듈 리팩터링",
          capped: false,
          points: POINTS,
        })}
      />,
    );
    expect([
      html.includes("결제 모듈 리팩터링"),
      html.includes("턴별 토큰"),
      html.includes("턴별 호출 시간"),
      // 눈금은 폭이 정해지기 전(서버 그리기)에 몇 점마다 건너뛰므로 첫 턴의 눈금만 보고, 끝 턴은 점의 이름으로 본다
      html.includes(">1</text>"),
      html.includes('aria-label="턴 3 '),
    ]).toEqual([true, true, true, true, true]);
  });

  test("no turns, or a single point, says the sample is short", () => {
    const none = render(<TurnCurveSection data={dataWith({ kind: "none" })} />);
    const one = render(
      <TurnCurveSection
        data={dataWith({
          kind: "ready",
          threadId: "thr_sample_0",
          title: null,
          capped: false,
          points: POINTS.slice(0, 1),
        })}
      />,
    );
    expect([none.includes("표본 부족"), one.includes("표본 부족")]).toEqual([true, true]);
  });

  test("a switched-off recording says so instead of drawing a curve", () => {
    const html = render(<TurnCurveSection data={dataWith({ kind: "off" })} />);
    expect([html.includes("기록이 꺼져 있어"), html.includes("턴별 토큰")]).toEqual([true, false]);
  });
});

/** 눈금 글(`viz-axis`)의 x와 글, 그린 순서대로 */
const ticksOf = (html: string): { x: string; text: string }[] =>
  [...html.matchAll(/<text class="viz-axis viz-figure" x="([^"]*)"[^>]*>([^<]*)<\/text>/g)].map(
    (m) => ({ x: m[1] ?? "", text: m[2] ?? "" }),
  );

describe("turn curve axis", () => {
  test("both charts share the wider tick column, and the time axis floor reads 0 without a unit", () => {
    const html = render(
      <TurnCurveSection
        data={dataWith({
          kind: "ready",
          threadId: "thr_sample_0",
          title: null,
          capped: false,
          points: POINTS,
        })}
      />,
    );
    const ticks = ticksOf(html);
    expect([...new Set(ticks.map((tick) => tick.x))]).toEqual(["38"]);
    // 위는 토큰, 아래는 시간. 시간 축의 바닥은 "0ms"가 아니라 "0"이다
    expect(ticks.map((tick) => tick.text)).toEqual([
      "0",
      "2,000",
      "4,000",
      "6,000",
      "0",
      "1초",
      "2초",
      "3초",
    ]);
  });
});

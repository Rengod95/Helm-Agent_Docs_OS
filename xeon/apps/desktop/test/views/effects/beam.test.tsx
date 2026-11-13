import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  BeamLine,
  BeamScope,
  beamLookOf,
  beamStateOf,
  BeamEdge,
  boxOf,
  cssZoomOf,
} from "../../../src/views/effects/beam.tsx";

// beam(DP-107). 상태 판단과 자리 계산은 순수하게, 부품은 서버 렌더로 본다.

describe("beamStateOf", () => {
  test("턴이 돌면 run, 멈춰 있으면 off", () => {
    expect(beamStateOf({ running: true, awaitingApproval: false })).toBe("run");
    expect(beamStateOf({ running: false, awaitingApproval: false })).toBe("off");
  });

  test("승인을 기다리면 턴이 돌아도 wait", () => {
    expect(beamStateOf({ running: true, awaitingApproval: true })).toBe("wait");
    expect(beamStateOf({ running: false, awaitingApproval: true })).toBe("wait");
  });
});

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  width,
  height,
  x: left,
  y: top,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

describe("beamLookOf", () => {
  test("움직임을 줄이면 도는 빛 대신 정지 고리, 승인 대기는 그대로 경고 고리", () => {
    expect([beamLookOf("run", false), beamLookOf("run", true)]).toEqual(["run", "still"]);
    expect([beamLookOf("wait", false), beamLookOf("wait", true)]).toEqual(["wait", "wait"]);
    expect(beamLookOf("off", true)).toBe("off");
  });
});

describe("boxOf", () => {
  test("대상의 자리를 감싼 판 기준으로 옮기고 반경을 읽는다", () => {
    expect(boxOf(rect(100, 500, 800, 200), rect(112, 540, 776, 96), "20px")).toEqual({
      left: 12,
      top: 40,
      width: 776,
      height: 96,
      radius: 20,
      shape: "round",
    });
  });

  test("대상의 corner-shape를 읽어 판이 같은 모양을 쓴다(dzE 시안 §1)", () => {
    const box = boxOf(rect(0, 0, 10, 10), rect(0, 0, 10, 10), "23.2px", " superellipse(2) ");
    expect([box.radius, box.shape]).toEqual([23.2, "superellipse(2)"]);
  });

  test("반경을 읽지 못하면 16px", () => {
    expect(boxOf(rect(0, 0, 10, 10), rect(0, 0, 10, 10), "").radius).toBe(16);
  });

  test("앱 확대에서 화면 px을 판의 CSS px로 나눠 판이 대상과 겹친다(DP-171)", () => {
    // 1280 창, 입력창 CSS 상자(48, 542, 712, 84)와 감싼 판(0, 500)을 확대마다 화면 px로 잰 값
    const rows = [90, 100, 125, 150, 200].map((percent) => {
      const z = percent / 100;
      const box = boxOf(
        rect(0, 500 * z, 1280, 140 * z),
        rect(48 * z, 542 * z, 712 * z, 84 * z),
        "20px",
        "",
        z,
      );
      // 판은 확대 안에 있으므로 화면에서는 CSS px × 확대로 그려진다. 대상 화면 상자와의 차이(px)
      const drawn = [box.left * z, (box.top + 500) * z, box.width * z, box.height * z];
      const target = [48 * z, 542 * z, 712 * z, 84 * z];
      return drawn.map((v, i) => Math.round((v - (target[i] ?? 0)) * 1000) / 1000);
    });
    expect(rows).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    // 고치기 전처럼 확대를 모르면 125%에서 판이 대상보다 25% 크다
    const naive = boxOf(rect(0, 625, 1600, 175), rect(60, 677.5, 890, 105), "20px");
    expect([naive.width * 1.25, naive.height * 1.25]).toEqual([1112.5, 131.25]);
  });

  test("확대를 모르거나 틀린 값이면 1", () => {
    expect(cssZoomOf({ currentCSSZoom: 1.25 })).toBe(1.25);
    expect(cssZoomOf({})).toBe(1);
    expect(cssZoomOf({ currentCSSZoom: 0 })).toBe(1);
    expect(cssZoomOf({ currentCSSZoom: Number.NaN })).toBe(1);
    expect(boxOf(rect(0, 0, 10, 10), rect(5, 5, 10, 10), "", "", 0).left).toBe(5);
  });
});

describe("부품", () => {
  test("BeamScope는 잰 대상이 없으면 빛 판을 그리지 않고 내용만 그린다", () => {
    const html = renderToString(
      <BeamScope state="run" target=".composer-box">
        <p>입력</p>
      </BeamScope>,
    );
    expect(html).toBe('<div class="relative"><p>입력</p></div>');
  });

  test("BeamEdge는 돌지 않는 아래 변 빛이다: 흐르는 무지개와 알갱이 셋, 번짐 없음", () => {
    const run = renderToString(<BeamEdge state="run" />);
    expect(run.match(/class="fx-glow-spark"/g)?.length).toBe(3);
    expect(run).toContain('class="fx-glow-flow"');
    expect(run).toContain('data-variant="chip"');
    expect(run).not.toContain("fx-glow-bloom");
    expect(run).not.toContain("fx-glow-haze");
    expect(run).toContain('data-phase="0" style="--x:20%;--w:55%;--c:var(--fx-glow-teal)"');
  });

  test("승인 대기는 빛이 멈춘다: 알갱이와 흐름 없이 멈춘 선만", () => {
    const wait = renderToString(<BeamEdge state="wait" />);
    expect(wait).toContain('data-look="wait"');
    expect(wait).not.toContain("fx-glow-spark");
    expect(wait).not.toContain("fx-glow-flow");
    expect(wait).toContain('class="fx-glow-hold"');
  });

  test("BeamLine은 화면 낭독에서 빠지고 border-beam line 판과 정지 선을 둔다", () => {
    const on = renderToString(<BeamLine active />);
    expect(on.startsWith('<div aria-hidden="true" class="fx-line" data-look="run">')).toBe(true);
    expect(on).toContain("data-beam=");
    expect(on).toContain('class="fx-beam-still"');
    expect(renderToString(<BeamLine active={false} />)).toContain('data-look="off"');
  });
});

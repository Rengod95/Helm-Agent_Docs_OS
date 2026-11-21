import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import {
  BeamLine,
  BeamScope,
  beamLookOf,
  beamStateOf,
  BeamEdge,
  boxOf,
  edgeSpanOf,
  usedRadiusOf,
} from "../../../src/views/effects/beam.tsx";
import { GLOW_EDGE_FADE, GLOW_EDGE_FADE_CHIP } from "../../../src/views/effects/fx-config.ts";
import { read, SRC } from "../../styles/source-scan.ts";

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

  test("확대가 틀린 값이면 1로 본다", () => {
    expect(boxOf(rect(0, 0, 10, 10), rect(5, 5, 10, 10), "", "", 0).left).toBe(5);
  });
});

describe("edgeSpanOf", () => {
  test("빛은 아래 변의 곧은 구간(반경부터 폭 − 반경)에만 서고 양 끝 16px 옅어진다(DP-167 개정 2026-11-21 lcQ2)", () => {
    // 1440×900 창의 입력창: 712×84, 반경 23.2px squircle. 곧은 구간 23.2 ~ 688.8
    expect(edgeSpanOf(712, 23.2)).toEqual({ from: 23.2, fade: 16 });
    expect(GLOW_EDGE_FADE).toBe(16);
  });

  test("곧은 구간이 옅어짐 두 번보다 짧으면 옅어짐을 구간의 반으로 줄인다", () => {
    expect(edgeSpanOf(60, 20)).toEqual({ from: 20, fade: 10 });
  });

  test("반경은 폭의 반을 넘지 않고, 곧은 구간이 없으면 옅어짐은 0", () => {
    expect(edgeSpanOf(30, 23.2)).toEqual({ from: 15, fade: 0 });
    expect(edgeSpanOf(0, 23.2)).toEqual({ from: 0, fade: 0 });
  });

  test("음수 반경·폭은 0으로 본다", () => {
    expect(edgeSpanOf(100, -4)).toEqual({ from: 0, fade: 16 });
    expect(edgeSpanOf(-10, 8)).toEqual({ from: 0, fade: 0 });
  });
});

describe("실행 중 칩의 곧은 구간(DP-127·167 개정 2026-11-21 lcQ3)", () => {
  test("알약 반경(9999px)은 높이의 반으로 줄어 24px 칩은 12px이다", () => {
    expect(usedRadiusOf(9999, 52.5, 24)).toBe(12);
    expect(usedRadiusOf(23.2, 712, 84)).toBe(23.2);
    expect(usedRadiusOf(Number.NaN, 52.5, 24)).toBe(0);
    expect(usedRadiusOf(-3, 52.5, 24)).toBe(0);
  });

  test("'실행 중' 칩(52.5×24)의 빛은 12px부터 40.5px까지, 양 끝 8px 옅어진다", () => {
    expect(GLOW_EDGE_FADE_CHIP).toBe(8);
    expect(edgeSpanOf(52.5, usedRadiusOf(9999, 52.5, 24), GLOW_EDGE_FADE_CHIP)).toEqual({
      from: 12,
      fade: 8,
    });
  });

  test("최소 폭 48px 칩에서도 곧은 구간 24px이 옅어짐 세 번만큼 남는다", () => {
    const css = read(join(SRC, "views/call-chip.css")).replaceAll(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.call-chip\[data-status="running"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule.includes("min-width: 3rem;")).toBe(true);
    const width = 48;
    const span = edgeSpanOf(width, usedRadiusOf(9999, width, 24), GLOW_EDGE_FADE_CHIP);
    expect(span).toEqual({ from: 12, fade: 8 });
    expect(width - 2 * span.from).toBe(3 * GLOW_EDGE_FADE_CHIP);
  });

  test("칩 판의 재기 전 값은 CSS가 같은 반경과 옅어짐으로 둔다", () => {
    const css = read(join(SRC, "views/effects/beam.css")).replaceAll(/\/\*[\s\S]*?\*\//g, "");
    // 입력창과 함께 쓰는 선택자 목록(`field, chip`)이 아니라 칩만의 규칙
    const rule = /\}\s*\.fx-beam\[data-variant="chip"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const decls = rule
      .split(";")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("--fx-edge"));
    expect(decls).toEqual([
      "--fx-edge-from: 12px",
      `--fx-edge-fade: ${String(GLOW_EDGE_FADE_CHIP)}px`,
    ]);
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
    // 재기 전(서버 렌더)에는 판에 인라인 곧은 구간이 없다(CSS 기본값)
    expect(run).toContain(
      '<div aria-hidden="true" class="fx-beam" data-look="run" data-variant="chip"',
    );
    expect(run).not.toContain("--fx-edge-from");
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

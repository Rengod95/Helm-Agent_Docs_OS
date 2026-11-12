import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  BeamLine,
  BeamScope,
  beamLookOf,
  beamStateOf,
  boxOf,
  crestOffsetsOf,
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
      exponent: 2,
      shape: "round",
    });
  });

  test("대상의 corner-shape를 읽는다: squircle·superellipse(2)는 지수 4(dzE 시안 §1)", () => {
    const box = boxOf(rect(0, 0, 10, 10), rect(0, 0, 10, 10), "23.2px", " superellipse(2) ");
    expect([box.radius, box.exponent, box.shape]).toEqual([23.2, 4, "superellipse(2)"]);
  });

  test("반경을 읽지 못하면 16px", () => {
    expect(boxOf(rect(0, 0, 10, 10), rect(0, 0, 10, 10), "").radius).toBe(16);
  });
});

describe("crestOffsetsOf", () => {
  test("물마루는 기준점 앞뒤로 같은 간격으로 선다(가운데가 0)", () => {
    expect(crestOffsetsOf(5, 8)).toEqual([-16, -8, 0, 8, 16]);
    expect(crestOffsetsOf(4, 10)).toEqual([-15, -5, 5, 15]);
    expect(crestOffsetsOf(1, 8)).toEqual([0]);
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

  test("BeamLine은 화면 낭독에서 빠지고 border-beam line 판과 정지 선을 둔다", () => {
    const on = renderToString(<BeamLine active />);
    expect(on.startsWith('<div aria-hidden="true" class="fx-line" data-look="run">')).toBe(true);
    expect(on).toContain("data-beam=");
    expect(on).toContain('class="fx-beam-still"');
    expect(renderToString(<BeamLine active={false} />)).toContain('data-look="off"');
  });
});

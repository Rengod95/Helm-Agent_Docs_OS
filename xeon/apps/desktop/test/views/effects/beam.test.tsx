import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { BeamLine, BeamScope, beamStateOf, boxOf } from "../../../src/views/effects/beam.tsx";

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

describe("boxOf", () => {
  test("대상의 자리를 감싼 판 기준으로 옮기고 반경을 읽는다", () => {
    expect(boxOf(rect(100, 500, 800, 200), rect(112, 540, 776, 96), "20px")).toEqual({
      left: 12,
      top: 40,
      width: 776,
      height: 96,
      radius: 20,
    });
  });

  test("반경을 읽지 못하면 16px", () => {
    expect(boxOf(rect(0, 0, 10, 10), rect(0, 0, 10, 10), "").radius).toBe(16);
  });
});

describe("부품", () => {
  test("BeamScope는 잰 대상이 없으면 고리를 그리지 않고 내용만 그린다", () => {
    const html = renderToString(
      <BeamScope state="run" target=".composer-box">
        <p>입력</p>
      </BeamScope>,
    );
    expect(html).toBe('<div class="relative "><p>입력</p></div>');
  });

  test("BeamLine은 화면 낭독에서 빠지고 상태를 data-state로 둔다", () => {
    expect(renderToString(<BeamLine active />)).toBe(
      '<div aria-hidden="true" class="fx-line" data-state="run"><span class="fx-line-streak"></span></div>',
    );
    expect(renderToString(<BeamLine active={false} />)).toContain('data-state="off"');
  });
});

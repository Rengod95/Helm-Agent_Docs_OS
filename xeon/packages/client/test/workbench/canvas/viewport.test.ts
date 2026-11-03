import { describe, expect, test } from "bun:test";
import {
  CENTER,
  clampView,
  fitView,
  glideAt,
  labelScale,
  MAX_K,
  MIN_K,
  panBy,
  percent,
  pinchDelta,
  zoomAt,
  zoomSteps,
  wheelFactor,
} from "../../../src/workbench/canvas/viewport.ts";

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe("viewport 상수", () => {
  test("세계 좌표의 가운데와 배율 범위", () => {
    expect(CENTER).toBe(500);
    expect(MIN_K).toBe(0.3);
    expect(MAX_K).toBe(3.2);
  });
});

describe("clampView", () => {
  test("배율만 범위 안으로 맞추고 이동은 그대로 둔다", () => {
    expect(clampView({ k: 0.1, x: 5, y: 6 })).toEqual({ k: 0.3, x: 5, y: 6 });
    expect(clampView({ k: 9, x: 1, y: 2 })).toEqual({ k: 3.2, x: 1, y: 2 });
    expect(clampView({ k: 1.5, x: -7, y: 8 })).toEqual({ k: 1.5, x: -7, y: 8 });
  });
});

describe("labelScale", () => {
  test("확대하면 커지고 1에서 1.3 사이에 머문다. 축소해도 1보다 작아지지 않는다", () => {
    expect(labelScale(1)).toBe(1);
    expect(labelScale(0.3)).toBe(1);
    expect(labelScale(0.81)).toBe(1);
    expect(labelScale(1.21)).toBeCloseTo(1.1, 9);
    expect(labelScale(1.69)).toBeCloseTo(1.3, 9);
    expect(labelScale(3.2)).toBe(1.3);
  });
});

describe("percent", () => {
  test("배율을 반올림한 퍼센트로 바꾼다", () => {
    expect(percent(1)).toBe(100);
    expect(percent(0.3)).toBe(30);
    expect(percent(1.4)).toBe(140);
    expect(percent(0.376)).toBe(38);
  });
});

describe("fitView", () => {
  test("지도가 이름표 폭과 세로 여백을 뺀 칸에 딱 맞는 배율", () => {
    // 가로 (1220-300)/920 = 1, 세로 (944-24)/920 = 1
    expect(fitView({ w: 1220, h: 944 }, NO_INSETS, 150)).toEqual({ k: 1, x: 110, y: -28 });
  });

  test("여백(insets)을 뺀 칸의 가운데에 놓는다", () => {
    // 내용 칸 1220×944, 왼쪽 여백 100, 위 여백 40
    const v = fitView({ w: 1320, h: 984 }, { top: 40, right: 0, bottom: 0, left: 100 }, 150);
    expect(v.k).toBeCloseTo(1, 9);
    expect(v.x).toBeCloseTo(210, 9);
    expect(v.y).toBeCloseTo(12, 9);
  });

  test("큰 화면은 FIT_MAX_K 1.4에서 멈춘다", () => {
    const v = fitView({ w: 2220, h: 2000 }, NO_INSETS, 150);
    expect(v.k).toBeCloseTo(1.4, 9);
    expect(v.x).toBeCloseTo(410, 6);
    expect(v.y).toBeCloseTo(300, 6);
  });

  test("작은 화면은 MIN_K 0.3까지만 줄고 음수 칸에서도 값이 깨지지 않는다", () => {
    const v = fitView({ w: 100, h: 100 }, NO_INSETS, 150);
    expect(v.k).toBeCloseTo(0.3, 9);
    expect(v.x).toBeCloseTo(-100, 6);
    expect(v.y).toBeCloseTo(-100, 6);
  });
});

describe("zoomAt", () => {
  test("anchor 아래의 세계 점이 화면에서 제자리에 남는다", () => {
    // 배율 1→2, anchor (300,200): 세계 점 (300,200)은 그대로 (300,200)에 있다
    const v = zoomAt({ k: 1, x: 0, y: 0 }, 2, { x: 300, y: 200 });
    expect(v).toEqual({ k: 2, x: -300, y: -200 });
    expect((300 - v.x) / v.k).toBe(300);
    expect((200 - v.y) / v.k).toBe(200);
  });

  test("배율이 MAX_K를 넘으면 MAX_K에서 멈추고 그 비율로 이동을 맞춘다", () => {
    // k 3 → 6이 3.2로 잘림. f = 3.2/3. anchor (0,0)에서 x = -30 * 3.2/3 = -32
    const v = zoomAt({ k: 3, x: -30, y: 0 }, 2, { x: 0, y: 0 });
    expect(v.k).toBe(3.2);
    expect(v.x).toBeCloseTo(-32, 9);
    expect(v.y).toBe(0);
  });

  test("이미 MIN_K면 축소 요청은 시점을 바꾸지 않는다", () => {
    const v = zoomAt({ k: 0.3, x: 12, y: -4 }, 0.5, { x: 100, y: 100 });
    expect(v).toEqual({ k: 0.3, x: 12, y: -4 });
  });
});

describe("zoomSteps", () => {
  test("확대는 내용 칸의 가운데를 기준으로 1.25배", () => {
    // 가운데 (500,500), k 1→1.25: x = 500 - 500*1.25 = -125
    expect(zoomSteps({ k: 1, x: 0, y: 0 }, "in", { w: 1000, h: 1000 }, NO_INSETS)).toEqual({
      k: 1.25,
      x: -125,
      y: -125,
    });
  });

  test("축소는 1/1.25배이고 가운데를 기준으로 한다", () => {
    const v = zoomSteps({ k: 1, x: 0, y: 0 }, "out", { w: 1000, h: 1000 }, NO_INSETS);
    expect(v.k).toBeCloseTo(0.8, 9);
    expect(v.x).toBeCloseTo(100, 9);
    expect(v.y).toBeCloseTo(100, 9);
  });

  test("여백이 있으면 여백을 뺀 칸의 가운데가 기준이다", () => {
    // 칸 (100..1000, 0..1000)의 가운데 x = 100 + 450 = 550. k 1→0.8: x = 550 - 550*0.8 = 110
    const v = zoomSteps(
      { k: 1, x: 0, y: 0 },
      "out",
      { w: 1000, h: 1000 },
      { top: 0, right: 0, bottom: 0, left: 100 },
    );
    expect(v.x).toBeCloseTo(110, 9);
  });

  test("최대 배율에서 확대하면 시점이 그대로다", () => {
    const v = zoomSteps({ k: 3.2, x: -50, y: -50 }, "in", { w: 1000, h: 1000 }, NO_INSETS);
    expect(v).toEqual({ k: 3.2, x: -50, y: -50 });
  });
});

describe("wheelFactor", () => {
  test("휠 한 칸은 지수 감쇠로 배율을 바꾼다. 아래로 굴리면 축소", () => {
    expect(wheelFactor(0, false)).toBe(1);
    expect(wheelFactor(100, false)).toBeCloseTo(0.8521437889, 9);
    expect(wheelFactor(-100, false)).toBeCloseTo(1.1735108709, 9);
  });

  test("ctrl+휠(두 손가락 모으기)은 같은 움직임에 더 크게 반응한다", () => {
    expect(wheelFactor(100, true)).toBeCloseTo(0.3011942119, 9);
  });
});

describe("pinchDelta", () => {
  test("두 손가락 거리의 비율", () => {
    expect(pinchDelta(100, 150)).toBe(1.5);
    expect(pinchDelta(200, 100)).toBe(0.5);
  });

  test("이전 거리가 0이면 배율을 바꾸지 않는다", () => {
    expect(pinchDelta(0, 150)).toBe(1);
  });
});

describe("panBy", () => {
  test("시작 시점에서 움직인 만큼 옮기고 배율은 그대로다", () => {
    expect(panBy({ k: 2, x: 10, y: -5 }, 7, 3)).toEqual({ k: 2, x: 17, y: -2 });
    expect(panBy({ k: 2, x: 10, y: -5 }, -10, 0)).toEqual({ k: 2, x: 0, y: -5 });
  });
});

describe("glideAt", () => {
  const from = { k: 1, x: 0, y: 0 };
  const to = { k: 2, x: 100, y: -100 };

  test("시작은 from, 시간이 다 되면 to", () => {
    expect(glideAt(from, to, 0)).toEqual(from);
    expect(glideAt(from, to, 420)).toEqual(to);
    expect(glideAt(from, to, 9999)).toEqual(to);
  });

  test("절반 시간에 세제곱 감속 값 0.875가 된다", () => {
    // t = 0.5, e = 1 - 0.5^3 = 0.875
    const v = glideAt(from, to, 210);
    expect(v.k).toBeCloseTo(1.875, 9);
    expect(v.x).toBeCloseTo(87.5, 9);
    expect(v.y).toBeCloseTo(-87.5, 9);
  });

  test("음수 시간은 from으로 취급한다", () => {
    expect(glideAt(from, to, -50)).toEqual(from);
  });
});

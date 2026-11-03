import { describe, expect, test } from "bun:test";
import {
  coreCanvasSize,
  dprFor,
  frameInterval,
  renderMode,
  shouldRender,
  type FrameInput,
} from "../../../src/workbench/canvas/frame-policy.ts";

const BASE: FrameInput = {
  now: 100,
  last: 0,
  mode: "idle",
  hidden: false,
  reducedMotion: false,
  contextLost: false,
  drawnOnce: true,
};

describe("frameInterval", () => {
  test("가만히 있을 때 30fps, 움직일 때 60fps", () => {
    expect(frameInterval("idle")).toBeCloseTo(33.333333, 6);
    expect(frameInterval("active")).toBeCloseTo(16.666667, 6);
  });
});

describe("shouldRender", () => {
  test("숨겨진 탭은 시간이 지나도 그리지 않는다", () => {
    expect(shouldRender({ ...BASE, hidden: true, now: 10000 })).toBe(false);
  });

  test("컨텍스트를 잃으면 그리지 않는다", () => {
    expect(shouldRender({ ...BASE, contextLost: true, now: 10000 })).toBe(false);
  });

  test("움직임 줄이기는 첫 한 장만 그린다", () => {
    expect(shouldRender({ ...BASE, reducedMotion: true, drawnOnce: false })).toBe(true);
    expect(shouldRender({ ...BASE, reducedMotion: true, drawnOnce: true, now: 10000 })).toBe(false);
  });

  test("아직 한 번도 그리지 않았으면 그린다", () => {
    expect(shouldRender({ ...BASE, drawnOnce: false, now: 1, last: 0 })).toBe(true);
  });

  test("가만히 있을 때는 간격 33.33ms에서 2ms 여유를 둔다", () => {
    // 31.33 미만은 건너뛰고 32부터 그린다
    expect(shouldRender({ ...BASE, now: 31, last: 0 })).toBe(false);
    expect(shouldRender({ ...BASE, now: 32, last: 0 })).toBe(true);
  });

  test("움직일 때는 간격 16.67ms에서 2ms 여유를 둔다", () => {
    // 14.67 미만은 건너뛰고 15부터 그린다
    expect(shouldRender({ ...BASE, mode: "active", now: 14, last: 0 })).toBe(false);
    expect(shouldRender({ ...BASE, mode: "active", now: 15, last: 0 })).toBe(true);
  });

  test("마지막으로 그린 시각에서 충분히 지났는지로 판정한다", () => {
    expect(shouldRender({ ...BASE, now: 1000, last: 990 })).toBe(false);
    expect(shouldRender({ ...BASE, now: 1000, last: 900 })).toBe(true);
  });
});

describe("dprFor", () => {
  test("배경은 기기 DPR을 1.25배까지만 쓴다", () => {
    expect(dprFor(2, "background")).toBe(1.25);
    expect(dprFor(1, "background")).toBe(1);
    expect(dprFor(1.25, "background")).toBe(1.25);
  });

  test("구체는 기기 DPR의 1.3배를 요청한다", () => {
    expect(dprFor(1, "core")).toBeCloseTo(1.3, 9);
    expect(dprFor(2, "core")).toBeCloseTo(2.6, 9);
  });
});

describe("coreCanvasSize", () => {
  test("상한에 닿지 않으면 CSS 크기의 DPR×1.3", () => {
    // 300 × 1.3 = 390, 1024 상한에 닿지 않는다
    expect(coreCanvasSize(300, 1).px).toBe(390);
    expect(coreCanvasSize(300, 1).ratio).toBeCloseTo(1.3, 9);
    expect(coreCanvasSize(200, 2).px).toBe(520);
    expect(coreCanvasSize(200, 2).ratio).toBeCloseTo(2.6, 9);
  });

  test("한 변이 1024 기기 px을 넘으면 배율을 낮춰 1024에 맞춘다", () => {
    // 800 × 2.6 = 2080 → 1024, 배율 1024/800 = 1.28
    const big = coreCanvasSize(800, 2);
    expect(big.px).toBe(1024);
    expect(big.ratio).toBeCloseTo(1.28, 9);
  });

  test("상한에 막히는 경계에서도 1024를 넘지 않는다", () => {
    // 400 × 2.6 = 1040 → 1024, 배율 2.56
    const edge = coreCanvasSize(400, 2);
    expect(edge.px).toBe(1024);
    expect(edge.ratio).toBeCloseTo(2.56, 9);
  });

  test("CSS 크기가 0이어도 깨지지 않는다", () => {
    const zero = coreCanvasSize(0, 2);
    expect(zero.px).toBe(0);
    expect(zero.ratio).toBeCloseTo(2.6, 9);
  });
});

describe("renderMode", () => {
  test("WebGL이 있고 정상이면 셰이더", () => {
    expect(renderMode(true, false, false)).toBe("shader");
  });

  test("움직임 줄이기면 한 장", () => {
    expect(renderMode(true, false, true)).toBe("still");
  });

  test("WebGL이 없으면 CSS, 움직임 줄이기와 무관하다", () => {
    expect(renderMode(false, false, false)).toBe("css-fallback");
    expect(renderMode(false, false, true)).toBe("css-fallback");
  });

  test("컨텍스트를 잃으면 CSS", () => {
    expect(renderMode(true, true, false)).toBe("css-fallback");
    expect(renderMode(true, true, true)).toBe("css-fallback");
  });
});

import { describe, expect, test } from "bun:test";
import {
  TOAST_BOTTOM_DEFAULT_PX,
  TOAST_DEFAULT_WIDTH_PX,
  TOAST_MIN_WIDTH_ACTION_PX,
  TOAST_MIN_WIDTH_PX,
  boxesOverlap,
  cssBoxOf,
  TOAST_LIFT_GAP_PX,
  defaultToastBox,
  toastFit,
  toastWidth,
} from "../../src/views/shell/toaster-slot.ts";

// 창 1280×800. 토스트 영역은 오른쪽 끝에서 16px, 폭 360(왼쪽 904, 오른쪽 1264)
const VH = 800;
const toast = defaultToastBox(904, 1264, 0, VH);

test("the default box stands above the status bar and probes one line when empty", () => {
  expect(TOAST_BOTTOM_DEFAULT_PX).toBe(40);
  expect(toast).toEqual({ left: 904, right: 1264, bottom: 760, top: 712 });
  expect(defaultToastBox(904, 1264, 120, VH)).toEqual({
    left: 904,
    right: 1264,
    bottom: 760,
    top: 640,
  });
});

test("boxes that only touch do not overlap", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  expect(boxesOverlap(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  expect(boxesOverlap(a, { left: 9, top: 9, right: 20, bottom: 20 })).toBe(true);
});

describe("toastWidth narrows the toast into the gap right of the composer (DP-157, DP-170)", () => {
  test("nothing under the default box keeps the full width", () => {
    expect(toastWidth([], 1264, 0, VH, 200)).toBe(360);
    expect(TOAST_DEFAULT_WIDTH_PX).toBe(360);
    expect(TOAST_MIN_WIDTH_PX).toBe(200);
    expect(TOAST_MIN_WIDTH_ACTION_PX).toBe(280);
  });

  test("a wide window keeps the full width when the composer column ends before the toast", () => {
    // 1920 폭: 입력창 열이 1458에서 끝나고 토스트는 1544부터라 겹치지 않는다
    const send = { left: 1420, top: 1010, right: 1448, bottom: 1038 };
    const field = { left: 722, top: 990, right: 1458, bottom: 1040 };
    expect(toastWidth([send, field], 1904, 52, 1080, 200)).toBe(360);
  });

  test("1440×900 measured: the composer ends at 1212, the toast at 1424, so it narrows to 200", () => {
    const field = { left: 500, top: 760, right: 1212, bottom: 825 };
    expect(toastWidth([field], 1424, 52, 900, 200)).toBe(200);
    // 동작 단추가 있는 토스트는 280 아래로 줄지 않고, 올라가지도 않는다
    expect(toastWidth([field], 1424, 52, 900, 280)).toBe(280);
  });

  test("1280×800 measured: a 120px gap is too narrow, so the toast keeps the minimum width in place", () => {
    const field = { left: 420, top: 660, right: 1132, bottom: 725 };
    expect(toastWidth([field], 1264, 52, 800, 200)).toBe(200);
    expect(toastWidth([field], 1264, 52, 800, 280)).toBe(280);
  });

  test("the gap exactly at the minimum narrows to it; one pixel less stays at the minimum", () => {
    const at = { left: 300, top: 700, right: 1264 - 12 - 200, bottom: 760 };
    expect(toastWidth([at], 1264, 0, VH, 200)).toBe(200);
    expect(toastWidth([{ ...at, right: at.right + 1 }], 1264, 0, VH, 200)).toBe(200);
    expect(toastWidth([{ ...at, right: at.right - 72 }], 1264, 0, VH, 200)).toBe(272);
  });

  test("the widest overlapping control sets the gap and controls outside the box are ignored", () => {
    const send = { left: 1100, top: 730, right: 1128, bottom: 758 };
    const field = { left: 300, top: 720, right: 980, bottom: 760 };
    const far = { left: 10, top: 300, right: 1200, bottom: 320 };
    expect(toastWidth([field, send, far], 1264, 0, VH, 200)).toBe(200);
    expect(toastWidth([field, far], 1264, 0, VH, 200)).toBe(272);
  });

  test("a control reaching past the toast's right edge (restart bar button) keeps the minimum width", () => {
    const button = { left: 1200, top: 720, right: 1270, bottom: 748 };
    expect(toastWidth([button], 1264, 0, VH, 200)).toBe(200);
  });
});

describe("toastWidth under app zoom measures in CSS px (DP-173)", () => {
  test("cssBoxOf divides a screen-px box by the zoom", () => {
    expect(cssBoxOf({ left: 125, top: 250, right: 375, bottom: 500 }, 1.25)).toEqual({
      left: 100,
      top: 200,
      right: 300,
      bottom: 400,
    });
    expect(cssBoxOf({ left: 1, top: 2, right: 3, bottom: 4 }, 0)).toEqual({
      left: 1,
      top: 2,
      right: 3,
      bottom: 4,
    });
  });

  test("1440×900 at 125%: the toast fits the 324px screen gap instead of overlapping the composer", () => {
    // 화면 px: 입력창 오른쪽 끝 1100, 토스트 영역 오른쪽 끝 1424. 틈 324 - 12 = 312(화면) = 249.6(CSS)
    const z = 1.25;
    const field = { left: 500, top: 760, right: 1100, bottom: 825 };
    const fixed = toastWidth([cssBoxOf(field, z)], 1424 / z, 52 / z, 900 / z, 200);
    expect(fixed).toBe(247);
    // 화면에서 토스트 왼쪽 끝은 입력창 오른쪽 끝 + 12 이상(1424 - 247 × 1.25 = 1115.25)
    expect(1424 - fixed * z).toBeGreaterThanOrEqual(1100 + 12);
    // 고치기 전처럼 화면 px을 그대로 넣으면 312(CSS)라 화면 390px로 입력창을 66px 덮는다
    const naive = toastWidth([field], 1424, 52, 900, 200);
    expect([naive, 1424 - naive * z]).toEqual([312, 1034]);
  });
});

// AGE-75 질문 2 가: 좁은 창에서 토스트가 입력창의 모델 이름을 덮었다(chatQa 900폭). 틈이 최소 폭보다 좁으면 입력창 묶음 위로 올린다
describe("toastFit lifts the toast above the composer stack when the gap is too narrow (AGE-75)", () => {
  const base = { left: 0, height: 52, minWidth: 200, shrink: true, rails: [] };

  test("1920: the composer column ends before the toast, so it stays at the bottom with full width", () => {
    const field = { left: 722, top: 990, right: 1458, bottom: 1040 };
    const stack = { left: 710, top: 900, right: 1470, bottom: 1052 };
    expect(
      toastFit({ ...base, controls: [field], regions: [stack], right: 1904, viewportHeight: 1080 }),
    ).toEqual({ width: 360, bottom: 40, shift: 0 });
  });

  test("1440: a 200px gap narrows the toast in place", () => {
    const field = { left: 500, top: 760, right: 1212, bottom: 825 };
    const stack = { left: 488, top: 700, right: 1224, bottom: 838 };
    expect(
      toastFit({ ...base, controls: [field], regions: [stack], right: 1424, viewportHeight: 900 }),
    ).toEqual({ width: 200, bottom: 40, shift: 0 });
  });

  test("1440 with an action toast (minimum 280): lifted 8px above the stack's top with full width", () => {
    const field = { left: 500, top: 760, right: 1212, bottom: 825 };
    const stack = { left: 488, top: 700, right: 1224, bottom: 838 };
    expect(TOAST_LIFT_GAP_PX).toBe(8);
    expect(
      toastFit({
        ...base,
        minWidth: 280,
        controls: [field],
        regions: [stack],
        right: 1424,
        viewportHeight: 900,
      }),
    ).toEqual({ width: 360, bottom: 900 - 700 + 8, shift: 0 });
  });

  test("900: the toast would cover the model chip, so it goes above the approval card at the stack's top", () => {
    const model = { left: 640, top: 820, right: 760, bottom: 844 };
    const card = { left: 300, top: 560, right: 830, bottom: 700 };
    const stack = { left: 288, top: 548, right: 842, bottom: 860 };
    const fit = toastFit({
      ...base,
      controls: [model, card],
      regions: [stack],
      right: 884,
      viewportHeight: 900,
    });
    expect(fit).toEqual({ width: 360, bottom: 360, shift: 0 });
    // 올린 토스트(아래 끝 900 - 360 = 540)는 묶음 위쪽 끝(548)보다 위다
    expect(900 - fit.bottom).toBeLessThan(stack.top);
  });

  test("the centered toast of a compact window does not narrow; it lifts when it meets the composer", () => {
    const field = { left: 12, top: 600, right: 700, bottom: 660 };
    const stack = { left: 0, top: 580, right: 712, bottom: 672 };
    expect(
      toastFit({
        ...base,
        shrink: false,
        left: 8,
        controls: [field],
        regions: [stack],
        right: 704,
        viewportHeight: 700,
      }),
    ).toEqual({ width: 360, bottom: 700 - 580 + 8, shift: 0 });
    expect(
      toastFit({
        ...base,
        shrink: false,
        left: 8,
        controls: [],
        regions: [stack],
        right: 704,
        viewportHeight: 700,
      }),
    ).toEqual({ width: 360, bottom: 40, shift: 0 });
  });

  test("a stack taller than the window keeps the lifted toast inside the window", () => {
    const field = { left: 300, top: 760, right: 1300, bottom: 825 };
    const stack = { left: 288, top: 20, right: 1312, bottom: 838 };
    expect(
      toastFit({ ...base, controls: [field], regions: [stack], right: 1424, viewportHeight: 900 }),
    ).toEqual({ width: 360, bottom: 900 - 52 - 8, shift: 0 });
  });

  test("a lifted toast that would cover the floating rail steps left of it", () => {
    const model = { left: 640, top: 820, right: 760, bottom: 844 };
    const stack = { left: 288, top: 548, right: 842, bottom: 860 };
    // 막대는 본문 세로 가운데(창 끝에서 12, 폭 34)라 올린 토스트(위 488, 아래 540)와 겹친다
    const rail = { left: 854, top: 380, right: 888, bottom: 620 };
    expect(
      toastFit({
        ...base,
        controls: [model],
        regions: [stack],
        rails: [rail],
        right: 884,
        viewportHeight: 900,
      }),
    ).toEqual({ width: 360, bottom: 360, shift: 884 - 854 + 12 });
    // 아래 자리에 선 토스트는 막대와 만나지 않으므로 옮기지 않는다
    expect(
      toastFit({
        ...base,
        controls: [],
        regions: [stack],
        rails: [rail],
        right: 884,
        viewportHeight: 900,
      }),
    ).toEqual({ width: 360, bottom: 40, shift: 0 });
  });
});

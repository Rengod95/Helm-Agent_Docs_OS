import { describe, expect, test } from "bun:test";
import {
  TOAST_BOTTOM_DEFAULT_PX,
  TOAST_DEFAULT_WIDTH_PX,
  TOAST_MIN_WIDTH_ACTION_PX,
  TOAST_MIN_WIDTH_PX,
  boxesOverlap,
  defaultToastBox,
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

describe("toastWidth narrows the toast into the gap right of the composer and never lifts it (DP-157, DP-170)", () => {
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

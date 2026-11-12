import { describe, expect, test } from "bun:test";
import {
  TOAST_BOTTOM_DEFAULT_PX,
  TOAST_DEFAULT_WIDTH_PX,
  TOAST_MIN_WIDTH_ACTION_PX,
  TOAST_MIN_WIDTH_PX,
  boxesOverlap,
  defaultToastBox,
  toastBottomPx,
  toastFit,
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

test("without anything to avoid the toast sits at the default gap", () => {
  expect(toastBottomPx([], toast, VH)).toBe(40);
});

test("a composer whose send button lies under the toast lifts it above the stack", () => {
  // 1280 폭: 입력창 묶음 위쪽 끝 683, 보내기 단추가 오른쪽 아래(1100~1128, 730~758)
  const send = { left: 1100, top: 730, right: 1128, bottom: 758 };
  expect(toastBottomPx([{ top: 683, controls: [send] }], toast, VH)).toBe(800 - 683 + 12);
});

test("a wide window keeps the toast at the bottom when the composer column ends before it", () => {
  // 1920 폭: 입력창 열이 1458에서 끝나고 토스트는 1544부터라 겹치지 않는다
  const wide = defaultToastBox(1544, 1904, 52, 1080);
  const send = { left: 1420, top: 1010, right: 1448, bottom: 1038 };
  const field = { left: 722, top: 990, right: 1458, bottom: 1040 };
  expect(toastBottomPx([{ top: 960, controls: [send, field] }], wide, 1080)).toBe(40);
});

test("the highest overlapping place wins and a lower one never pulls the toast down", () => {
  const button = { left: 1200, top: 740, right: 1250, bottom: 760 };
  const far = { left: 10, top: 300, right: 50, bottom: 320 };
  expect(
    toastBottomPx(
      [
        { top: 740, controls: [button] },
        { top: 280, controls: [far] },
      ],
      toast,
      VH,
    ),
  ).toBe(800 - 740 + 12);
  // 위쪽 끝이 기본 간격보다 낮으면 기본 자리 그대로다
  expect(toastBottomPx([{ top: 790, controls: [button] }], toast, VH)).toBe(40);
});

test("boxes that only touch do not overlap", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  expect(boxesOverlap(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  expect(boxesOverlap(a, { left: 9, top: 9, right: 20, bottom: 20 })).toBe(true);
});

describe("toastFit narrows the toast into the gap right of the composer before lifting it (DP-157)", () => {
  test("nothing under the default box keeps the full width at the bottom", () => {
    expect(toastFit([], 1264, 0, VH)).toEqual({ width: 360, bottom: 40 });
    expect(TOAST_DEFAULT_WIDTH_PX).toBe(360);
    expect(TOAST_MIN_WIDTH_PX).toBe(200);
    expect(TOAST_MIN_WIDTH_ACTION_PX).toBe(280);
  });

  test("1440×900 measured: the composer ends at 1212, the toast at 1424, so it narrows to 200", () => {
    const field = { left: 500, top: 760, right: 1212, bottom: 825 };
    expect(toastFit([{ top: 743, controls: [field] }], 1424, 52, 900)).toEqual({
      width: 200,
      bottom: 40,
    });
    // 동작 단추가 있는 토스트는 280이 필요해 올린다
    expect(toastFit([{ top: 743, controls: [field] }], 1424, 52, 900, 280)).toEqual({
      width: 360,
      bottom: 900 - 743 + 12,
    });
  });

  test("1280×800 measured: a 120px gap is too narrow, so the toast lifts at full width", () => {
    const field = { left: 420, top: 660, right: 1132, bottom: 725 };
    expect(toastFit([{ top: 643, controls: [field] }], 1264, 52, 800)).toEqual({
      width: 360,
      bottom: 800 - 643 + 12,
    });
  });

  test("the gap exactly at the minimum still narrows; one pixel less lifts at full width", () => {
    const at = { left: 300, top: 700, right: 1264 - 12 - 200, bottom: 760 };
    expect(toastFit([{ top: 683, controls: [at] }], 1264, 0, VH)).toEqual({
      width: 200,
      bottom: 40,
    });
    const under = { ...at, right: at.right + 1 };
    expect(toastFit([{ top: 683, controls: [under] }], 1264, 0, VH)).toEqual({
      width: 360,
      bottom: 800 - 683 + 12,
    });
  });

  test("the centred compact place never narrows, it only lifts", () => {
    const field = { left: 300, top: 700, right: 980, bottom: 760 };
    expect(toastFit([{ top: 683, controls: [field] }], 1264, 0, VH).width).toBe(272);
    expect(toastFit([{ top: 683, controls: [field] }], 1264, 0, VH, null)).toEqual({
      width: 360,
      bottom: 800 - 683 + 12,
    });
  });

  test("a control reaching past the toast's right edge (restart bar button) lifts it", () => {
    const button = { left: 1200, top: 720, right: 1270, bottom: 748 };
    expect(toastFit([{ top: 700, controls: [button] }], 1264, 0, VH).bottom).toBe(800 - 700 + 12);
  });
});

import { expect, test } from "bun:test";
import {
  columnRightOf,
  TOAST_BOTTOM_DEFAULT_PX,
  toastEdgeOf,
} from "../../src/views/shell/toaster-slot.ts";

const bottom = { kind: "bottom", px: 40 } as const;
const top = { kind: "top" } as const;

test("a screen without a conversation column keeps the mock position of 40px", () => {
  expect(TOAST_BOTTOM_DEFAULT_PX).toBe(40);
  expect(toastEdgeOf({ kind: "end", endPx: 56 }, null, 1280)).toEqual(bottom);
  expect(toastEdgeOf({ kind: "end", endPx: 56 }, { left: 272, width: 0 }, 1280)).toEqual(bottom);
});

test("the column's right edge is the centered 736px column minus its 12px padding", () => {
  // 1280 창, 왼쪽 패널 272: 무대 1008, 열 736이 가운데 → 오른쪽 끝 272 + 872 - 12 = 1132(캡처의 입력창 끝)
  expect(columnRightOf({ left: 272, width: 1008 })).toBe(1132);
  // 무대가 열보다 좁으면 열이 무대를 다 쓴다
  expect(columnRightOf({ left: 0, width: 600 })).toBe(588);
});

test("a wide window puts the toast in the gap beside the column, above the status bar", () => {
  // 1920 창, 패널 272: 열 끝 1452, 오른쪽 틈 1920 - 56 - 1452 = 412 ≥ 372
  expect(toastEdgeOf({ kind: "end", endPx: 56 }, { left: 272, width: 1648 }, 1920)).toEqual(bottom);
});

test("a window too narrow for the gap moves the toast under the header", () => {
  // 1280(캡처 c1): 틈 1280 - 56 - 1132 = 92
  expect(toastEdgeOf({ kind: "end", endPx: 56 }, { left: 272, width: 1008 }, 1280)).toEqual(top);
  // 1440(캡처 a2): 틈 1440 - 56 - 1212 = 172
  expect(toastEdgeOf({ kind: "end", endPx: 56 }, { left: 272, width: 1168 }, 1440)).toEqual(top);
  // 열린 well이 틈을 줄인다
  expect(toastEdgeOf({ kind: "end", endPx: 426 }, { left: 272, width: 1648 }, 1920)).toEqual(top);
  expect(toastEdgeOf({ kind: "center" }, { left: 0, width: 700 }, 700)).toEqual(top);
});

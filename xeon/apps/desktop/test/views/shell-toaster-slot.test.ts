import { expect, test } from "bun:test";
import { TOAST_BOTTOM_DEFAULT_PX, toastBottomPx } from "../../src/views/shell/toaster-slot.ts";

test("without cards the toast sits at the mock position of 40px", () => {
  expect(TOAST_BOTTOM_DEFAULT_PX).toBe(40);
  expect(toastBottomPx(null, 860)).toBe(40);
});

test("a stack of cards lifts the toast above its top edge", () => {
  // 카드 묶음 위쪽 끝이 683이면 창 아래에서 177px, 거기에 12px 여유를 둔다
  expect(toastBottomPx(683, 860)).toBe(189);
  // 승인 카드가 위로 길어지면 그만큼 더 올라간다
  expect(toastBottomPx(400, 860)).toBe(472);
});

test("a stack lower than the default gap never pulls the toast under it", () => {
  expect(toastBottomPx(835, 860)).toBe(TOAST_BOTTOM_DEFAULT_PX);
});

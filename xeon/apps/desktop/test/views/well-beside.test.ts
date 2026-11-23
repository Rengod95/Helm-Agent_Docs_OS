import { expect, test } from "bun:test";
import {
  CHAT_COLUMN_MIN_PX,
  CHAT_COLUMN_PX,
  wellBesideOf,
} from "../../src/views/shell/well-beside.ts";

// AGE-75 질문 1 가: 작업 패널(well)이 대화 열을 덮지 않는다. 무대 폭은 창 폭 − 왼쪽 패널 272다
test("the column and its minimum are the design widths", () => {
  expect([CHAT_COLUMN_PX, CHAT_COLUMN_MIN_PX]).toEqual([736, 480]);
});

test("1920 with the panel: the centered column already clears the well, so nothing moves", () => {
  expect(wellBesideOf(1920 - 272, 352)).toBe(0);
});

test("1440 with the panel: the column moves left just enough to end 12px before the well", () => {
  const stage = 1440 - 272;
  const pad = wellBesideOf(stage, 352);
  expect(pad).toBe(404);
  // 열의 오른쪽 끝 = (무대 − 여백) / 2 + 368 = 무대 − (막대 자리 60 + well 352 + 6)
  expect((stage - (pad ?? 0)) / 2 + CHAT_COLUMN_PX / 2).toBe(stage - 418);
});

test("1280 with the panel: the column narrows to what is left beside the well", () => {
  expect(wellBesideOf(1280 - 272, 352)).toBe(418);
  expect(1280 - 272 - 418).toBe(590);
});

test("a stage that would leave less than 480 keeps the well floating over it", () => {
  expect(wellBesideOf(1024 - 272, 352)).toBeNull();
  expect(wellBesideOf(480 + 418, 352)).toBe(418);
  expect(wellBesideOf(480 + 418 - 1, 352)).toBeNull();
  // 넓은 well(480)은 같은 무대에서 먼저 뜬다
  expect(wellBesideOf(1008, 480)).toBeNull();
});

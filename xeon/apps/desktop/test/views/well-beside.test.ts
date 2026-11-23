import { expect, test } from "bun:test";
import {
  CHAT_COLUMN_MIN_PX,
  CHAT_COLUMN_PX,
  wellBesideOf,
  wellCoverWidthOf,
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

// AGE-77 artView: 넓게 편 well이 비키지 못하면 무대 왼쪽 끝까지 닿아 대화 열의 글이 가장자리 밖으로 삐져 보이지 않는다
test("a wide well that cannot make the column step aside covers the whole stage up to the rail", () => {
  // 1440 창(무대 1168): 880 넓은 well은 비킬 수 없다
  expect(wellBesideOf(1168, 880)).toBeNull();
  expect(wellCoverWidthOf(1168)).toBe(1168 - 66);
  // 대화 열(736, 가운데 정렬) 왼쪽 끝이 well 왼쪽 끝보다 오른쪽이다: well 폭 + 막대 자리가 무대를 채운다
  const leftOfColumn = (1168 - CHAT_COLUMN_PX) / 2;
  const leftOfWell = 1168 - 66 - wellCoverWidthOf(1168);
  expect(leftOfWell).toBeLessThanOrEqual(leftOfColumn);
  expect(wellCoverWidthOf(0)).toBe(0);
});

import { describe, expect, test } from "bun:test";
import { anchorShiftOf, releasesOnExpand, unseenOf } from "../../src/views/virtual-list-anchor.ts";

// 가상 목록의 보는 자리 규칙(dzM2 시안 §10, DP-120)

const base = {
  keys: ["a", "b", "c", "d"],
  offsets: [0, 100, 200, 300],
  heights: new Map([
    ["a", 100],
    ["b", 100],
    ["c", 100],
    ["d", 100],
  ]),
  padTop: 16,
  estimate: 96,
};

describe("위 줄 높이 변화의 닻", () => {
  test("보이는 영역 위에 통째로 있는 줄이 자라면 그만큼 스크롤을 옮긴다", () => {
    // 보는 자리 250: a(16~116)·b(116~216)는 위에 있고 c는 걸친다
    const shift = anchorShiftOf({
      ...base,
      batch: new Map([
        ["a", 140],
        ["b", 90],
        ["c", 300],
      ]),
      scrollTop: 250,
    });
    expect(shift).toBe(30);
  });

  test("보이는 영역에 걸치거나 아래인 줄, 모르는 키는 세지 않는다", () => {
    const shift = anchorShiftOf({
      ...base,
      batch: new Map([
        ["c", 300],
        ["zz", 500],
      ]),
      scrollTop: 250,
    });
    expect(shift).toBe(0);
  });

  test("재지 않은 줄은 추정 높이에서 바뀐 것으로 본다", () => {
    const shift = anchorShiftOf({
      ...base,
      heights: new Map(),
      batch: new Map([["a", 120]]),
      scrollTop: 250,
    });
    expect(shift).toBe(24);
  });
});

describe("펼칠 때 붙음", () => {
  test("마지막이 아닌 줄을 펼칠 때만 푼다", () => {
    expect(releasesOnExpand({ opening: true, rowKey: "b", lastKey: "d" })).toBe(true);
    expect(releasesOnExpand({ opening: true, rowKey: "d", lastKey: "d" })).toBe(false);
    expect(releasesOnExpand({ opening: false, rowKey: "b", lastKey: "d" })).toBe(false);
    expect(releasesOnExpand({ opening: true, rowKey: null, lastKey: "d" })).toBe(false);
  });
});

describe("안 본 줄 수", () => {
  test("바닥에 있던 때 없던 줄 가운데 세는 줄만", () => {
    const rows = [
      { key: "a", message: true },
      { key: "b", message: true },
      { key: "c", message: false },
      { key: "d", message: true },
    ];
    expect(unseenOf(rows, new Set(["a"]), (row) => row.message)).toBe(2);
    expect(unseenOf(rows, new Set(["a", "b", "c", "d"]), (row) => row.message)).toBe(0);
  });
});

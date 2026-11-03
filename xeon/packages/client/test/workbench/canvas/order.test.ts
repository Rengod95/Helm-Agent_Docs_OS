import { describe, expect, test } from "bun:test";
import {
  dropIndex,
  moveHandler,
  nextOrderForKey,
  skippableAfterMove,
  type ChipBox,
} from "../../../src/workbench/canvas/order.ts";

const ORDER = ["a", "b", "c", "d"];

describe("moveHandler", () => {
  test("id를 뺀 목록의 toIndex 자리에 넣는다", () => {
    expect(moveHandler(ORDER, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveHandler(ORDER, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveHandler(ORDER, "b", 1)).toEqual(["a", "b", "c", "d"]);
  });

  test("범위를 벗어나면 가장자리에 붙는다", () => {
    expect(moveHandler(ORDER, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveHandler(ORDER, "b", -5)).toEqual(["b", "a", "c", "d"]);
  });

  test("입력을 바꾸지 않는다", () => {
    const input = ["a", "b", "c"];
    const out = moveHandler(input, "c", 0);
    expect(out).toEqual(["c", "a", "b"]);
    expect(input).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(input);
  });

  test("없는 id면 같은 순서의 복사본을 돌려준다", () => {
    const out = moveHandler(ORDER, "zz", 1);
    expect(out).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(ORDER);
  });
});

describe("nextOrderForKey", () => {
  test("Alt+Left는 한 칸 앞, Alt+Right는 한 칸 뒤", () => {
    expect(nextOrderForKey(ORDER, "b", "left")).toEqual(["b", "a", "c", "d"]);
    expect(nextOrderForKey(ORDER, "b", "right")).toEqual(["a", "c", "b", "d"]);
  });

  test("끝에서는 그대로다", () => {
    expect(nextOrderForKey(ORDER, "a", "left")).toEqual(["a", "b", "c", "d"]);
    expect(nextOrderForKey(ORDER, "d", "right")).toEqual(["a", "b", "c", "d"]);
  });

  test("없는 id면 그대로다", () => {
    expect(nextOrderForKey(ORDER, "zz", "right")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("dropIndex", () => {
  // 칩 셋이 한 줄(위 0, 아래 30)에 있다. 가운데는 a 50, b 160, c 270
  const boxes: ChipBox[] = [
    { id: "a", left: 0, right: 100, top: 0, bottom: 30 },
    { id: "b", left: 110, right: 210, top: 0, bottom: 30 },
    { id: "c", left: 220, right: 320, top: 0, bottom: 30 },
  ];

  test("같은 줄의 왼쪽 절반이면 그 칩 앞", () => {
    expect(dropIndex(boxes, "x", 10, 15)).toBe(0);
    expect(dropIndex(boxes, "x", 150, 15)).toBe(1);
    expect(dropIndex(boxes, "x", 250, 15)).toBe(2);
  });

  test("오른쪽 절반이면 다음 칩 앞, 마지막 칩의 오른쪽이면 끝", () => {
    // 80은 a의 오른쪽 절반: 다음 칩 b(가운데 160) 앞
    expect(dropIndex(boxes, "x", 80, 15)).toBe(1);
    expect(dropIndex(boxes, "x", 400, 15)).toBe(3);
  });

  test("칩 위쪽이면 줄 첫 자리", () => {
    expect(dropIndex(boxes, "x", 50, -5)).toBe(0);
  });

  test("줄 아래로 벗어나면 끝", () => {
    expect(dropIndex(boxes, "x", 50, 40)).toBe(3);
  });

  test("끌고 있는 칩은 셈하지 않는다", () => {
    // a를 끄는 중이면 줄은 b, c. x 150은 b의 왼쪽 절반 → 0
    expect(dropIndex(boxes, "a", 150, 15)).toBe(0);
  });
});

describe("skippableAfterMove", () => {
  test("차단(first) 줄에서 새로 앞서게 된 핸들러만 나온다", () => {
    // b가 맨 앞으로: a는 이제 b 뒤라 건너뛰어질 수 있다. c는 앞선 것이 그대로다
    expect(skippableAfterMove(["a", "b", "c"], ["b", "a", "c"], "first")).toEqual(["a"]);
  });

  test("c를 맨 앞으로 옮기면 나머지 둘 다 새 앞선 핸들러가 생긴다", () => {
    expect(skippableAfterMove(["a", "b", "c"], ["c", "a", "b"], "first")).toEqual(["a", "b"]);
  });

  test("c를 b 앞으로 옮기면 b만 새로 건너뛰어진다", () => {
    expect(skippableAfterMove(["a", "b", "c", "d"], ["a", "c", "b", "d"], "first")).toEqual(["b"]);
  });

  test("순서가 그대로면 비어 있다", () => {
    expect(skippableAfterMove(["a", "b", "c"], ["a", "b", "c"], "first")).toEqual([]);
  });

  test("first가 아닌 접기는 건너뜀이 없다", () => {
    expect(skippableAfterMove(["a", "b", "c"], ["c", "a", "b"], "chain")).toEqual([]);
    expect(skippableAfterMove(["a", "b", "c"], ["c", "a", "b"], "collect")).toEqual([]);
  });
});

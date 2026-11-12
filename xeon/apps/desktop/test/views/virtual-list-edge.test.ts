import { describe, expect, test } from "bun:test";
import { edgeFadeOf } from "../../src/views/virtual-list-edge.ts";

// 대화 기록 위아래 흐림(dzE 시안 §4, DP-128)

describe("edgeFadeOf", () => {
  test("맨 위면 위를 끄고, 아래에 가려진 내용이 있으면 아래를 켠다", () => {
    expect(edgeFadeOf({ top: 0, scrollHeight: 2000, clientHeight: 600 })).toEqual({
      top: false,
      bottom: true,
    });
  });

  test("가운데면 둘 다 켠다", () => {
    expect(edgeFadeOf({ top: 500, scrollHeight: 2000, clientHeight: 600 })).toEqual({
      top: true,
      bottom: true,
    });
  });

  test("바닥에서 24px 안쪽이면 아래를 끈다(따라 내려가는 동안 깜빡이지 않게)", () => {
    expect(edgeFadeOf({ top: 1380, scrollHeight: 2000, clientHeight: 600 }).bottom).toBe(false);
    expect(edgeFadeOf({ top: 1370, scrollHeight: 2000, clientHeight: 600 }).bottom).toBe(true);
  });

  test("내용이 영역보다 짧으면 둘 다 끈다", () => {
    expect(edgeFadeOf({ top: 0, scrollHeight: 300, clientHeight: 600 })).toEqual({
      top: false,
      bottom: false,
    });
  });
});

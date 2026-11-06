import { describe, expect, test } from "bun:test";
import {
  chipWidth,
  visibleChips,
  type ChipCandidate,
} from "../../../src/views/craft/orbit-chips.ts";

const chip = (
  id: string,
  x: number,
  y: number,
  extra: Partial<ChipCandidate> = {},
): ChipCandidate => ({
  id,
  x,
  y,
  name: id,
  right: true,
  priority: 0,
  forced: false,
  ...extra,
});

describe("orbit chips: width estimate", () => {
  test("adds padding to 7.2px per Latin letter and 13px per Hangul syllable", () => {
    expect(chipWidth("abcd")).toBe(Math.ceil(24 + 4 * 7.2));
    expect(chipWidth("확장")).toBe(24 + 26);
  });
});

describe("orbit chips: which labels show", () => {
  test("two chips whose boxes overlap keep only the higher priority one", () => {
    const shown = visibleChips(
      [chip("low", 100, 100, { priority: 0 }), chip("high", 110, 100, { priority: 2 })],
      [],
      1,
      1,
    );
    expect([...shown]).toEqual(["high"]);
  });

  test("far apart chips all show", () => {
    const shown = visibleChips([chip("a", 0, 0), chip("b", 0, 200), chip("c", 400, 0)], [], 1, 1);
    expect([...shown].toSorted()).toEqual(["a", "b", "c"]);
  });

  test("a forced chip shows even over another and pushes the other out", () => {
    const shown = visibleChips(
      [chip("a", 100, 100, { priority: 5 }), chip("b", 105, 100, { forced: true })],
      [],
      1,
      1,
    );
    expect([...shown]).toEqual(["b"]);
  });

  test("zooming out packs the same dots closer, so the left chip that fit at 1x is hidden at 0.5x", () => {
    const items = [chip("aaaa", 0, 0), chip("bbbb", 100, 0)];
    expect([...visibleChips(items, [], 1, 1)].toSorted()).toEqual(["aaaa", "bbbb"]);
    // aaaa의 이름표가 bbbb 점을 덮게 되어 숨고, 오른쪽 끝 bbbb만 남는다
    expect([...visibleChips(items, [], 0.5, 1)]).toEqual(["bbbb"]);
  });

  test("a chip that would cover another dot is hidden", () => {
    const shown = visibleChips([chip("a", 0, 0), chip("dot", 30, 0, { right: false })], [], 1, 1);
    expect(shown.has("a")).toBe(false);
  });

  test("a chip over a layer or group label obstacle is hidden", () => {
    const items = [chip("a", 0, 0)];
    expect([...visibleChips(items, [{ x: 40, y: 0, w: 60, h: 24 }], 1, 1)]).toEqual([]);
    expect([...visibleChips(items, [{ x: 400, y: 0, w: 60, h: 24 }], 1, 1)]).toEqual(["a"]);
  });

  test("a left-side chip sits to the left of its dot", () => {
    const shown = visibleChips(
      [chip("a", 200, 0, { right: false }), chip("b", 300, 0, { right: true })],
      [],
      1,
      1,
    );
    expect([...shown].toSorted()).toEqual(["a", "b"]);
  });
});

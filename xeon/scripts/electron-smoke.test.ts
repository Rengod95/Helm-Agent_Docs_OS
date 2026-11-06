import { describe, expect, test } from "bun:test";
import { boundsClose, mainWindowOf, parseWindowLine, savedBoundsOf } from "./electron-smoke.ts";

describe("parseWindowLine", () => {
  test("reads one probe line", () => {
    expect(parseWindowLine("27500|0|1|350|205|1100|760")).toEqual({
      id: 27500,
      layer: 0,
      onscreen: true,
      bounds: { x: 350, y: 205, width: 1100, height: 760 },
    });
  });

  test("rejects lines of another shape", () => {
    expect(parseWindowLine("")).toBeUndefined();
    expect(parseWindowLine("1|0|1|2|3|4")).toBeUndefined();
    expect(parseWindowLine("a|0|1|2|3|4|5")).toBeUndefined();
  });
});

describe("mainWindowOf", () => {
  test("skips the empty full-width helper windows and off-screen windows", () => {
    const rows = [
      parseWindowLine("27505|0|0|0|0|1800|39"),
      parseWindowLine("27504|0|1|0|0|1800|39"),
      parseWindowLine("27499|0|0|10|10|800|600"),
      parseWindowLine("27500|0|1|350|205|1100|760"),
    ].flatMap((row) => (row === undefined ? [] : [row]));
    expect(mainWindowOf(rows)?.id).toBe(27500);
    expect(mainWindowOf([])).toBeUndefined();
  });
});

describe("boundsClose and savedBoundsOf", () => {
  const a = { x: 120, y: 140, width: 900, height: 640 };

  test("tolerates the given slack and no more", () => {
    expect(boundsClose(a, { ...a, x: 122, height: 638 }, 2)).toBe(true);
    expect(boundsClose(a, { ...a, width: 903 }, 2)).toBe(false);
  });

  test("reads the window state file the shell writes", () => {
    expect(savedBoundsOf('{"x":504,"y":-131,"width":1071,"height":787}')).toEqual({
      x: 504,
      y: -131,
      width: 1071,
      height: 787,
    });
    expect(savedBoundsOf("not json")).toBeUndefined();
    expect(savedBoundsOf('{"x":1}')).toBeUndefined();
  });
});

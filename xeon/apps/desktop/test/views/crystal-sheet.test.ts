import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sheetRowFor, yawFrames } from "../../src/views/effects/crystal-mark.tsx";
import { CRYSTAL_SHEET } from "../../src/views/effects/crystal-sheet.ts";

const EFFECTS = join(import.meta.dir, "../../src/views/effects");

/** PNG 머리(IHDR)의 너비·높이·색 형식(6 = RGBA) */
function pngHeader(file: string): readonly [number, number, number] {
  const bytes = readFileSync(join(EFFECTS, file));
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return [view.getUint32(16), view.getUint32(20), bytes[25] ?? -1];
}

const round = (pairs: readonly (readonly [number, number])[]): number[][] =>
  pairs.map(([frame, weight]) => [frame, Math.round(weight * 100) / 100]);

describe("crystal sprite sheet (DP-223, lcMk3)", () => {
  test("both baked sheets match the layout table", () => {
    const { width, height, rows, yaws, apart } = CRYSTAL_SHEET;
    const last = rows.at(-1);
    expect([
      pngHeader("crystal-dark.png"),
      pngHeader("crystal-light.png"),
      rows.reduce((sum, row) => sum + row.box, 0),
      (last?.top ?? 0) + (last?.box ?? 0),
      rows.every((row) => row.box * yaws.length * 2 <= width),
      apart.length,
    ]).toEqual([[width, height, 6], [width, height, 6], height, height, true, yaws.length]);
  });

  test("a mark draws from the smallest baked box that covers its device pixels", () => {
    expect([14, 20, 28, 40, 41, 42, 60, 80].map((need) => sheetRowFor(need)?.box)).toEqual([
      28, 28, 28, 40, 64, 64, 64, 64,
    ]);
  });

  test("a yaw between two baked angles mixes the two neighbours, and outside them holds the end", () => {
    const yaws = CRYSTAL_SHEET.yaws;
    const rest = yaws.indexOf(0);
    expect([
      round(yawFrames(0)),
      round(yawFrames(0.07)),
      round(yawFrames(-1)),
      round(yawFrames(2)),
    ]).toEqual([
      [[rest, 1]],
      [
        [rest, 0.5],
        [rest + 1, 0.5],
      ],
      [[0, 1]],
      [[yaws.length - 1, 1]],
    ]);
  });
});

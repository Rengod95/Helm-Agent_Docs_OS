import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  boundsClose,
  findSizedFile,
  isAddonReport,
  latestMacYml,
  mainWindowOf,
  parseWindowLine,
  savedBoundsOf,
} from "./electron-smoke.ts";

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

describe("isAddonReport", () => {
  test("accepts a loaded addon with the documented shape", () => {
    expect(isAddonReport("native=true available=true biometry=touchid")).toBe(true);
    expect(isAddonReport("native=true available=false biometry=none\n")).toBe(true);
  });

  test("rejects a missing binary, another shape and empty output", () => {
    expect(isAddonReport("native=false available=false biometry=none")).toBe(false);
    expect(isAddonReport("native=true available=maybe biometry=none")).toBe(false);
    expect(isAddonReport("native=true available=true biometry=retina")).toBe(false);
    expect(isAddonReport("")).toBe(false);
    expect(isAddonReport("Error: dlopen failed")).toBe(false);
  });
});

describe("latestMacYml", () => {
  test("names the zip with its sha512 and size", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha = createHash("sha512").update(bytes).digest("base64");
    expect(latestMacYml("A-1.0.0.zip", bytes, "1.0.0").split("\n")).toEqual([
      "version: 1.0.0",
      "files:",
      "  - url: A-1.0.0.zip",
      `    sha512: ${sha}`,
      "    size: 4",
      "path: A-1.0.0.zip",
      `sha512: ${sha}`,
      "releaseDate: '2026-01-01T00:00:00.000Z'",
      "",
    ]);
  });
});

describe("findSizedFile", () => {
  test("finds a file by name and exact size under nested folders", () => {
    const dir = mkdtempSync(join(tmpdir(), "smoke-find-"));
    try {
      mkdirSync(join(dir, "pending"));
      writeFileSync(join(dir, "pending", "a.zip"), "12345");
      expect(findSizedFile(dir, "a.zip", 5)).toBe(join(dir, "pending", "a.zip"));
      expect(findSizedFile(dir, "a.zip", 4)).toBeUndefined();
      expect(findSizedFile(dir, "b.zip", 5)).toBeUndefined();
      expect(findSizedFile(join(dir, "none"), "a.zip", 5)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { expect, test } from "bun:test";
import {
  FIRST_SCREEN_MIN_BYTES,
  SIZE_CAP_BYTES,
  idleMemory,
  isFirstScreen,
  median,
  mib,
  parsePs,
  sizeReport,
} from "./desktop-benchmark.ts";

test("the app size is shell plus sidecar, compared with the 500 MiB cap", () => {
  const MIB = 1024 * 1024;
  expect(sizeReport({ shellBytes: 14 * MIB, sidecarBytes: 96 * MIB, uiBytes: 3 * MIB })).toEqual({
    totalMib: 110,
    shellMib: 14,
    sidecarMib: 96,
    uiMib: 3,
    capMib: 500,
    verdict: "within",
  });
  expect(sizeReport({ shellBytes: 1, sidecarBytes: SIZE_CAP_BYTES, uiBytes: 0 }).verdict).toBe(
    "over",
  );
  expect(sizeReport({ shellBytes: 0, sidecarBytes: SIZE_CAP_BYTES, uiBytes: 0 }).verdict).toBe(
    "within",
  );
  expect(mib(1572864)).toBe(1.5);
});

test("ps lines parse and bad lines are skipped", () => {
  expect(
    parsePs("  10     1  2048 /a/fresnel-desktop\nnot a row\n 11 10 1024 /a/fresnel\n"),
  ).toEqual([
    { pid: 10, ppid: 1, rssKb: 2048, command: "/a/fresnel-desktop" },
    { pid: 11, ppid: 10, rssKb: 1024, command: "/a/fresnel" },
  ]);
});

test("idle memory sums the app tree and only the WebKit helpers that are new", () => {
  const rows = parsePs(
    [
      "10 1 2048 /a/fresnel-desktop",
      "11 10 1024 /a/fresnel",
      "12 1 512 /System/WebKit.framework/XPCServices/com.apple.WebKit.WebContent.xpc/x",
      "13 1 4096 /System/WebKit.framework/XPCServices/com.apple.WebKit.WebContent.xpc/x",
      "14 1 8192 /usr/bin/other",
    ].join("\n"),
  );
  expect(idleMemory(rows, 10, new Set([13]))).toEqual({
    totalMib: 3.5,
    shellMib: 2,
    engineMib: 1,
    webkitMib: 0.5,
  });
});

test("median of odd and even counts, and none", () => {
  expect(median([5, 1, 3])).toBe(3);
  expect(median([4, 1, 3, 2])).toBe(2.5);
  expect(median([])).toBeUndefined();
});

test("a window counts as painted at the byte threshold", () => {
  expect(isFirstScreen(FIRST_SCREEN_MIN_BYTES - 1)).toBe(false);
  expect(isFirstScreen(FIRST_SCREEN_MIN_BYTES)).toBe(true);
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAppLog, LOG_FILE_NAME, sanitizeLogLine } from "../src/main/lib/applog.ts";

const fixed = (): Date => new Date("2026-11-06T01:02:03.004Z");

describe("app log", () => {
  test("replaces control characters except tab with a space", () => {
    expect(sanitizeLogLine("a\tb\u001b[31mc\nd")).toBe("a\tb [31mc d");
  });

  test("appends one timestamped line per call to the log file", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "applog-")), "logs");
    const log = createAppLog({ dir, now: fixed, stderr: () => undefined });
    log.line("first");
    log.line("second\nline");
    expect(readFileSync(path.join(dir, LOG_FILE_NAME), "utf8")).toBe(
      "2026-11-06T01:02:03.004Z first\n2026-11-06T01:02:03.004Z second line\n",
    );
  });

  test("falls back to stderr without a directory", () => {
    const written: string[] = [];
    const log = createAppLog({ dir: null, now: fixed, stderr: (text) => written.push(text) });
    log.line("hello");
    expect(written).toEqual(["2026-11-06T01:02:03.004Z hello\n"]);
  });
});

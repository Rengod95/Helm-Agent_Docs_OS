import { describe, expect, test } from "bun:test";
import { createJsonLinesLogger } from "../src/logger.ts";
import { eventOf, parseLine } from "./support/json.ts";
import { manualClock } from "./support/clock.ts";

function setup(level: "debug" | "info" | "warn" | "error" = "info") {
  const clock = manualClock();
  const lines: string[] = [];
  const logger = createJsonLinesLogger({
    clock,
    sink: (line) => lines.push(line),
    level,
    redact: (line) => line,
  });
  return { clock, lines, logger };
}

describe("logger", () => {
  test("레벨 필터: info 레벨에서 debug는 sink에 가지 않고 직렬화도 하지 않는다", () => {
    const { lines, logger } = setup("info");
    let serialized = 0;
    const lazy = {
      get value(): string {
        serialized += 1;
        return "x";
      },
    };
    logger.debug("tool.started", lazy);
    logger.info("tool.finished", { n: 1 });
    logger.warn("tool.slow");
    logger.error("tool.failed");
    expect(serialized).toBe(0);
    expect(lines.map(eventOf)).toEqual(["tool.finished", "tool.slow", "tool.failed"]);
  });

  test("필드 순서와 child: ts, level, event, base, child, 호출 필드. 같은 키는 뒤가 이긴다", () => {
    const clock = manualClock(1_767_571_200_000);
    const lines: string[] = [];
    const logger = createJsonLinesLogger({
      clock,
      sink: (line) => lines.push(line),
      level: "debug",
      redact: (line) => line,
      baseFields: { app: "xeon", who: "base" },
    });
    const child = logger.child({ component: "store", who: "child" });
    child.info("commit.done", { n: 2, who: "call" });
    expect(lines).toEqual([
      '{"ts":1767571200000,"level":"info","event":"commit.done","app":"xeon","who":"call","component":"store","n":2}',
    ]);
  });

  test("ts는 주입한 시계 값이다", async () => {
    const { clock, lines, logger } = setup();
    logger.info("a");
    await clock.advance(1500);
    logger.info("b");
    const ts = lines.map((l) => Number(parseLine(l)["ts"]));
    expect(ts[1]).toBe((ts[0] ?? 0) + 1500);
  });

  test("마스킹 훅 호출: 모든 줄이 redact를 거친다", () => {
    const clock = manualClock();
    const seen: string[] = [];
    const out: string[] = [];
    const logger = createJsonLinesLogger({
      clock,
      sink: (line) => out.push(line),
      level: "debug",
      redact: (line) => {
        seen.push(line);
        return line.replaceAll("secret-value", "[REDACTED]");
      },
    });
    logger.info("a", { token: "secret-value" });
    logger.child({ c: 1 }).error("b", { note: "secret-value" });
    expect(seen.length).toBe(2);
    expect(out.join("\n")).not.toContain("secret-value");
    expect(out[0]).toContain("[REDACTED]");
  });

  test("redact가 던지면 원문 줄이 sink에 가지 않고 log.redact_failed 한 줄만 간다", () => {
    const clock = manualClock();
    const out: string[] = [];
    const logger = createJsonLinesLogger({
      clock,
      sink: (line) => out.push(line),
      level: "debug",
      redact: () => {
        throw new Error("boom");
      },
    });
    logger.info("a", { token: "secret-value" });
    expect(out).toEqual(['{"event":"log.redact_failed"}']);
  });

  test("직렬화할 수 없는 값은 log.serialize_failed 한 줄만 간다", () => {
    const { lines, logger } = setup();
    // 읽는 순간 던지는 필드: 직렬화 단계의 실패를 흉내 낸다
    const bad = {
      get field(): string {
        throw new Error("cannot read");
      },
    };
    logger.info("a", bad);
    expect(lines).toEqual(['{"event":"log.serialize_failed"}']);
  });

  test("setLevel: 실행 중 레벨 변경이 다음 호출부터 반영되고 child에도 번진다", () => {
    const { lines, logger } = setup("error");
    const child = logger.child({ c: 1 });
    logger.info("hidden");
    child.info("hidden");
    logger.setLevel("debug");
    child.debug("shown");
    logger.info("shown");
    logger.setLevel("error");
    child.warn("hidden");
    expect(lines.length).toBe(2);
  });

  test("sink의 예외는 삼키지 않는다", () => {
    const clock = manualClock();
    const logger = createJsonLinesLogger({
      clock,
      sink: () => {
        throw new Error("disk full");
      },
      level: "info",
      redact: (line) => line,
    });
    expect(() => logger.info("a")).toThrow("disk full");
  });
});

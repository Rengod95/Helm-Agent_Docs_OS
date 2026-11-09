// 운영 로거 시험: 한 줄에 JSON 객체 하나, 비밀처럼 보이는 필드(중첩 포함)는 가린다, 가린 값은 원문이 줄에 없다.
import { describe, expect, test } from "bun:test";
import { createStderrLogger } from "../../../src/web/main/log.ts";

describe("createStderrLogger", () => {
  test("one JSON line per call, with the fixed fields and the child fields", () => {
    const lines: string[] = [];
    const logger = createStderrLogger({
      write: (line) => {
        lines.push(line);
      },
      now: () => Date.UTC(2026, 10, 9),
      base: { pid: 42 },
    }).child({ part: "web" });
    logger.info("gateway.listening", { loopbackPort: 8480, tlsPort: null });
    expect(lines).toEqual([
      `${JSON.stringify({ ts: "2026-11-09T00:00:00.000Z", level: "info", event: "gateway.listening", pid: 42, part: "web", loopbackPort: 8480, tlsPort: null })}\n`,
    ]);
  });

  test("fields whose names look like secrets are replaced, also when nested or in arrays", () => {
    const lines: string[] = [];
    const logger = createStderrLogger({
      write: (line) => {
        lines.push(line);
      },
      now: () => 0,
    });
    logger.warn("test.event", {
      deviceId: "dev_1",
      token: "TOKEN-VALUE-123",
      cookieValue: "COOKIE-VALUE",
      nested: { Authorization: "Bearer SECRET-VALUE", ok: "fine" },
      list: [{ privateKey: "KEY-VALUE" }, "plain"],
    });
    const [line = ""] = lines;
    expect(line).not.toContain("TOKEN-VALUE-123");
    expect(line).not.toContain("COOKIE-VALUE");
    expect(line).not.toContain("SECRET-VALUE");
    expect(line).not.toContain("KEY-VALUE");
    expect(JSON.parse(line)).toEqual({
      ts: "1970-01-01T00:00:00.000Z",
      level: "warn",
      event: "test.event",
      deviceId: "dev_1",
      token: "[redacted]",
      cookieValue: "[redacted]",
      nested: { Authorization: "[redacted]", ok: "fine" },
      list: [{ privateKey: "[redacted]" }, "plain"],
    });
  });
});

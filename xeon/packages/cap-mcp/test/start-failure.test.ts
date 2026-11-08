import { describe, expect, test } from "bun:test";
import { describeStartFailure } from "../src/client/start-failure.ts";

const base = { server: "bad", stderrTail: [], connectMs: 15000 };

describe("describeStartFailure", () => {
  test("a process that ends at once points to the stderr tail and keeps the original behind the first line", () => {
    const text = describeStartFailure({
      ...base,
      code: "connect_failed",
      message:
        "Version negotiation probe failed: Connection closed during the version negotiation probe",
      stderrTail: ["fatal: cannot open database /nonexistent/db.sqlite"],
    });
    expect(text.split("\n")).toEqual([
      "서버 bad에 연결하지 못했어요: 서버 프로세스가 바로 끝났어요. 서버의 오류 출력 끝 줄을 확인해 주세요",
      "Version negotiation probe failed: Connection closed during the version negotiation probe",
      "stderr: fatal: cannot open database /nonexistent/db.sqlite",
    ]);
  });

  test("a command that is not found says so", () => {
    const text = describeStartFailure({
      ...base,
      code: "spawn_failed",
      message: "ENOENT: spawn nope ENOENT",
    });
    expect(text.split("\n")[0]).toBe(
      "서버 bad에 연결하지 못했어요: 명령을 찾지 못했어요. 실행 명령의 이름과 경로를 확인해 주세요",
    );
  });

  test("a command without permission says so", () => {
    const text = describeStartFailure({ ...base, code: "spawn_failed", message: "EACCES: denied" });
    expect(text.split("\n")[0]).toBe(
      "서버 bad에 연결하지 못했어요: 명령을 실행할 권한이 없어요. 실행 파일의 권한을 확인해 주세요",
    );
  });

  test("a connect timeout names the wait and the setting", () => {
    const text = describeStartFailure({ ...base, code: "timeout", message: "Request timed out" });
    expect(text.split("\n")[0]).toBe(
      "서버 bad에 연결하지 못했어요: 15초 안에 서버가 응답하지 않았어요 (설정: MCP 연결 제한 시간, l2.mcp.connectTimeoutMs)",
    );
  });

  test("a failed version negotiation names the setting", () => {
    const text = describeStartFailure({
      ...base,
      code: "connect_failed",
      message: "Version negotiation failed: server supports no listed version",
    });
    expect(text.split("\n")[0]).toBe(
      "서버 bad에 연결하지 못했어요: 서버와 MCP 사양 버전을 맞추지 못했어요 (설정: MCP 사양 버전 협상, l2.mcp.versionNegotiation)",
    );
  });

  test("an unknown cause keeps the Korean frame and the original text on the next line", () => {
    const text = describeStartFailure({ ...base, code: "connect_failed", message: "weird thing" });
    expect(text.split("\n")).toEqual([
      "서버 bad에 연결하지 못했어요: 원인을 알 수 없어요. 원문을 확인해 주세요",
      "weird thing",
    ]);
  });

  test("a sandbox that cannot isolate explains why the server was not started", () => {
    const text = describeStartFailure({
      ...base,
      code: "sandbox_unavailable",
      message: "the sandbox is unavailable (no bwrap), so the server was not started",
    });
    expect(text.split("\n")[0]).toBe(
      "서버 bad에 연결하지 못했어요: 이 기기에서는 서버를 격리할 수 없어서 띄우지 않았어요",
    );
  });
});

import { describe, expect, test } from "bun:test";
import { failureToError } from "../src/errors.ts";
import { maskerFor } from "./support/world.ts";

const masker = maskerFor(["hunter2"]);
const callContext = { server: "qa", tool: "echo", timeoutMs: 15000 };

describe("failureToError messages", () => {
  test("a timeout names the server, the tool and the wait", () => {
    const error = failureToError(
      "callTool",
      { code: "timeout", message: "Request timed out" },
      masker,
      callContext,
    );
    expect(error.data).toMatchObject({
      code: "timeout",
      retryable: true,
      message:
        "서버 qa의 도구 echo 호출이 응답하지 않아 15초 뒤 끊었어요 (설정: MCP 호출 제한 시간, l2.mcp.callTimeoutMs)",
    });
  });

  test("a timeout without a known limit says the limit passed", () => {
    const error = failureToError(
      "listResources",
      { code: "timeout", message: "Request timed out" },
      masker,
      { server: "qa" },
    );
    expect(error.data.message).toBe(
      "서버 qa 호출이 응답하지 않아 제한 시간이 지나 끊었어요 (설정: MCP 호출 제한 시간, l2.mcp.callTimeoutMs)",
    );
  });

  test("an aborted call names the server", () => {
    const error = failureToError(
      "callTool",
      { code: "aborted", message: "The operation was aborted" },
      masker,
      { server: "qa" },
    );
    expect(error.data).toMatchObject({ code: "aborted", message: "서버 qa 호출을 중단했어요" });
  });

  test("a lost connection says it reconnects by itself", () => {
    const error = failureToError(
      "callTool",
      { code: "server_disconnected", message: "Connection closed" },
      masker,
      callContext,
    );
    expect(error.data).toMatchObject({
      code: "server_disconnected",
      retryable: true,
      message: "서버 qa의 연결이 끊겼어요. 자동으로 다시 연결해요",
    });
  });

  test("a connect failure keeps the original text only after masking it", () => {
    const error = failureToError(
      "readResource",
      { code: "connect_failed", message: "spawn failed for hunter2" },
      masker,
      { server: "qa" },
    );
    expect(error.data).toMatchObject({
      code: "unavailable",
      message: "서버 qa에 연결하지 못했어요: spawn failed for [REDACTED]",
    });
  });

  test("an upstream error keeps the masked server text and the rpc code", () => {
    const error = failureToError(
      "callTool",
      { code: "server_error", message: "bad hunter2 argument", rpcCode: -32602 },
      masker,
      callContext,
    );
    expect(error.data).toMatchObject({
      code: "upstream_error",
      message: "서버 qa의 도구 echo 호출에서 오류가 났어요: bad [REDACTED] argument",
      detail: { rpcCode: -32602 },
    });
  });

  test("too many input rounds names the server", () => {
    const error = failureToError(
      "callTool",
      { code: "input_rounds_exceeded", message: "rounds" },
      masker,
      callContext,
    );
    expect(error.data).toMatchObject({
      code: "input_rounds_exceeded",
      message: "서버 qa의 도구 echo 호출이 사용자 입력을 너무 여러 번 요청했어요",
    });
  });

  test("a protocol violation names the server and never shows the raw text", () => {
    const error = failureToError(
      "callTool",
      { code: "protocol_error", message: "Invalid message hunter2" },
      masker,
      callContext,
    );
    expect(error.data).toMatchObject({
      code: "protocol_error",
      message: "서버 qa의 도구 echo 호출이 MCP 사양에 맞지 않는 응답을 받았어요",
    });
    expect(JSON.stringify(error.data)).not.toContain("hunter2");
  });
});

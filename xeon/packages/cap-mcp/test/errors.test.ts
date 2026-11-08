import { describe, expect, test } from "bun:test";
import {
  failureToError,
  inputRoundsText,
  roundLimitText,
  serverBlockedText,
  serverNotConnectedText,
  serverNotReadyText,
  serverUnknownText,
  toolDeniedByModeText,
  toolHiddenText,
  toolUnknownText,
} from "../src/errors.ts";
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

  test("a connection lost during a call says how long after the call it dropped", () => {
    const quick = failureToError(
      "callTool",
      { code: "server_disconnected", message: "Connection closed" },
      masker,
      { server: "qa", tool: "die", elapsedMs: 40 },
    );
    expect(quick.data.message).toBe(
      "서버 qa의 도구 die 호출 중에 연결이 끊겼어요 (호출한 지 1초 안에). 자동으로 다시 연결해요",
    );
    const slow = failureToError(
      "callTool",
      { code: "server_disconnected", message: "Connection closed" },
      masker,
      { server: "qa", tool: "die", elapsedMs: 4200 },
    );
    expect(slow.data.message).toBe(
      "서버 qa의 도구 die 호출 중에 연결이 끊겼어요 (호출한 지 4초 뒤). 자동으로 다시 연결해요",
    );
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

describe("refusals before a call", () => {
  test("a server that is reconnecting, connecting, failed or off says so and what to do", () => {
    expect(serverNotReadyText("qa", "reconnecting")).toBe(
      "서버 qa에 다시 연결하는 중이라 호출할 수 없어요. 잠시 뒤에 다시 시도해 주세요",
    );
    expect(serverNotReadyText("qa", "connecting")).toBe(
      "서버 qa에 연결하는 중이라 호출할 수 없어요. 잠시 뒤에 다시 시도해 주세요",
    );
    expect(serverNotReadyText("qa", "failed")).toBe(
      "서버 qa의 시작이 실패한 상태라 호출할 수 없어요. 설정의 MCP 서버에서 다시 시작해 보세요",
    );
    expect(serverNotReadyText("qa", "disabled")).toBe(
      "서버 qa의 연결이 꺼져 있어 호출할 수 없어요",
    );
    expect(serverNotConnectedText("qa")).toBe("서버 qa에 연결되어 있지 않아 호출할 수 없어요");
  });

  test("a blocked server names the reason in words", () => {
    expect(serverBlockedText("qa", "approval_required")).toBe(
      "서버 qa의 시작이 막혀 있어 호출할 수 없어요 (사유: 기동 승인을 기다리는 중)",
    );
    expect(serverBlockedText("qa", undefined)).toBe("서버 qa의 시작이 막혀 있어 호출할 수 없어요");
  });

  test("an unknown server, an unknown tool and a hidden or denied tool name the server and tool", () => {
    expect(serverUnknownText("ghost")).toBe("MCP 서버를 찾을 수 없어요: ghost");
    expect(toolUnknownText("qa", "echo")).toBe("서버 qa에 이름이 echo인 도구가 없어요");
    expect(toolHiddenText("qa", "echo")).toBe(
      "서버 qa의 도구 echo 호출은 서버 정의에서 노출하지 않기로 해서 거절했어요",
    );
    expect(toolDeniedByModeText("qa", "echo")).toBe(
      "서버 qa의 도구 echo 호출은 승인 모드가 거부(deny)라서 거절했어요 (설정: l2.mcp.approvalMode)",
    );
  });

  test("the input round limits are stated as numbers", () => {
    expect(inputRoundsText(5)).toBe("서버가 사용자 입력을 5번보다 많이 요청해서 멈췄어요");
    expect(roundLimitText(7, 5)).toBe("입력 7번째 차례가 한도 5번을 넘었어요");
  });
});

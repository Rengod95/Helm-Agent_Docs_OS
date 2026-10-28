import { assertNever } from "@xeon/contracts";
import {
  wireError,
  type WireError,
  type WireHandler,
  type WireHandlers,
} from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { CommandFailure, Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";
import { claimWrite } from "./owner.ts";

// F wire §3.3.1 command.list, command.run. L4.host-service.spec HS-72. 엔진에 등록한 슬래시 명령(`dialog.commands`)을 클라이언트가
// 읽고 실행한다. 실행 결과는 `dialog.commands.run`의 출력 그대로다: `not_command`, `expanded`(turn.start로 보낼 최종 텍스트),
// `needs_confirmation`(셸 주입 확인), `done`(동작 명령의 메시지와 구조 값).

/** 입력 문제로 거절한 능력 오류 코드. 사용자가 줄을 고치거나 설정을 바꾸면 풀린다 */
const INPUT_CODES: ReadonlySet<string> = new Set([
  "invalid_input",
  "command_args_invalid",
  "command_shell_disabled",
]);

function commandFailure(
  failure: CommandFailure,
  method: "command.list" | "command.run",
): WireError {
  switch (failure.kind) {
    case "unavailable":
      return wireError("internal", { message: `${method}: the command service is not available` });
    case "rejected":
      // 입력 문제는 -32602(`path: "text"`)다. wire에 명령 전용 오류 kind가 없어 나머지(셸 거부, 사용 불가 등)는 internal에 능력 오류 코드를 싣는다
      return INPUT_CODES.has(failure.code)
        ? wireError("jsonrpc.invalidParams", {
            details: { issues: [{ path: "text", message: failure.message }] },
          })
        : wireError("internal", { message: `${method}: ${failure.code}: ${failure.message}` });
    default:
      return assertNever(failure, "CommandFailure");
  }
}

function createCommandListHandler(engine: Engine): WireHandler<"command.list"> {
  const { commands } = engine.ports;
  const { threads } = engine.ports;
  return async (params, context) => {
    // 읽기만 해서 쓰기 소유는 얻지 않는다. 없는 thread의 문맥으로는 목록을 만들지 않는다
    if (params.threadId !== undefined) {
      const exists = threads.exists(params.threadId);
      if (!exists.ok) throw wireErrorOfStore(exists.error, "command.list thread lookup");
      if (!exists.value)
        throw wireError("thread.notFound", { details: { threadId: params.threadId } });
    }
    const listed = await commands.list(params, context.signal);
    if (!listed.ok) throw commandFailure(listed.error, "command.list");
    return listed.value;
  };
}

/**
 * 명령은 thread 문맥에서 돈다: 없는 thread는 3001이다. 동작 명령과 셸 주입이 thread의 상태를 바꾸므로 `turn.start`처럼 쓰기 소유를
 * 암묵 획득한다(HS-28). 다른 프로세스가 쥐었으면 3002다
 */
function createCommandRunHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"command.run"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId, ...rest } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "command.run thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    await claimWrite(engine, hub(), context.connectionId, threadId);
    const ran = await ports.commands.run(threadId, rest, context.signal);
    if (!ran.ok) throw commandFailure(ran.error, "command.run");
    return ran.value;
  };
}

export function createCommandHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
): Pick<WireHandlers, "command.list" | "command.run"> {
  return {
    "command.list": createCommandListHandler(engine),
    "command.run": createCommandRunHandler(engine, hub),
  };
}

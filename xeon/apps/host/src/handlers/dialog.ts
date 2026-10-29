import { assertNever } from "@xeon/contracts";
import {
  wireError,
  type WireError,
  type WireHandler,
  type WireHandlers,
} from "@xeon/contracts/wire";
import type { DialogWireFailure, Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";

// F wire §3.3.1 status.list, attachments.add. L4.host-service.spec HS-81. 상태줄 스냅숏과 첨부 추가(M3-REQ-16, M3-20).
// 둘 다 읽거나 저장만 하고 thread의 쓰기 소유를 얻지 않는다. 서비스는 cap-dialog의 `dialog.status`·`dialog.attachments`다(assembly/dialog-wire.ts).

/** 입력을 고치면 풀리는 능력 오류 코드. 첨부 원천이 없거나 한도를 넘었거나 형식을 못 읽는 경우 */
const INPUT_CODES: ReadonlySet<string> = new Set([
  "invalid_input",
  "not_found",
  "denied",
  "attachment_too_large",
  "attachment_type_unsupported",
]);

type DialogMethod = "status.list" | "attachments.add";

function dialogFailure(failure: DialogWireFailure, method: DialogMethod): WireError {
  switch (failure.kind) {
    case "unavailable":
      return wireError("internal", { message: `${method}: the dialog service is not available` });
    case "rejected":
      // 입력 문제는 -32602다. 첨부 원천이 문제면 `source`, status.list는 thread 문맥이라 `threadId`를 가리킨다. 나머지(저장소 실패 등)는 internal에 능력 오류 코드를 싣는다
      return INPUT_CODES.has(failure.code)
        ? wireError("jsonrpc.invalidParams", {
            details: {
              issues: [
                {
                  path: method === "status.list" ? "threadId" : "source",
                  message: failure.message,
                },
              ],
            },
          })
        : wireError("internal", { message: `${method}: ${failure.code}: ${failure.message}` });
    default:
      return assertNever(failure, "DialogWireFailure");
  }
}

function createStatusListHandler(engine: Engine): WireHandler<"status.list"> {
  const { threads, dialog } = engine.ports;
  return async (params, context) => {
    // 읽기만 해서 쓰기 소유는 얻지 않는다. 없는 thread의 문맥으로는 목록을 만들지 않는다
    const { threadId } = params;
    const exists = threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "status.list thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    const listed = await dialog.statusList(threadId, context.signal);
    if (!listed.ok) throw dialogFailure(listed.error, "status.list");
    return listed.value;
  };
}

/**
 * `threadId`를 주면 그 thread가 있어야 한다(3001). 없으면 첨부를 만들지 않는다. 쓰기 소유는 얻지 않는다(첨부는 blob 저장소에 쓴다)
 */
function createAttachmentsAddHandler(engine: Engine): WireHandler<"attachments.add"> {
  const { threads, dialog } = engine.ports;
  return async (params, context) => {
    const { threadId } = params;
    if (threadId !== undefined) {
      const exists = threads.exists(threadId);
      if (!exists.ok) throw wireErrorOfStore(exists.error, "attachments.add thread lookup");
      if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    }
    const added = await dialog.attachmentsAdd(params, context.signal);
    if (!added.ok) throw dialogFailure(added.error, "attachments.add");
    return added.value;
  };
}

export function createDialogHandlers(
  engine: Engine,
): Pick<WireHandlers, "status.list" | "attachments.add"> {
  return {
    "status.list": createStatusListHandler(engine),
    "attachments.add": createAttachmentsAddHandler(engine),
  };
}

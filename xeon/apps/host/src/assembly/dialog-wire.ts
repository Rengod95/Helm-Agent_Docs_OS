import { attemptAsync, err, ok } from "@xeon/contracts";
import { isCapabilityError, type CallOptions } from "@xeon/contracts/capabilities";
import type { DialogWireFailure, DialogWirePort } from "../types.ts";
import { hostContext } from "./commands.ts";
import type { CommandRegistryHolder } from "./l2-units.ts";

// M3-REQ-16, M3-20. 상태줄 스냅숏(`status.list`)과 첨부 추가(`attachments.add`)를 wire로 낸다. 서비스는 cap-dialog의 `dialog.status`와
// `dialog.attachments` 능력이고, host-dialog-bridge 확장이 그 API를 `holder`에 채운다(l2-units.ts). 호출자는 `host`다: 사람이 클라이언트에서
// 친 입력이라 모델이나 확장의 호출이 아니다. 조립 루트 코드(DR-14 예외 2).

export interface DialogWirePortDeps {
  readonly holder: CommandRegistryHolder;
}

/** 능력 오류 메시지의 상한. 첨부 이름과 경로가 섞일 수 있어 길게 싣지 않는다 */
const MESSAGE_MAX = 200;

/** 능력이 던진 값을 실패로 바꾼다. 능력 오류가 아니면(결함) 그대로 다시 던진다 */
function failureOf(caught: unknown): DialogWireFailure {
  if (isCapabilityError(caught)) {
    return {
      kind: "rejected",
      code: caught.data.code,
      message: caught.data.message.slice(0, MESSAGE_MAX),
    };
  }
  throw caught;
}

export function createDialogWirePort(deps: DialogWirePortDeps): DialogWirePort {
  return {
    async statusList(threadId, signal) {
      const api = deps.holder.status;
      if (api === undefined) return err({ kind: "unavailable" });
      const listed = await attemptAsync(() =>
        api.list({}, { signal, context: hostContext(threadId) }),
      );
      if (!listed.ok) return err(failureOf(listed.error.cause));
      return ok(listed.value);
    },
    async attachmentsAdd(params, signal) {
      const api = deps.holder.attachments;
      if (api === undefined) return err({ kind: "unavailable" });
      // threadId는 서비스 입력이 아니라 호출 문맥이다: 첨부 한도가 그 thread의 설정으로 정해진다. 상대 경로를 thread의 작업 폴더로
      // 푸는 일은 능력이 아직 하지 않는다(L4.host-service.spec §10 미결). `_meta`는 서비스에 넘기지 않는다(입력 스키마가 모르는 키다)
      const { threadId, source } = params;
      const options: CallOptions = { signal, context: hostContext(threadId) };
      const added = await attemptAsync(() => api.add({ source }, options));
      if (!added.ok) return err(failureOf(added.error.cause));
      return ok(added.value);
    },
  };
}

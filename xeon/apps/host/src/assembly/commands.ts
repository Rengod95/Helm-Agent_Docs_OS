import { attemptAsync, err, ok } from "@xeon/contracts";
import {
  isCapabilityError,
  type CallContext,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { CommandFailure, CommandPort } from "../types.ts";
import type { CommandRegistryHolder } from "./l2-units.ts";

// G1-01. 엔진에 등록한 슬래시 명령을 wire로 낸다: 클라이언트가 목록을 읽고(`command.list`) 한 줄을 실행한다(`command.run`).
// 명령 서비스는 cap-dialog의 `dialog.commands` 능력이고, host-dialog-bridge 확장이 그 API를 `holder`에 채운다(l2-units.ts).
// 호출 문맥의 호출자는 `host`다: 사람이 클라이언트에서 직접 친 명령이라 모델이나 확장의 호출이 아니다(승인 origin의 caller도 `host`).
// 조립 루트 코드(DR-14 예외 2).

export interface CommandPortDeps {
  readonly holder: CommandRegistryHolder;
  readonly ids: IdFactory;
}

/** 능력 오류 메시지의 상한. 명령 줄(사용자 입력)이 섞일 수 있어 길게 싣지 않는다 */
const MESSAGE_MAX = 200;

/** 능력이 던진 값을 실패로 바꾼다. 능력 오류가 아니면(결함) 그대로 다시 던진다 */
function failureOf(caught: unknown): CommandFailure {
  if (isCapabilityError(caught)) {
    return {
      kind: "rejected",
      code: caught.data.code,
      message: caught.data.message.slice(0, MESSAGE_MAX),
    };
  }
  throw caught;
}

export function createCommandPort(deps: CommandPortDeps): CommandPort {
  return {
    async list(params, signal) {
      const api = deps.holder.api;
      if (api === undefined) return err({ kind: "unavailable" });
      // threadId는 서비스 입력이 아니라 호출 문맥이다: 프로젝트 명령이 그 thread의 작업 폴더 기준으로 나온다(HS-72)
      const { threadId, ...input } = params;
      const options: CallOptions = { signal, context: hostContext(threadId) };
      const listed = await attemptAsync(() => api.list(input, options));
      if (!listed.ok) return err(failureOf(listed.error.cause));
      return ok({ commands: listed.value.commands });
    },
    async run(threadId, params, signal) {
      const api = deps.holder.api;
      if (api === undefined) return err({ kind: "unavailable" });
      const options: CallOptions = {
        signal,
        requestId: deps.ids.next("evt"),
        context: hostContext(threadId),
      };
      const ran = await attemptAsync(() => api.run(params, options));
      if (!ran.ok) return err(failureOf(ran.error.cause));
      return ok(ran.value);
    },
  };
}

/**
 * 호스트가 사람의 입력으로 부르는 호출의 문맥. `interactive`를 생략하면 대화형이다(F `CallContext`).
 * 상태줄·첨부 포트(`dialog-wire.ts`)도 같은 문맥을 쓴다
 */
export function hostContext(threadId: CallContext["threadId"]): CallContext {
  return { ...(threadId === undefined ? {} : { threadId }), caller: { kind: "host" } };
}

import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { FIRST_DENY } from "@xeon/contracts/extensions";
import type {
  GuardExecutionOutcome,
  GuardExecutionRequest,
  LoopError,
} from "@xeon/contracts/services";
import type { LoopContext } from "./types.ts";

// L1.loop.spec §4.11 `guard.output.before`의 `target: "execution"`(adr.0017 §3.6, M3-REQ-109). 모델이나 사용자가 만든 내용을 실행(파일 쓰기 등)에
// 넘기기 직전에 L2가 부른다. turn 안의 가드가 아니라서 turn을 열지 않고 요청 id를 디스패치 키로 쓴다. 가드는 값을 바꾸지 못하고 막기만 하며,
// 디스패처 호출 자체의 실패도 막음이다(fail-closed).

export interface GuardExecutionRunner {
  run(request: GuardExecutionRequest): Promise<Result<GuardExecutionOutcome, LoopError>>;
}

export function createGuardExecution(ctx: LoopContext): GuardExecutionRunner {
  return {
    async run(request) {
      if (request.requestId.length < 1 || request.requestId.length > 64) {
        return err({ kind: "input_invalid", message: "requestId must be 1-64 characters" });
      }
      const fired = await attemptAsync(() =>
        ctx.ext.dispatch(
          "guard.output.before",
          {
            threadId: request.threadId,
            turnId: request.turnId,
            target: "execution",
            content: request.content,
          },
          {
            threadId: request.threadId,
            dispatchKey: `guard_execution:${request.requestId}`,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        ),
      );
      if (!fired.ok) {
        ctx.logger.warn("loop.guard_execution_dispatch_failed", {
          threadId: request.threadId,
          requestId: request.requestId,
        });
        return ok({ status: "blocked", reason: FIRST_DENY["guard.output.before"].reason });
      }
      const decision = fired.value.decision;
      return ok(
        decision === undefined
          ? { status: "allowed" }
          : { status: "blocked", reason: decision.reason },
      );
    },
  };
}

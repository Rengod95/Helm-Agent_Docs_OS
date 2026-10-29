import { parse } from "@xeon/contracts";
import type { CallContext, CallOptions, CapabilityId } from "@xeon/contracts/capabilities";
import { ThreadIdSchema, type ThreadId, type TurnId } from "@xeon/contracts/conversation";
import { reject } from "./errors.ts";

// 능력 서비스 메서드가 공통으로 하는 입력 검사. 호출 문맥의 스레드와 requestId는 쓰기 메서드에서 필수다(spec §3.5).

export interface CallScope {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly context: CallContext | undefined;
  readonly signal: AbortSignal | undefined;
}

/** 중단 신호와 스레드 문맥을 검사한다. `fallbackThread`는 입력이 스레드를 명시했을 때의 값이다 */
export function scopeOf(
  capability: CapabilityId,
  method: string,
  options: CallOptions | undefined,
  fallbackThread?: string,
): CallScope {
  if (options?.signal?.aborted === true) {
    throw reject(capability, method, "aborted", "The call was aborted.");
  }
  const raw = fallbackThread ?? options?.context?.threadId;
  if (raw === undefined) {
    throw reject(capability, method, "invalid_input", "The call has no thread context.");
  }
  const threadId = parse(ThreadIdSchema, raw);
  if (!threadId.ok) {
    throw reject(capability, method, "invalid_input", "The thread id is malformed.");
  }
  return {
    threadId: threadId.value,
    turnId: options?.context?.turnId ?? null,
    context: options?.context,
    signal: options?.signal,
  };
}

export function requestIdOf(
  capability: CapabilityId,
  method: string,
  options: CallOptions | undefined,
): string {
  const requestId = options?.requestId;
  if (requestId === undefined || requestId === "") {
    throw reject(capability, method, "invalid_input", "Write methods need a requestId.");
  }
  return requestId;
}

/** 결정과 코멘트를 낸 쪽. 호출 문맥의 호출자에서 정한다 */
export function actorOf(context: CallContext | undefined): "user" | "model" | "group" {
  const caller = context?.caller;
  if (caller === undefined || caller.kind === "host") return "user";
  return caller.kind === "extension" ? "group" : "model";
}

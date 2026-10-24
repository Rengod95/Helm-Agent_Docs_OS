import { parse, type Result } from "@xeon/contracts";
import type { CallContext, CallOptions, CapabilityId } from "@xeon/contracts/capabilities";
import { ThreadIdSchema, type ThreadId, type TurnId } from "@xeon/contracts/conversation";
import { commitKeyPart, type ReadFailure, type StoreError } from "@xeon/contracts/records";
import { abortedError, invalidInput, storeRejection } from "./errors.ts";
import { sha256Hex } from "./hash.ts";

// 능력 서비스 메서드가 공통으로 하는 입력 검사. 호출 문맥의 스레드와 requestId는 쓰기 메서드에서 필수다(spec §3.1).

export interface CallScope {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  /** 도구 경로면 toolCallId가 있다 */
  readonly context: CallContext | undefined;
  readonly signal: AbortSignal | undefined;
}

/** 중단 신호, 스레드 문맥을 검사한다. 어긋나면 CapabilityError로 거부한다 */
export function scopeOf(
  capability: CapabilityId,
  method: string,
  options: CallOptions | undefined,
): CallScope {
  if (options?.signal?.aborted === true) throw abortedError(capability, method);
  const raw = options?.context?.threadId;
  if (raw === undefined) throw invalidInput(capability, method, "The call has no thread context.");
  const threadId = parse(ThreadIdSchema, raw);
  if (!threadId.ok) throw invalidInput(capability, method, "The thread id is malformed.");
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
    throw invalidInput(capability, method, "Write methods need a requestId.");
  }
  return requestId;
}

/** 읽기·쓰기 결과의 저장소 실패를 CapabilityError로 거부한다 */
export function orThrow<T>(
  capability: CapabilityId,
  method: string,
  read: Result<T, ReadFailure | StoreError>,
): T {
  if (read.ok) return read.value;
  throw storeRejection(capability, method, read.error);
}

/** 커밋 키 `work:<영역>:<requestId>`. 형식에 맞지 않거나 긴 requestId는 F commitKeyPart가 해시로 바꾼다 */
export function commitKeyOf(area: "tasks" | "plans", requestId: string): string {
  return `work:${area}:${commitKeyPart(requestId, sha256Hex)}`;
}

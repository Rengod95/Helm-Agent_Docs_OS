import { AsyncLocalStorage } from "node:async_hooks";
import type { ScopeId } from "@xeon/contracts/extensions";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { HandlerGate } from "./dispatch-types.ts";

/** drive 호출 하나의 멱등 키 재료(X.primitives.spec §4.4.3, §4.6.1) */
export interface DriveInvocation {
  readonly leaseId: string;
  /** 호출 시작 때의 상태 판 */
  readonly baseRev: number;
  /** 호출 안 일련번호. turn·spawn·commit·record가 함께 쓴다 */
  i: number;
  /** 재생이 아닌 효과의 수 */
  effects: number;
}

/** 핸들러와 drive 함수의 비동기 흐름에 싣는 맥락(X.primitives.spec §4.2 withAmbient) */
export interface Ambient {
  readonly threadId: ThreadId;
  readonly scopeId: ScopeId;
  /** 핸들러 안이면 디스패치 키, drive 안이면 null */
  readonly dispatchKey: string | null;
  /** 핸들러 안 멱등 키 카운터 */
  counter: number;
  readonly drive: DriveInvocation | null;
  /** 핸들러 실행 중이면 그 호출의 취소 신호와 예산 시계 장치. 사용자 응답 대기를 예산에서 뺀다(O-07) */
  readonly handler: { readonly signal: AbortSignal; readonly gate: HandlerGate } | null;
}

const storage = new AsyncLocalStorage<Ambient>();

export function withAmbient<T>(value: Ambient, fn: () => T): T {
  return storage.run(value, fn);
}

/** 맥락 없이 실행한다. scope setup은 thread 밖에서 돈다 */
export function withoutAmbient<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** 맥락이 없으면 undefined */
export function ambient(): Ambient | undefined {
  return storage.getStore();
}

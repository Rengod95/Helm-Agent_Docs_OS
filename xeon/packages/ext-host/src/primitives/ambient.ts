import { AsyncLocalStorage } from "node:async_hooks";
import type { HookName, RegistrationId } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TraceDispatch } from "../operations/trace-buffer.ts";
import type { HandlerGate } from "./dispatch-types.ts";

/** drive 호출 하나의 멱등 키 재료(X.primitives.spec §4.4.3, §4.6.1) */
export interface DriveInvocation {
  readonly leaseId: string;
  /** 기본 `requestId`의 앞부분. `waiting` 재부여를 넘어 유지된다 */
  readonly lineageId: string;
  /** 호출 시작 때의 상태 판 */
  readonly baseRev: number;
  /** 임대의 취소 신호. 반납·회수·끄기로 abort된다 */
  readonly signal: AbortSignal;
  /** 호출 안 일련번호. turn·spawn·commit·record가 함께 쓴다 */
  i: number;
  /** 재생이 아닌 효과의 수 */
  effects: number;
}

/** 핸들러와 drive 함수의 비동기 흐름에 싣는 맥락(X.primitives.spec §4.2 withAmbient) */
export interface Ambient {
  readonly threadId: ThreadId;
  readonly scopeId: RegistrationId;
  /** 핸들러 안이면 실행 중인 지점, drive 안이면 null */
  readonly point: HookName | null;
  /** 핸들러 안이면 디스패치 키, drive 안이면 null */
  readonly dispatchKey: string | null;
  /** 핸들러 안 멱등 키 카운터 */
  counter: number;
  readonly drive: DriveInvocation | null;
  /** 핸들러 실행 중이면 그 호출의 취소 신호와 예산 시계 장치. 사용자 응답 대기를 예산에서 뺀다(O-07) */
  readonly handler: { readonly signal: AbortSignal; readonly gate: HandlerGate } | null;
  /**
   * 도구 `execute`, 명령 처리기, 확장 메서드 처리기가 연 문맥이면 그 종류. 이 호출들은 재실행되는 코드가 아니라서(ADR-0015 §3.1 1번)
   * 기능 래퍼의 재실행 검사를 받지 않는다. on 핸들러와 drive 함수에서는 없다(X.primitives.spec §4.6.6, §4.12)
   */
  readonly invocation?: "tool" | "command" | "method";
  /**
   * 핸들러가 도는 디스패치의 계측 기록기. 외부 훅 실행기가 훅마다 자기 기록(`hook:<id>`)을 같은 항목에 넣을 때 쓴다(X.operations §4.8.2).
   * 계측이 꺼졌거나 Turn을 정할 수 없으면 없다
   */
  readonly trace?: TraceDispatch;
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

// `readOnly: true`로 선언한 확장 메서드 처리기의 비동기 흐름 표지(ADR-0021 §3.4.2). `threadId`가 없어 ambient를 열지 않는 호출에도 걸리도록
// ambient와 따로 둔다. 기능 래퍼는 읽기 전용 기능 호출만 통과시키고, 상태 커밋, 레코드, post는 `read_only_method`로 거부한다
const readOnlyStorage = new AsyncLocalStorage<true>();

export function withReadOnlyMethod<T>(fn: () => T): T {
  return readOnlyStorage.run(true, fn);
}

export function inReadOnlyMethod(): boolean {
  return readOnlyStorage.getStore() === true;
}

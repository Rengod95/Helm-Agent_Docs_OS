import { AsyncLocalStorage } from "node:async_hooks";
import type { HookName, RegistrationId } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TraceDispatch } from "../operations/trace-buffer.ts";
import type { HandlerGate } from "./dispatch-types.ts";
import type { WaitTally } from "./user-wait.ts";

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

/**
 * 훅 스택의 한 칸(hooks-core-boundary §5.3 U-8 (나)). 핸들러가 도는 칸은 `tool`이 빈 문자열이다.
 * 핸들러 안에서 시작한 플러그인 기능 호출의 칸은 호출한 확장, 대상(`기능.메서드`), 인자 해시를 적는다
 */
export interface HookFrame {
  readonly plugin: string;
  readonly point: HookName;
  readonly tool: string;
  readonly argsHash: string;
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
  /**
   * 사람 대기 계측(`waits`)은 훅 핸들러 실행에만 싣는다. 있으면 `awaitUser`가 기다린 횟수와 시간을 더한다(턴 기록 §4.2 규칙 14)
   */
  readonly handler: {
    readonly signal: AbortSignal;
    readonly gate: HandlerGate;
    readonly waits?: WaitTally;
  } | null;
  /**
   * 도구 `execute`, 명령 처리기, 확장 메서드 처리기가 연 문맥이면 그 종류. 이 호출들은 재실행되는 코드가 아니라서(ADR-0015 §3.1 1번)
   * 기능 래퍼의 재실행 검사를 받지 않는다. on 핸들러와 drive 함수에서는 없다(X.primitives.spec §4.6.6, §4.12)
   */
  readonly invocation?: "tool" | "command" | "method";
  /** `invocation`이 있으면 그 호출 id(도구 호출 id, 명령 호출 id, 메서드 호출 id). 플러그인 도구 안의 호출이 `parentToolCallId`로 쓴다 */
  readonly callId?: string;
  /**
   * 이 흐름이 훅 핸들러 안에서 시작한 플러그인 기능 호출들의 스택(U-8 (나)). 핸들러가 돌 때마다 칸이 쌓이고, 칸은 호출 안에서만 보인다.
   * 없으면 빈 스택이다. 리스 쪽 맥락은 이 값을 두지 않는다
   */
  readonly hookStack?: readonly HookFrame[];
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

/** 흐름의 훅 스택. 맥락이 없거나 스택을 싣지 않았으면 빈 배열 */
export function hookStackOf(amb: Ambient | undefined): readonly HookFrame[] {
  return amb?.hookStack ?? [];
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

// `ownDataOnly: true`로 선언한 쓰기 확장 메서드 처리기의 비동기 흐름 표지(pgRe §4.2 3번). 이 메서드는 확인 줄 없이 화면에서 불리므로
// 자기 상태와 기록(commit, record, recordPrivate, 자기 저장소)만 바꾼다. 다른 확장이나 대화에 닿는 길(post, 기능 호출, 포트, 효과 요청, 주도 시작)은 `own_data_method`로 거부한다
const ownDataStorage = new AsyncLocalStorage<true>();

export function withOwnDataMethod<T>(fn: () => T): T {
  return ownDataStorage.run(true, fn);
}

export function inOwnDataMethod(): boolean {
  return ownDataStorage.getStore() === true;
}

// 확장 메서드 처리기의 비동기 흐름 표지(플러그인 전용 저장소의 쓰기 자격). `ctx.threadId`가 null이면 ambient가 없으므로 ambient와 따로 둔다.
// 쓰기(`put`, `delete`)는 이 표지와, 있으면 `invocation === "method"`인 ambient가 함께 있을 때만 된다(X.primitives.spec §4.6.7)
const extMethodStorage = new AsyncLocalStorage<true>();

export function withExtMethod<T>(fn: () => T): T {
  return extMethodStorage.run(true, fn);
}

export function inExtMethod(): boolean {
  return extMethodStorage.getStore() === true;
}

import type { Static, TSchema } from "typebox";
import type { ReplayPolicy, ThreadId, TurnId } from "../conversation/index.ts";

/** 메서드 고유 오류 선언. 공통 오류 코드(errors.ts)는 선언하지 않아도 된다 */
export interface ErrorDecl {
  readonly description: string;
  readonly retryable: boolean;
  /** CapabilityErrorData.detail의 스키마 */
  readonly detail?: TSchema;
}

export interface MethodDef<I extends TSchema = TSchema, O extends TSchema = TSchema> {
  readonly description: string;
  /** 입력. 루트는 Type.Object여야 한다 */
  readonly input: I;
  readonly output: O;
  /** 메서드 고유 오류 코드 → 선언. 키 형식 ^[a-z][a-z0-9_]{0,47}$ */
  readonly errors?: Readonly<Record<string, ErrorDecl>>;
  /** 서비스 호출 자체의 재생 정책. 생략하면 "unsafe" */
  readonly replay?: ReplayPolicy;
}

export type MethodMap = Readonly<Record<string, MethodDef>>;

export interface ServiceDef<Ms extends MethodMap = MethodMap> {
  readonly methods: Ms;
}

/** 호출 주체. 값은 L1.tools(도구 경로)와 X(그룹·확장 경로)가 채운다 */
export interface CallerInfo {
  readonly kind: "model" | "extension" | "host";
  /** model일 때: 주 대화, 서브에이전트, 백그라운드 포크 */
  readonly agent?: "main" | "subagent" | "background";
  /** extension일 때 확장 이름(그룹이면 그룹 이름) */
  readonly extension?: string;
  /** 이번 turn에서 untrusted 도구 결과를 이미 읽었는지. L1.tools가 계산한다 */
  readonly afterUntrusted?: boolean;
}

/** 호출 문맥. consumer가 직접 채우지 않는다 */
export interface CallContext {
  /** 호출이 일어난 세션 */
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
  /** 도구 경로면 있다 */
  readonly toolCallId?: string;
  readonly caller: CallerInfo;
}

/** 서비스 호출 옵션. consumer가 넘긴다 */
export interface CallOptions {
  readonly signal?: AbortSignal;
  /** 같은 대화에서 같은 효과를 한 번만 내기 위한 키(1~64자). 도구 어댑터는 toolCallId에서 만든다 */
  readonly requestId?: string;
  /** L1.tools 어댑터(도구 경로)와 X의 capability 래퍼(그룹·확장 경로)가 덮어써서 채운다 */
  readonly context?: CallContext;
}

/** 메서드 하나의 서비스 함수 타입 */
export type MethodFn<Md extends MethodDef> = (
  input: Static<Md["input"]>,
  options?: CallOptions,
) => Promise<Static<Md["output"]>>;

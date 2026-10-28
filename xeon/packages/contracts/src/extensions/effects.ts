/**
 * 재실행되는 확장 코드(on 핸들러, drive 함수)의 허용 효과 표. ADR-0015 §3.2가 정본이고 이 표는 그 코드 표현이다.
 * 검사는 X의 연산 래퍼와 능력 래퍼가 하고, F는 표의 값만 둔다.
 */

/** 재실행되는 문맥 두 가지 */
export type ReplayContext = "on" | "drive";

/** 표의 행. 효과 하나 */
export type ReplayEffect =
  | "commit"
  | "record"
  | "post"
  | "loop.turn"
  | "loop.spawn"
  | "g.delegate"
  | "g.delegateStatus"
  | "g.cancelDelegates"
  | "capability.idempotent"
  | "capability.readOnly"
  | "capability.undeclared"
  | "io";

/** 문맥마다의 판정. `n/a`는 그 문맥에 없는 연산이다(on 핸들러에는 `loop`가 없다) */
export type EffectVerdict = "allowed" | "denied" | "n/a";

/** 이 효과를 낼 때 `requestId`를 어떻게 정하는가 */
export type RequestIdRule =
  /** 키가 없다 */
  | "none"
  /** 호출자가 넘기는 필수 키. 결정적이어야 한다(ADR-0015 §3.4 1·2) */
  | "required"
  /** 기본 키(`${leaseId}:${순번}`) 또는 결정적 명시 키 */
  | "default_or_explicit"
  /** 생략 가능(읽기는 멱등 키가 필요 없다) */
  | "optional";

export interface ReplayEffectRow {
  readonly on: EffectVerdict;
  readonly drive: EffectVerdict;
  /** 멱등을 보장하는 주체. ADR-0015 §3.2 "멱등 보장 주체" 열 */
  readonly guarantor: "X" | "L1.input-queue" | "L1.loop" | "L1.agents" | "provider" | "none";
  readonly requestId: RequestIdRule;
}

/** ADR-0015 §3.2 표. 같은 순서로 둔다 */
export const REPLAY_EFFECT_TABLE: Readonly<Record<ReplayEffect, ReplayEffectRow>> = {
  commit: { on: "allowed", drive: "allowed", guarantor: "X", requestId: "none" },
  record: { on: "allowed", drive: "allowed", guarantor: "X", requestId: "none" },
  post: { on: "allowed", drive: "allowed", guarantor: "L1.input-queue", requestId: "required" },
  "loop.turn": {
    on: "n/a",
    drive: "allowed",
    guarantor: "L1.loop",
    requestId: "default_or_explicit",
  },
  "loop.spawn": {
    on: "n/a",
    drive: "allowed",
    guarantor: "L1.agents",
    requestId: "default_or_explicit",
  },
  "g.delegate": { on: "allowed", drive: "allowed", guarantor: "L1.agents", requestId: "required" },
  "g.delegateStatus": { on: "denied", drive: "allowed", guarantor: "none", requestId: "none" },
  "g.cancelDelegates": { on: "denied", drive: "denied", guarantor: "none", requestId: "none" },
  "capability.idempotent": {
    on: "allowed",
    drive: "allowed",
    guarantor: "provider",
    requestId: "required",
  },
  "capability.readOnly": {
    on: "denied",
    drive: "allowed",
    guarantor: "none",
    requestId: "optional",
  },
  "capability.undeclared": { on: "denied", drive: "denied", guarantor: "none", requestId: "none" },
  io: { on: "denied", drive: "denied", guarantor: "none", requestId: "none" },
};

/** 표에서 효과가 그 문맥에 허용되는가. `n/a`는 허용이 아니다 */
export function isEffectAllowed(effect: ReplayEffect, context: ReplayContext): boolean {
  return REPLAY_EFFECT_TABLE[effect][context] === "allowed";
}

/** 능력 메서드의 선언에서 표의 행을 고른다. 선언이 없으면(`replay` 값과 무관하게) `capability.undeclared` */
export function capabilityEffectOf(method: {
  readonly idempotent?: true;
  readonly readOnly?: true;
}): "capability.idempotent" | "capability.readOnly" | "capability.undeclared" {
  if (method.idempotent === true && method.readOnly !== true) return "capability.idempotent";
  if (method.readOnly === true && method.idempotent !== true) return "capability.readOnly";
  return "capability.undeclared";
}

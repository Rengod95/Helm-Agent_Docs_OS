import { failure, type KnowledgeFailure } from "../errors.ts";
import { sha256Hex } from "../hash.ts";

// M3-REQ-88 review. 쓰기의 멱등 키는 (대화, 메서드, requestId)다. 같은 키에 다른 입력이 오면 첫 결과를 돌려주지 않고 `key_reused`로 거부한다
// (work 능력의 커밋 키와 같은 규칙, ADR-0015 §3.3 6). 키는 원장·대기열의 `request_id` 열에, 입력 지문은 `request_fp` 열에 남는다.

export interface Idem {
  /** `request_id` 열 값: `<threadId 또는 ->:<메서드>:<requestId>` */
  readonly key: string;
  /** 입력 지문(sha256). 제안 결정이 다시 실행하는 쓰기는 비어 있다 */
  readonly fingerprint: string;
  /** 호출자가 준 `requestId`. 승인 요청 키의 재료다 */
  readonly raw: string;
}

/** `requestId`가 없으면 undefined(멱등을 보장하지 않는다) */
export function idemOf(
  raw: string | undefined,
  threadId: string | undefined,
  method: string,
  input: unknown,
): Idem | undefined {
  if (raw === undefined) return undefined;
  return {
    key: `${threadId ?? "-"}:${method}:${raw}`,
    fingerprint: sha256Hex(JSON.stringify(input)),
    raw,
  };
}

/** 이미 있는 행의 지문이 이번 호출과 다르면 키 재사용이다. 지문이 없는 행(제안 결정, 옛 행)은 통과한다 */
export function keyReused(stored: string | null, idem: Idem): KnowledgeFailure | undefined {
  if (stored === null || stored === "" || stored === idem.fingerprint) return undefined;
  return failure("invalid_input", "the requestId was already used with a different input", {
    detail: { reason: "key_reused" },
  });
}

import { ok, type Result } from "@xeon/contracts";
import type { KnowledgeCall, KnowledgeFailure, KnowledgePort } from "./knowledge.ts";
import { isDestructiveOp, opAllowedFor, type ProposalKind, type ProposalOp } from "./proposal.ts";
import { parsePatchEdits, parseTarget } from "./target.ts";

// L3.learning.spec §4.6 사전 스캔. 1단계는 학습 그룹 자체 검사(항상), 2단계는 L2-d 스캔(설정이 켜졌을 때).
// 스캔 규칙의 정본은 L2-d다. 학습 그룹은 규칙 이름만 남기고 걸린 문자열은 남기지 않는다.

/** 본문은 비공개 기록 payload에 실린다(봉투 상한 256 KiB). UTF-8 바이트로 잰다 [제안] */
const BODY_MAX_BYTES = 150_000;

export interface ScanInput {
  readonly kind: ProposalKind;
  readonly op: ProposalOp;
  readonly target: string;
  readonly body: string;
  readonly baseHash: string | null;
}

export type ScanOutcome =
  | { readonly kind: "clean" }
  /** 자체 검사 또는 L2 스캔이 막았다. `rules`는 규칙 이름이다 */
  | { readonly kind: "blocked"; readonly rules: readonly string[] }
  /** 연산과 종류의 조합이 맞지 않는다. 후보를 만들지 않는다 */
  | {
      readonly kind: "refused";
      readonly why: "op_not_allowed" | "invalid";
      readonly detail: string;
    };

/** 순수 함수. 1단계 자체 검사: 크기, 대상 이름 형식, 연산과 종류 조합, 파괴적 연산의 baseHash 존재 */
export function selfCheck(input: ScanInput): ScanOutcome {
  if (!opAllowedFor(input.kind, input.op)) {
    return {
      kind: "refused",
      why: "op_not_allowed",
      detail: `${input.kind} does not take ${input.op}`,
    };
  }
  if (new TextEncoder().encode(input.body).length > BODY_MAX_BYTES) {
    return { kind: "blocked", rules: ["learning.body_too_large"] };
  }
  const target = parseTarget(input.kind, input.op, input.target);
  if (!target.ok) return { kind: "refused", why: "invalid", detail: target.error.detail };
  if (isDestructiveOp(input.op) && input.baseHash === null) {
    return { kind: "blocked", rules: ["learning.base_hash_required"] };
  }
  if (input.op === "patch" && !parsePatchEdits(input.body).ok) {
    return {
      kind: "refused",
      why: "invalid",
      detail: "patch body must be a JSON list of {oldText, newText}",
    };
  }
  return { kind: "clean" };
}

/** 2단계 스캔에 보낼 본문. 파괴적이지 않은 연산과 patch의 새 텍스트는 본문 그대로, patch는 치환 목록의 새 텍스트를 이어 붙인다 */
function scanTextOf(input: ScanInput): string {
  if (input.op !== "patch") return input.body;
  const edits = parsePatchEdits(input.body);
  return edits.ok ? edits.value.map((edit) => edit.newText).join("\n") : input.body;
}

/**
 * 사전 스캔 전체. `useL2`가 거짓이면 자체 검사만 한다(`l3.learning.scan.enabled = false`). L2 스캔을 부를 수 없으면(저장소 없음) 오류 값이다:
 * 호출하는 쪽이 후보를 만들지 않고 `unavailable`로 돌려준다
 */
export async function preScan(
  input: ScanInput,
  knowledge: KnowledgePort,
  useL2: boolean,
  call: KnowledgeCall,
): Promise<Result<ScanOutcome, KnowledgeFailure>> {
  const own = selfCheck(input);
  if (own.kind !== "clean" || !useL2) return ok(own);
  const verdict = await knowledge.scan(
    input.kind === "skill" ? "skill" : "memory",
    scanTextOf(input),
    call,
  );
  if (!verdict.ok) return verdict;
  return ok(
    verdict.value.blocked ? { kind: "blocked", rules: verdict.value.rules } : { kind: "clean" },
  );
}

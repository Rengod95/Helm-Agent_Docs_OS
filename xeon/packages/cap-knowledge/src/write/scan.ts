import { err, ok, type Result } from "@xeon/contracts";
import type {
  ApprovalEvidence,
  CallContext,
  ScanFinding,
  ScanSummary,
} from "@xeon/contracts/capabilities";
import { failure, type KnowledgeFailure } from "../errors.ts";
import { blockingRules, SCAN_RULESET_VERSION, scanText } from "../scan/rules.ts";

// L2.knowledge.spec §3.1 쓰기 메서드의 공통 선택 입력 검사와 §4.4.1 5단계 위협 패턴 검사.

const MAX_FINDINGS = 64;

export interface WriteExtrasInput {
  readonly approval?: ApprovalEvidence | undefined;
  readonly overrideScan?: boolean | undefined;
}

export interface WriteExtras {
  /** 호출 확장이 낸 증거. 유효성은 게이트가 판정한다 */
  readonly evidence: ApprovalEvidence | undefined;
  /** 호스트(사용자)가 block을 경고로 낮추라고 했다 */
  readonly overrideScan: boolean;
}

/**
 * `approval`은 호출자 종류가 `extension`일 때만, `overrideScan`은 `host`일 때만 인정한다. 맞지 않으면 무시하지 않고
 * `invalid_input`으로 거부한다. 호출자가 행위자를 꾸며 게이트를 건너뛰지 못하게 하기 위해서다.
 */
export function checkWriteExtras(
  context: CallContext | undefined,
  input: WriteExtrasInput,
): Result<WriteExtras, KnowledgeFailure> {
  const kind = context?.caller.kind;
  if (input.approval !== undefined && kind !== "extension") {
    return err(failure("invalid_input", "approval evidence is only accepted from an extension"));
  }
  if (input.overrideScan !== undefined && kind !== "host") {
    return err(failure("invalid_input", "overrideScan is only accepted from the host"));
  }
  return ok({ evidence: input.approval, overrideScan: input.overrideScan === true });
}

export interface ScanTarget {
  readonly text: string;
  /** `scripts/` 아래 파일처럼 유출 규칙을 엄격하게 적용한다 */
  readonly strict: boolean;
}

export interface ScanPolicy {
  /** 스킬 쓰기는 `l2.knowledge.write.scan`을 따르고 메모리 쓰기는 항상 true다 */
  readonly enabled: boolean;
  readonly overrideScan: boolean;
  readonly containsKnown: ((text: string) => boolean) | undefined;
}

const EMPTY: ScanSummary = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };

/**
 * 바뀌는 텍스트를 모두 검사해 하나의 요약으로 합친다. `block`이 있으면 `scan_blocked`로 거부하고 오류에는 규칙 이름만 싣는다
 * (걸린 문자열은 어디에도 담지 않는다). `overrideScan`이면 `block`을 `warn`으로 낮춰 통과시킨다.
 */
export function scanForWrite(
  kind: "skill" | "memory",
  targets: readonly ScanTarget[],
  policy: ScanPolicy,
): Result<ScanSummary, KnowledgeFailure> {
  if (!policy.enabled) return ok(EMPTY);
  const findings = targets.flatMap(
    (target) =>
      scanText(kind, target.text, { strict: target.strict, containsKnown: policy.containsKnown })
        .findings,
  );
  const merged: ScanSummary = {
    rulesetVersion: SCAN_RULESET_VERSION,
    findings: [
      ...findings.filter((finding) => finding.severity === "block"),
      ...findings.filter((finding) => finding.severity === "warn"),
    ].slice(0, MAX_FINDINGS),
  };
  const rules = blockingRules(merged);
  if (rules.length === 0) return ok(merged);
  if (policy.overrideScan) {
    const lowered: ScanFinding[] = [];
    for (const finding of merged.findings) {
      lowered.push({
        rule: finding.rule,
        severity: "warn",
        ...(finding.line === undefined ? {} : { line: finding.line }),
      });
    }
    return ok({ rulesetVersion: merged.rulesetVersion, findings: lowered });
  }
  return err(
    failure("scan_blocked", `the threat scan blocked this change: ${rules.join(", ")}`, {
      detail: { rules: [...rules] },
    }),
  );
}

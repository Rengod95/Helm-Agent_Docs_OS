import { parse, parseJson, type SchemaProof } from "@xeon/contracts";
import { Type, type TUnsafe } from "typebox";
import {
  ConfidenceSchema,
  HelmSourceSchema,
  type Confidence,
  type HelmFinding,
  type HelmSource,
} from "./state.ts";

/** explorer 답의 기대 형식. 답 끝의 JSON 블록 하나 */
interface ExplorerReport {
  findings: {
    claim: string;
    sources: HelmSource[];
    confidence: Confidence;
    followUp?: string;
  }[];
}
const reportShape = Type.Object({
  findings: Type.Array(
    Type.Object({
      claim: Type.String({ minLength: 1, maxLength: 1000 }),
      sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
      confidence: ConfidenceSchema,
      followUp: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    }),
    { maxItems: 8 },
  ),
});
export const ExplorerReportSchema: TUnsafe<ExplorerReport> = Type.Unsafe<ExplorerReport>(
  reportShape satisfies SchemaProof<ExplorerReport, typeof reportShape>,
);

const FINDINGS_MAX = 24;

const FENCE = /```(?:json)?\s*([\s\S]*?)```/g;

/** 답에서 JSON 후보를 뒤에서부터 모은다: 마지막 코드 블록, 그 앞 블록, 답 전체 */
function jsonCandidates(answer: string): readonly string[] {
  const fenced = [...answer.matchAll(FENCE)].map((match) => match[1] ?? "").toReversed();
  return [...fenced, answer.trim()];
}

/**
 * 순수 함수. explorer 답의 JSON 블록을 발견 목록으로 바꾼다. 형식이 맞지 않으면 답 전체를 low 신뢰 발견 1건으로 바꾼다.
 * 답이 비어 있으면 빈 목록이다(호출자가 렌즈를 failed로 센다). 발견 id는 `${lensId}-${n}`이다
 */
export function parseExplorerAnswer(
  lensId: string,
  answer: string | undefined,
): readonly HelmFinding[] {
  const text = answer?.trim() ?? "";
  if (text === "") return [];
  for (const candidate of jsonCandidates(text)) {
    const json = parseJson(candidate);
    if (!json.ok) continue;
    const report = parse(ExplorerReportSchema, json.value);
    if (!report.ok) continue;
    const out: HelmFinding[] = [];
    for (const [index, found] of report.value.findings.entries()) {
      const finding: HelmFinding = {
        id: `${lensId}-${String(index + 1)}`,
        lensId,
        claim: found.claim,
        sources: found.sources,
        confidence: found.confidence,
      };
      if (found.followUp !== undefined) finding.followUp = found.followUp;
      out.push(finding);
    }
    return out;
  }
  return [
    { id: `${lensId}-1`, lensId, claim: text.slice(0, 1000), sources: [], confidence: "low" },
  ];
}

function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/\s+/gu, " ").trim();
}

/** 순수 함수. 같은 claim(정규화 문자열)을 지우고 24개에서 자른다 */
export function dedupeFindings(findings: readonly HelmFinding[]): readonly HelmFinding[] {
  const seen = new Set<string>();
  const kept: HelmFinding[] = [];
  for (const finding of findings) {
    const key = normalizeClaim(finding.claim);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(finding);
  }
  return kept.slice(0, FINDINGS_MAX);
}

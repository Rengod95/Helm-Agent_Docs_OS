import { parse, parseJson, type SchemaProof } from "@fresnel/contracts";
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

const CLAIM_MAX = 1000;
const REF_MAX = 512;
const TITLE_MAX = 80;
const FOLLOW_UP_MAX = 200;
const FINDINGS_PER_REPORT_MAX = 8;
const SOURCES_PER_FINDING_MAX = 4;

/** 형식 검사 없이 모양만 보는 느슨한 스키마. 길이 상한은 검사로 거절하지 않고 아래에서 자른다(spec §3.2 "상한을 넘는 입력은 앞에서부터 자른다") */
const looseReport = Type.Object({ findings: Type.Array(Type.Unknown()) });
const looseFinding = Type.Object({
  claim: Type.String(),
  sources: Type.Optional(Type.Array(Type.Unknown())),
  confidence: Type.Optional(Type.String()),
  followUp: Type.Optional(Type.String()),
});
const looseSource = Type.Object({
  origin: Type.String(),
  ref: Type.String(),
  title: Type.Optional(Type.String()),
});

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function confidenceOf(raw: string | undefined): Confidence {
  return raw === "high" || raw === "medium" || raw === "low" ? raw : "low";
}

function sourceOf(raw: unknown): HelmSource | undefined {
  const loose = parse(looseSource, raw);
  if (!loose.ok) return undefined;
  const { origin, ref, title } = loose.value;
  const trimmed = ref.trim();
  if (trimmed === "") return undefined;
  if (origin !== "web" && origin !== "knowledge" && origin !== "session") return undefined;
  const source: HelmSource = { origin, ref: cut(trimmed, REF_MAX) };
  const name = title?.trim() ?? "";
  if (name !== "") source.title = cut(name, TITLE_MAX);
  return source;
}

/** 보고의 발견 하나. 주장이 비었거나 모양이 틀리면 버린다. 출처는 모양이 맞는 것만 4개까지, 긴 글은 상한에서 자른다 */
function findingOf(lensId: string, number: number, raw: unknown): HelmFinding | undefined {
  const loose = parse(looseFinding, raw);
  if (!loose.ok) return undefined;
  const claim = loose.value.claim.trim();
  if (claim === "") return undefined;
  const sources = (loose.value.sources ?? [])
    .map(sourceOf)
    .filter((source): source is HelmSource => source !== undefined)
    .slice(0, SOURCES_PER_FINDING_MAX);
  const finding: HelmFinding = {
    id: `${lensId}-${String(number)}`,
    lensId,
    claim: cut(claim, CLAIM_MAX),
    sources,
    confidence: confidenceOf(loose.value.confidence),
  };
  const followUp = loose.value.followUp?.trim() ?? "";
  if (followUp !== "") finding.followUp = cut(followUp, FOLLOW_UP_MAX);
  return finding;
}

const REPORT_WRAPPER = /<\/?subagent_report\b[^>]*>/gu;

/** 하위 에이전트 보고를 감싼 `<subagent_report …>` 표지를 지운 글 */
function unwrapped(answer: string): string {
  return answer.replace(REPORT_WRAPPER, "").trim();
}

/**
 * 순수 함수. explorer 답의 JSON 블록을 발견 목록으로 바꾼다. 주장(`claim`), 근거(`sources`), 신뢰도(`confidence`)로 나누고,
 * 글이 상한을 넘으면(출처 제목 80자 등) 거절하지 않고 자른다. 모양이 맞는 발견이 하나도 없으면 하위 에이전트 보고 표지를 뗀 답 전체를
 * low 신뢰 발견 1건으로 바꾼다. 답이 비어 있으면 빈 목록이다(호출자가 렌즈를 failed로 센다). 발견 id는 `${lensId}-${n}`이다
 */
export function parseExplorerAnswer(
  lensId: string,
  answer: string | undefined,
): readonly HelmFinding[] {
  const text = unwrapped(answer ?? "");
  if (text === "") return [];
  for (const candidate of jsonCandidates(text)) {
    const json = parseJson(candidate);
    if (!json.ok) continue;
    const report = parse(looseReport, json.value);
    if (!report.ok) continue;
    if (report.value.findings.length === 0) return [];
    const out: HelmFinding[] = [];
    for (const raw of report.value.findings.slice(0, FINDINGS_PER_REPORT_MAX)) {
      const found = findingOf(lensId, out.length + 1, raw);
      if (found !== undefined) out.push(found);
    }
    if (out.length > 0) return out;
  }
  return [
    {
      id: `${lensId}-1`,
      lensId,
      claim: cut(text, CLAIM_MAX),
      sources: [],
      confidence: "low",
    },
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

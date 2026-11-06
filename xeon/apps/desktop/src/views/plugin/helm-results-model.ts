import { t } from "@fresnel/client/i18n";
import { parse, type SchemaProof } from "@fresnel/contracts";
import { Type, type TUnsafe } from "typebox";

// Helm 탐구 결과 패널의 값 모델. `ext.helm.inquiries`와 `ext.helm.findings`의 결과(`unknown`)를 스키마로 검사하고,
// 탐구 하나를 Markdown 글로 바꾼다. 모양이 맞지 않으면 파서는 `null`을 준다(화면이 "결과를 읽지 못했어요"를 보인다).
// 이 파일은 DOM을 쓰지 않는다. 화면은 `helm-results.tsx`가 그린다. 모양은 group-helm의 `methods.ts`(결과 스키마)를 따른다.
// 스키마는 `Type.Unsafe<T>`에 `SchemaProof`로 붙여, 정적 타입과 스키마가 어긋나면 컴파일이 막는다(TY-26).

/** 출처 한 건. `ref`는 URL 또는 지식 항목 참조다 */
export interface HelmSourceView {
  readonly origin: "web" | "knowledge" | "session";
  readonly ref: string;
  readonly title?: string;
}

/** 탐구 목록의 한 줄. 끝난 탐구만 결과가 있다 */
export interface InquirySummary {
  readonly inquiryId: string;
  readonly topic: string;
  readonly status: "pending" | "running" | "finished";
  readonly outcome: "applied" | "empty" | "stopped" | "limit" | "failed" | null;
  readonly findingCount: number;
}

/** 발견 한 건 */
export interface HelmFindingView {
  readonly id: string;
  readonly lensId: string;
  readonly claim: string;
  readonly sources: readonly HelmSourceView[];
  readonly confidence: "low" | "medium" | "high";
}

export interface InquiriesView {
  readonly inquiries: readonly InquirySummary[];
}

export interface FindingsView {
  readonly inquiryId: string;
  readonly findings: readonly HelmFindingView[];
}

type InquiryStatus = InquirySummary["status"];
type InquiryOutcome = NonNullable<InquirySummary["outcome"]>;
type HelmConfidence = HelmFindingView["confidence"];
type HelmSourceOrigin = HelmSourceView["origin"];

const sourceShape = Type.Object({
  origin: Type.Union([Type.Literal("web"), Type.Literal("knowledge"), Type.Literal("session")]),
  ref: Type.String(),
  title: Type.Optional(Type.String()),
});
const SourceSchema: TUnsafe<HelmSourceView> = Type.Unsafe<HelmSourceView>(
  sourceShape satisfies SchemaProof<HelmSourceView, typeof sourceShape>,
);

const inquiryShape = Type.Object({
  inquiryId: Type.String(),
  topic: Type.String(),
  status: Type.Union([Type.Literal("pending"), Type.Literal("running"), Type.Literal("finished")]),
  outcome: Type.Union([
    Type.Literal("applied"),
    Type.Literal("empty"),
    Type.Literal("stopped"),
    Type.Literal("limit"),
    Type.Literal("failed"),
    Type.Null(),
  ]),
  findingCount: Type.Integer({ minimum: 0 }),
});
const InquirySchema: TUnsafe<InquirySummary> = Type.Unsafe<InquirySummary>(
  inquiryShape satisfies SchemaProof<InquirySummary, typeof inquiryShape>,
);

const findingShape = Type.Object({
  id: Type.String(),
  lensId: Type.String(),
  claim: Type.String(),
  sources: Type.Array(SourceSchema),
  confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
});
const FindingSchema: TUnsafe<HelmFindingView> = Type.Unsafe<HelmFindingView>(
  findingShape satisfies SchemaProof<HelmFindingView, typeof findingShape>,
);

const inquiriesShape = Type.Object({ inquiries: Type.Array(InquirySchema) });
const InquiriesSchema: TUnsafe<InquiriesView> = Type.Unsafe<InquiriesView>(
  inquiriesShape satisfies SchemaProof<InquiriesView, typeof inquiriesShape>,
);

const findingsShape = Type.Object({
  inquiryId: Type.String(),
  findings: Type.Array(FindingSchema),
});
const FindingsSchema: TUnsafe<FindingsView> = Type.Unsafe<FindingsView>(
  findingsShape satisfies SchemaProof<FindingsView, typeof findingsShape>,
);

/** `ext.helm.inquiries`의 결과를 검사한다. 모양이 맞지 않으면 null이다 */
export function inquiriesOf(value: unknown): InquiriesView | null {
  const checked = parse(InquiriesSchema, value);
  return checked.ok ? checked.value : null;
}

/** `ext.helm.findings`의 결과를 검사한다. 모양이 맞지 않으면 null이다 */
export function findingsOf(value: unknown): FindingsView | null {
  const checked = parse(FindingsSchema, value);
  return checked.ok ? checked.value : null;
}

/** 화면과 Markdown이 함께 쓰는 글. 로케일을 따른다 */
export interface HelmResultsLabels {
  readonly untitled: string;
  readonly statuses: Readonly<Record<InquiryStatus, string>>;
  readonly outcomes: Readonly<Record<InquiryOutcome, string>>;
  readonly confidences: Readonly<Record<HelmConfidence, string>>;
  readonly origins: Readonly<Record<HelmSourceOrigin, string>>;
  readonly outcome: string;
  readonly findings: string;
  readonly confidence: string;
  readonly sources: string;
  readonly noFindings: string;
  /** Markdown의 발견 수 자리. 예: "4개" */
  readonly count: (n: number) => string;
  /** 목록 줄의 발견 수. 예: "발견 4개" */
  readonly findingCount: (n: number) => string;
}

export function helmResultsLabelsOf(): HelmResultsLabels {
  return {
    untitled: t("desktop.helm.results.untitled"),
    statuses: {
      pending: t("desktop.helm.results.status.pending"),
      running: t("desktop.helm.results.status.running"),
      finished: t("desktop.helm.results.status.finished"),
    },
    outcomes: {
      applied: t("desktop.helm.results.outcome.applied"),
      empty: t("desktop.helm.results.outcome.empty"),
      stopped: t("desktop.helm.results.outcome.stopped"),
      limit: t("desktop.helm.results.outcome.limit"),
      failed: t("desktop.helm.results.outcome.failed"),
    },
    confidences: {
      high: t("desktop.helm.results.confidence.high"),
      medium: t("desktop.helm.results.confidence.medium"),
      low: t("desktop.helm.results.confidence.low"),
    },
    origins: {
      web: t("desktop.helm.results.origin.web"),
      knowledge: t("desktop.helm.results.origin.knowledge"),
      session: t("desktop.helm.results.origin.session"),
    },
    outcome: t("desktop.helm.results.label.outcome"),
    findings: t("desktop.helm.results.label.findings"),
    confidence: t("desktop.helm.results.label.confidence"),
    sources: t("desktop.helm.results.label.sources"),
    noFindings: t("desktop.helm.results.noFindings"),
    count: (n) => t("desktop.helm.results.label.count", { n }),
    findingCount: (n) => t("desktop.helm.results.findingCount", { n }),
  };
}

/** 줄바꿈을 공백으로 펴고 양끝을 뗀다. 주제와 주장이 목록 줄을 깨지 않게 한다. 다른 이스케이프는 하지 않는다 */
function oneLine(text: string): string {
  return text.replaceAll(/\s*[\r\n]+\s*/g, " ").trim();
}

/** 출처 한 줄. 예: "[웹] 문서 제목 (https://example.com)". 제목이 없으면 참조만 쓴다 */
export function sourceTextOf(source: HelmSourceView, labels: HelmResultsLabels): string {
  const ref = oneLine(source.ref);
  const name = source.title === undefined ? ref : `${oneLine(source.title)} (${ref})`;
  return `[${labels.origins[source.origin]}] ${name}`;
}

/** 목록 줄의 결과 글. 끝난 탐구는 결과와 발견 수를, 아직 끝나지 않은 탐구는 발견 수만 보인다 */
export function captionOf(inquiry: InquirySummary, labels: HelmResultsLabels): string {
  const count = labels.findingCount(inquiry.findingCount);
  return inquiry.outcome === null ? count : `${labels.outcomes[inquiry.outcome]} · ${count}`;
}

/**
 * 탐구 하나를 Markdown으로 만든다. 제목은 주제, 결과는 끝난 결과(끝나지 않았으면 상태), 발견 수는 아래 목록의 개수다.
 * 발견마다 주장과 신뢰도를 적고, 출처는 발견 아래에 한 줄씩 둔다. 끝 줄바꿈은 없다
 */
export function markdownOf(inquiry: InquirySummary, findings: readonly HelmFindingView[]): string {
  const labels = helmResultsLabelsOf();
  const result =
    inquiry.outcome === null ? labels.statuses[inquiry.status] : labels.outcomes[inquiry.outcome];
  const lines: string[] = [
    `# ${oneLine(inquiry.topic) || labels.untitled}`,
    "",
    `- ${labels.outcome}: ${result}`,
    `- ${labels.findings}: ${labels.count(findings.length)}`,
    "",
    `## ${labels.findings}`,
    "",
  ];
  if (findings.length === 0) lines.push(labels.noFindings);
  for (const [index, finding] of findings.entries()) {
    lines.push(
      `${index + 1}. ${oneLine(finding.claim)} (${labels.confidence}: ${labels.confidences[finding.confidence]})`,
    );
    for (const source of finding.sources) {
      lines.push(`   - ${labels.sources}: ${sourceTextOf(source, labels)}`);
    }
  }
  return lines.join("\n");
}

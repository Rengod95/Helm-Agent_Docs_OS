import { Bug, parse, type SchemaProof } from "@fresnel/contracts";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import type { GroupApi } from "@fresnel/group-sdk";
import { Type, type TUnsafe } from "typebox";
import { viewOf, type HelmStatusView } from "./commands.ts";
import { dedupeFindings } from "./findings.ts";
import { jsonSchemaOf } from "./json-schema.ts";
import {
  DiscoveryRecordedPayloadSchema,
  InquiryFinishedPayloadSchema,
  dedupeInquiryFinished,
  type DiscoveryRecordedPayload,
  type InquiryFinishedPayload,
  type InquiryOutcome,
} from "./records.ts";
import {
  ConfidenceSchema,
  HelmPhaseSchema,
  HelmSourceSchema,
  INITIAL_HELM_STATE,
  INQUIRY_ID_PATTERN,
  LENS_ID_PATTERN,
  type HelmFinding,
  type HelmState,
} from "./state.ts";

// 확장 메서드 세 개(ADR-0021 §3.10, X-9). wire 이름은 `ext.helm.<verb>`이고 모두 읽기 전용이다.
// 선언(params, result 스키마)과 읽기 함수는 이 파일이 쓰고, manifest.ts가 선언을, index.ts가 처리기 등록을 부른다.
// 결과 타입은 아래 인터페이스가 정하고, 스키마는 `SchemaProof`로 그 타입과 모양이 맞는지 컴파일 때 본다(state.ts와 같다).

// ── 입력과 결과의 타입 ──────────────────────────────────────────────────────

/** 탐구 목록의 한 줄. 현재 탐구는 상태에서, 끝난 탐구는 종료 기록에서 온다. 기록에는 시각이 없어 finishedAt은 없다 */
export interface InquirySummary {
  readonly inquiryId: string;
  readonly topic: string;
  readonly status: "pending" | "running" | "finished";
  /** 끝난 탐구의 결과. 대기와 진행 중이면 null */
  readonly outcome: InquiryOutcome | null;
  /** 끝난 탐구는 종료 기록의 발견 수, 진행 중이면 상태의 발견 수, 대기는 0 */
  readonly findingCount: number;
}

export interface InquiriesView {
  readonly inquiries: readonly InquirySummary[];
}

/** findings 입력. 탐구 id 하나 */
export interface FindingsParams {
  readonly inquiryId: string;
}

export interface FindingsView {
  readonly inquiryId: string;
  readonly findings: readonly HelmFinding[];
}

// ── 스키마 ──────────────────────────────────────────────────────────────────

const emptyParamsShape = Type.Object({}, { additionalProperties: false });

const findingsParamsShape = Type.Object(
  { inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }) },
  { additionalProperties: false },
);
const FindingsParamsSchema: TUnsafe<FindingsParams> = Type.Unsafe<FindingsParams>(
  findingsParamsShape satisfies SchemaProof<FindingsParams, typeof findingsParamsShape>,
);

const lensShape = Type.Object(
  {
    id: Type.String({ pattern: LENS_ID_PATTERN }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("running"),
      Type.Literal("done"),
      Type.Literal("failed"),
      Type.Literal("skipped"),
    ]),
  },
  { additionalProperties: false },
);

/** status 결과. HelmStatusView와 같은 모양이다 */
const statusViewShape = Type.Object(
  {
    enabled: Type.Boolean(),
    phase: HelmPhaseSchema,
    inquiryId: Type.Union([Type.String({ pattern: INQUIRY_ID_PATTERN }), Type.Null()]),
    topic: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    lenses: Type.Array(lensShape, { maxItems: 8 }),
    findings: Type.Integer({ minimum: 0 }),
    lease: Type.Union([Type.Literal("held"), Type.Literal("waiting"), Type.Literal("none")]),
    leaseHolder: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const StatusViewSchema: TUnsafe<HelmStatusView> = Type.Unsafe<HelmStatusView>(
  statusViewShape satisfies SchemaProof<HelmStatusView, typeof statusViewShape>,
);

const inquirySummaryShape = Type.Object(
  {
    inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
    // 종료 기록의 topic은 상한만 있다(빈 문자열이 올 수 있다)
    topic: Type.String({ maxLength: 500 }),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("running"),
      Type.Literal("finished"),
    ]),
    outcome: Type.Union([
      Type.Literal("applied"),
      Type.Literal("empty"),
      Type.Literal("stopped"),
      Type.Literal("limit"),
      Type.Literal("failed"),
      Type.Null(),
    ]),
    findingCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
const InquirySummarySchema: TUnsafe<InquirySummary> = Type.Unsafe<InquirySummary>(
  inquirySummaryShape satisfies SchemaProof<InquirySummary, typeof inquirySummaryShape>,
);

const inquiriesViewShape = Type.Object(
  { inquiries: Type.Array(InquirySummarySchema, { maxItems: 50 }) },
  { additionalProperties: false },
);
const InquiriesViewSchema: TUnsafe<InquiriesView> = Type.Unsafe<InquiriesView>(
  inquiriesViewShape satisfies SchemaProof<InquiriesView, typeof inquiriesViewShape>,
);

/** 발견 한 건. 상태의 발견과 발견 기록에서 만든 발견이 같은 모양이다(followUp은 상태의 발견에만 있다) */
const findingShape = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    lensId: Type.String({ pattern: LENS_ID_PATTERN }),
    claim: Type.String({ minLength: 1, maxLength: 1000 }),
    sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
    confidence: ConfidenceSchema,
    followUp: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
const FindingSchema: TUnsafe<HelmFinding> = Type.Unsafe<HelmFinding>(
  findingShape satisfies SchemaProof<HelmFinding, typeof findingShape>,
);

const findingsViewShape = Type.Object(
  {
    inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
    findings: Type.Array(FindingSchema, { maxItems: 24 }),
  },
  { additionalProperties: false },
);
const FindingsViewSchema: TUnsafe<FindingsView> = Type.Unsafe<FindingsView>(
  findingsViewShape satisfies SchemaProof<FindingsView, typeof findingsViewShape>,
);

/** 매니페스트 `methods`에 싣는 선언 세 개. 검사기가 이 스키마로 입력과 결과를 본다 */
export const helmMethodDecls: ExtMethodDecl[] = [
  {
    verb: "status",
    params: jsonSchemaOf(emptyParamsShape),
    result: jsonSchemaOf(StatusViewSchema),
    readOnly: true,
  },
  {
    verb: "inquiries",
    params: jsonSchemaOf(emptyParamsShape),
    result: jsonSchemaOf(InquiriesViewSchema),
    readOnly: true,
  },
  {
    verb: "findings",
    params: jsonSchemaOf(FindingsParamsSchema),
    result: jsonSchemaOf(FindingsViewSchema),
    readOnly: true,
  },
];

// ── 읽기 ────────────────────────────────────────────────────────────────────

type ReadApi = Pick<GroupApi<HelmState>, "state" | "readRecords">;

const INQUIRIES_MAX = 50;

/** 지금 상태에 있는 탐구(진행 중이거나 시작을 기다리는 것). 없으면 undefined */
function currentOf(state: Readonly<HelmState>): InquirySummary | undefined {
  if (state.phase !== "idle" && state.inquiryId !== null && state.topic !== null) {
    return {
      inquiryId: state.inquiryId,
      topic: state.topic,
      status: "running",
      outcome: null,
      findingCount: state.findings.length,
    };
  }
  if (state.pending !== null) {
    return {
      inquiryId: state.pending.inquiryId,
      topic: state.pending.topic,
      status: "pending",
      outcome: null,
      findingCount: 0,
    };
  }
  return undefined;
}

function finishedOf(record: InquiryFinishedPayload): InquirySummary {
  return {
    inquiryId: record.inquiryId,
    topic: record.topic,
    status: "finished",
    outcome: record.outcome,
    findingCount: record.findingCount,
  };
}

/** 끝난 탐구를 최신 순으로 읽는다. 기록은 쓴 순서(오래된 것부터)로 나오므로 중복을 지운 뒤 뒤집는다 */
async function finishedInquiries(g: ReadApi): Promise<readonly InquirySummary[]> {
  const records = await g.readRecords({ kind: "grp.helm.inquiry.finished" });
  // 형식이 맞지 않는 기록은 목록에서 뺀다. 같은 kind의 최신 버전 스키마를 넘는 기록은 읽기 쪽 기록 검사가 이미 알렸다
  const parsed = records.flatMap((record) => {
    const checked = parse(InquiryFinishedPayloadSchema, record.payload);
    return checked.ok ? [checked.value] : [];
  });
  return dedupeInquiryFinished(parsed).toReversed().map(finishedOf);
}

/** 탐구 목록. 현재 탐구가 맨 앞이고 끝난 탐구는 최신 순이다. 최대 50개 */
async function inquiriesOf(g: ReadApi): Promise<InquiriesView> {
  const current = currentOf(g.state());
  const finished = await finishedInquiries(g);
  const all = current === undefined ? finished : [current, ...finished];
  return { inquiries: all.slice(0, INQUIRIES_MAX) };
}

/** 발견 기록 한 건을 발견 보기로 바꾼다. 기록에는 followUp이 없다 */
function findingOfRecord(payload: DiscoveryRecordedPayload): HelmFinding {
  return {
    id: payload.findingId,
    lensId: payload.lens,
    claim: payload.claim,
    sources: payload.sources,
    confidence: payload.confidence,
  };
}

/**
 * 발견 목록. 현재 탐구는 상태의 발견을 그대로 준다. 끝난 탐구는 `grp.helm.discovery.recorded` 기록에서 모은다
 * (종료 기록은 발견 수만 싣는다). 모르는 탐구 id는 빈 목록이다
 */
async function findingsOf(g: ReadApi, inquiryId: string): Promise<FindingsView> {
  const state = g.state();
  if (state.inquiryId === inquiryId) return { inquiryId, findings: [...state.findings] };
  const records = await g.readRecords({ kind: "grp.helm.discovery.recorded" });
  const found = records.flatMap((record) => {
    const checked = parse(DiscoveryRecordedPayloadSchema, record.payload);
    return checked.ok && checked.value.inquiryId === inquiryId
      ? [findingOfRecord(checked.value)]
      : [];
  });
  return { inquiryId, findings: dedupeFindings(found) };
}

function inquiryIdOf(params: unknown): string | undefined {
  const checked = parse(FindingsParamsSchema, params);
  return checked.ok ? checked.value.inquiryId : undefined;
}

// ── 등록 ────────────────────────────────────────────────────────────────────

export type HelmMethodsApi = Pick<GroupApi<HelmState>, "state" | "readRecords" | "registerMethod">;

/**
 * 처리기 세 개를 등록한다(setup 안에서). 스레드가 없는 호출은 상태에 닿을 수 없으므로 빈 값을 준다:
 * status는 대기 상태 보기, inquiries는 빈 목록, findings는 빈 발견 목록이다.
 * 입력은 호스트가 선언 스키마로 이미 검사했으므로 findings의 형식 실패는 호스트 결함이다
 */
export function registerHelmMethods(g: HelmMethodsApi): void {
  g.registerMethod("status", {
    handler: (_params, ctx) =>
      Promise.resolve(viewOf(ctx.threadId === null ? INITIAL_HELM_STATE : g.state())),
  });
  g.registerMethod("inquiries", {
    handler: (_params, ctx) =>
      ctx.threadId === null ? Promise.resolve({ inquiries: [] }) : inquiriesOf(g),
  });
  g.registerMethod("findings", {
    handler: (params, ctx) => {
      const inquiryId = inquiryIdOf(params);
      if (inquiryId === undefined) {
        throw new Bug("helm.findings: the host passed params outside the declared schema");
      }
      return ctx.threadId === null
        ? Promise.resolve({ inquiryId, findings: [] })
        : findingsOf(g, inquiryId);
    },
  });
}

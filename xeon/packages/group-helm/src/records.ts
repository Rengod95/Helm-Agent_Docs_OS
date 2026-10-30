import type { RecordKindDecl } from "@xeon/contracts/extensions";
import { Bug, type SchemaProof } from "@xeon/contracts";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import { Type, type TUnsafe } from "typebox";
import {
  ConfidenceSchema,
  HelmSignalKindSchema,
  HelmSourceSchema,
  INQUIRY_ID_PATTERN,
  LENS_ID_PATTERN,
  type Confidence,
  type HelmSignalKind,
  type HelmSource,
} from "./state.ts";

export interface SignalDetectedPayload {
  signal: HelmSignalKind;
  /** 신호를 낸 turn */
  turnId: string;
  /** 판정 근거. 요약만 둔다(인자 원문, 오류 원문을 싣지 않는다) */
  evidence: { toolName?: string; count: number; terms?: string[] };
  /** 기록 시점의 autoStart에 따른 처리 */
  action: "recorded" | "suggested" | "requested";
  inquiryId: string | null;
}
const signalDetectedShape = Type.Object({
  signal: HelmSignalKindSchema,
  turnId: Type.String(),
  evidence: Type.Object({
    toolName: Type.Optional(Type.String({ maxLength: 64 })),
    count: Type.Integer({ minimum: 1 }),
    terms: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 })),
  }),
  action: Type.Union([
    Type.Literal("recorded"),
    Type.Literal("suggested"),
    Type.Literal("requested"),
  ]),
  inquiryId: Type.Union([Type.String({ pattern: INQUIRY_ID_PATTERN }), Type.Null()]),
});
export const SignalDetectedPayloadSchema: TUnsafe<SignalDetectedPayload> =
  Type.Unsafe<SignalDetectedPayload>(
    signalDetectedShape satisfies SchemaProof<SignalDetectedPayload, typeof signalDetectedShape>,
  );

export interface DiscoveryRecordedPayload {
  inquiryId: string;
  lens: string;
  claim: string;
  sources: HelmSource[];
  /** 적용 turn이 completed로 끝났으면 참 */
  applied: boolean;
  confidence: Confidence;
  /** 중복 제거 키. HelmFinding.id */
  findingId: string;
  /** work 능력으로 만든 작업 id. 없으면 생략 */
  taskId?: string;
}
const discoveryShape = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  lens: Type.String({ pattern: LENS_ID_PATTERN }),
  claim: Type.String({ minLength: 1, maxLength: 1000 }),
  sources: Type.Array(HelmSourceSchema, { maxItems: 4 }),
  applied: Type.Boolean(),
  confidence: ConfidenceSchema,
  findingId: Type.String(),
  taskId: Type.Optional(Type.String()),
});
export const DiscoveryRecordedPayloadSchema: TUnsafe<DiscoveryRecordedPayload> =
  Type.Unsafe<DiscoveryRecordedPayload>(
    discoveryShape satisfies SchemaProof<DiscoveryRecordedPayload, typeof discoveryShape>,
  );

export type InquiryOutcome = "applied" | "empty" | "stopped" | "limit" | "failed";

export interface InquiryFinishedPayload {
  inquiryId: string;
  outcome: InquiryOutcome;
  topic: string;
  rounds: number;
  lensCount: number;
  failedLenses: number;
  findingCount: number;
  appliedTurnId: string | null;
  limit?: "turns" | "spawns" | "tokens";
  reason?: string;
}
const finishedShape = Type.Object({
  inquiryId: Type.String({ pattern: INQUIRY_ID_PATTERN }),
  outcome: Type.Union([
    Type.Literal("applied"),
    Type.Literal("empty"),
    Type.Literal("stopped"),
    Type.Literal("limit"),
    Type.Literal("failed"),
  ]),
  topic: Type.String({ maxLength: 500 }),
  rounds: Type.Integer({ minimum: 0 }),
  lensCount: Type.Integer({ minimum: 0 }),
  failedLenses: Type.Integer({ minimum: 0 }),
  findingCount: Type.Integer({ minimum: 0 }),
  appliedTurnId: Type.Union([Type.String(), Type.Null()]),
  limit: Type.Optional(
    Type.Union([Type.Literal("turns"), Type.Literal("spawns"), Type.Literal("tokens")]),
  ),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
});
export const InquiryFinishedPayloadSchema: TUnsafe<InquiryFinishedPayload> =
  Type.Unsafe<InquiryFinishedPayload>(
    finishedShape satisfies SchemaProof<InquiryFinishedPayload, typeof finishedShape>,
  );

/**
 * `grp.helm.inquiry.finished` 기록을 읽는 쪽의 중복 제거 규칙(L3.helm.spec §4.8). 재시작으로 임대가 바뀌면
 * 같은 탐구의 종료가 두 번 기록될 수 있다. inquiryId가 같은 기록은 처음 것만 남기고, inquiryId가 null인
 * 기록은 묶을 키가 없어 모두 남긴다. 순서는 그대로 둔다. 순수 함수이고 L4 알림 읽기도 이 함수를 쓴다.
 */
export function dedupeInquiryFinished<T extends { readonly inquiryId: string | null }>(
  records: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (record.inquiryId === null) return true;
    if (seen.has(record.inquiryId)) return false;
    seen.add(record.inquiryId);
    return true;
  });
}

export const HELM_RECORD_KINDS: readonly RecordKindDecl[] = [
  {
    kind: "grp.helm.signal.detected",
    version: 1,
    description: "탐구 신호 관찰",
    payload: SignalDetectedPayloadSchema,
  },
  {
    kind: "grp.helm.discovery.recorded",
    version: 1,
    description: "탐구 발견 1건",
    payload: DiscoveryRecordedPayloadSchema,
  },
  {
    kind: "grp.helm.inquiry.finished",
    version: 1,
    description: "탐구 종료",
    payload: InquiryFinishedPayloadSchema,
  },
];

/** 레코드 payload를 JSON 값으로 좁힌다. JSON이 아니면 스키마가 막았어야 하는 코드 결함이다 */
export function jsonOf(value: unknown): JsonValue {
  const json = toJsonValue(value);
  if (json === undefined) throw new Bug("helm.record: the payload is not JSON");
  return json;
}

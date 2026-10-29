import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { validateGroupRecord, RECORD_KIND_PATTERN } from "@xeon/contracts/extensions";
import {
  DiscoveryRecordedPayloadSchema,
  HELM_RECORD_KINDS,
  dedupeInquiryFinished,
  InquiryFinishedPayloadSchema,
  jsonOf,
  type DiscoveryRecordedPayload,
} from "../../src/records.ts";

const SAMPLE: DiscoveryRecordedPayload = {
  inquiryId: "habcdefghijklm",
  lens: "analogy",
  claim: "면역 기억처럼 캐시 항목에 만료 대신 재검증을 둔다",
  sources: [{ origin: "web", ref: "https://example.test/a", title: "예" }],
  applied: true,
  confidence: "medium",
  findingId: "analogy-1",
};

test("records.discovery-schema-valid", () => {
  const decl = HELM_RECORD_KINDS.find((kind) => kind.kind === "grp.helm.discovery.recorded");
  expect(parse(DiscoveryRecordedPayloadSchema, SAMPLE).ok).toBe(true);
  const record = {
    groupId: "helm",
    kind: "grp.helm.discovery.recorded",
    version: 1,
    subject: { type: "turn", id: "trn_1" },
    payload: jsonOf(SAMPLE),
  } as const;
  expect(validateGroupRecord(record, decl)).toEqual([]);
  const bad = { ...record, payload: jsonOf({ ...SAMPLE, confidence: "certain" }) };
  const issues = validateGroupRecord(bad, decl);
  expect(issues.length).toBeGreaterThan(0);
  expect(new Set(issues.map((issue) => issue.code))).toEqual(new Set(["record_payload_invalid"]));
});

test("records.kinds-have-group-prefix", () => {
  const pattern = new RegExp(RECORD_KIND_PATTERN);
  expect(HELM_RECORD_KINDS.map((kind) => kind.kind)).toEqual([
    "grp.helm.signal.detected",
    "grp.helm.discovery.recorded",
    "grp.helm.inquiry.finished",
  ]);
  for (const decl of HELM_RECORD_KINDS) {
    expect(decl.kind.startsWith("grp.helm.")).toBe(true);
    expect(pattern.test(decl.kind)).toBe(true);
  }
});

test("records.discovery-worst-case-under-16kib", () => {
  const worst: DiscoveryRecordedPayload = {
    ...SAMPLE,
    claim: "가".repeat(1000),
    sources: Array.from({ length: 4 }, () => ({
      origin: "web" as const,
      ref: `https://example.test/${"나".repeat(512 - 21)}`,
      title: "다".repeat(80),
    })),
  };
  expect(parse(DiscoveryRecordedPayloadSchema, worst).ok).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(worst)).length).toBeLessThanOrEqual(16 * 1024);
});

test("an inquiry.finished payload rejects an unknown outcome", () => {
  const ok = {
    inquiryId: "habcdefghijklm",
    outcome: "applied",
    topic: "t",
    rounds: 1,
    lensCount: 3,
    failedLenses: 0,
    findingCount: 2,
    appliedTurnId: "trn_1",
  };
  expect(parse(InquiryFinishedPayloadSchema, ok).ok).toBe(true);
  expect(parse(InquiryFinishedPayloadSchema, { ...ok, outcome: "done" }).ok).toBe(false);
});

/** 중복 제거 시험 입력. outcome으로 어느 기록이 남았는지 값으로 본다 */
interface FinishedRow {
  readonly inquiryId: string | null;
  readonly outcome: string;
}

const FIRST_A: FinishedRow = { inquiryId: "habcdefghijklm", outcome: "applied" };
const SECOND_A: FinishedRow = { inquiryId: "habcdefghijklm", outcome: "failed" };
const B: FinishedRow = { inquiryId: "hbbbbbbbbbbbb", outcome: "stopped" };
const C: FinishedRow = { inquiryId: "hcccccccccccc", outcome: "empty" };
const NULL_FIRST: FinishedRow = { inquiryId: null, outcome: "limit" };
const NULL_SECOND: FinishedRow = { inquiryId: null, outcome: "failed" };

const DEDUPE_TABLE: readonly {
  readonly name: string;
  readonly input: readonly FinishedRow[];
  readonly kept: readonly string[];
}[] = [
  { name: "empty", input: [], kept: [] },
  {
    name: "no-duplicates-keeps-order",
    input: [B, FIRST_A, C],
    kept: ["stopped", "applied", "empty"],
  },
  {
    name: "second-finish-of-one-inquiry-is-dropped",
    input: [FIRST_A, SECOND_A],
    kept: ["applied"],
  },
  {
    name: "first-per-inquiry-wins-in-order",
    input: [B, FIRST_A, C, SECOND_A],
    kept: ["stopped", "applied", "empty"],
  },
  {
    name: "null-inquiry-ids-are-all-kept",
    input: [NULL_FIRST, FIRST_A, NULL_SECOND, SECOND_A],
    kept: ["limit", "applied", "failed"],
  },
];

for (const row of DEDUPE_TABLE) {
  test(`records.dedupe-inquiry-finished.${row.name}`, () => {
    const kept = dedupeInquiryFinished(row.input);
    expect(kept.map((entry) => entry.outcome)).toEqual([...row.kept]);
  });
}

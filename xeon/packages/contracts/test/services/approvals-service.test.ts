import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ApprovalAnswerSchema,
  ApprovalRequestedPayloadSchema,
  DenyAnswerSchema,
  PlanAnswerSchema,
  QuestionAnswerSchema,
  type DenyAnswerJson,
  type PlanAnswerJson,
  type QuestionAnswerJson,
} from "../../src/records/index.ts";
import {
  ApprovalRespondParamsSchema,
  type ApprovalRespondParams,
} from "../../src/wire-settings/wire/index.ts";
import type {
  ApprovalRequestError,
  ApprovalRequestInput,
  ApprovalResolution,
  ApprovalResponse,
  ApprovalService,
  ApprovalWaitFailure,
  DenyAnswer,
  OpenedApproval,
  PlanAnswer,
  QuestionAnswer,
  QuestionItem,
  QuestionOption,
} from "../../src/services/index.ts";
import type { Result } from "../../src/index.ts";
import type { Assignable, DeepMutable, Equal, Expect } from "../types/expect.ts";
import { rawId } from "../helpers/ids.ts";

// L1.tools.spec §8.3 F 요청 11: 비차단 open·wait·get이 ApprovalService에 있다.
export type OpenIsNonBlocking = Expect<
  Equal<
    ApprovalService["open"],
    (input: ApprovalRequestInput) => Promise<Result<OpenedApproval, ApprovalRequestError>>
  >
>;
export type WaitFailsWithAValue = Expect<
  Equal<
    ApprovalService["wait"],
    (
      approvalId: string,
      signal: AbortSignal,
    ) => Promise<Result<ApprovalResolution, ApprovalWaitFailure>>
  >
>;
export type GetIsSynchronous = Expect<
  Equal<ApprovalService["get"], (approvalId: string) => OpenedApproval | undefined>
>;

// 정본 answer 모양: records 스키마가 만드는 JSON 타입과 서비스 타입이 서로 대입된다.
export type SchemaAnswerFitsTheServiceType = Expect<Assignable<QuestionAnswerJson, QuestionAnswer>>;
export type ServiceAnswerFitsTheSchema = Expect<
  Assignable<DeepMutable<QuestionAnswer>, QuestionAnswerJson>
>;
export type PlanAnswerFitsTheSchema = Expect<Assignable<PlanAnswer, PlanAnswerJson>>;
export type DenyAnswerFitsTheSchema = Expect<Assignable<DenyAnswer, DenyAnswerJson>>;

const THREAD = rawId("thr", 1);
const SOME_APPROVAL = rawId("evt", 1);

describe("approval.respond answer shapes", () => {
  test("question answers are keyed by question id with selected ids and optional text", () => {
    const answer = { q1: { selected: ["a"] }, q2: { selected: [], text: "free" } };
    expect(parse(QuestionAnswerSchema, answer).ok).toBe(true);
    expect(parse(ApprovalAnswerSchema, answer).ok).toBe(true);
  });

  test("the AskAnswer array shape is not the wire shape", () => {
    const askAnswer = { answers: [{ questionId: "q1", selected: ["a"] }] };
    expect(parse(ApprovalAnswerSchema, askAnswer).ok).toBe(false);
    expect(parse(QuestionAnswerSchema, askAnswer).ok).toBe(false);
  });

  test("a bare string per question (the old desktop shape) is rejected", () => {
    expect(parse(ApprovalAnswerSchema, { q1: "yes" }).ok).toBe(false);
  });

  test("plan and deny answers", () => {
    expect(parse(PlanAnswerSchema, { mode: "acceptEdits" }).ok).toBe(true);
    expect(parse(PlanAnswerSchema, { mode: "default", note: "go ahead" }).ok).toBe(true);
    expect(parse(PlanAnswerSchema, { note: "only a note" }).ok).toBe(true);
    expect(parse(PlanAnswerSchema, { mode: "default", extra: 1 }).ok).toBe(false);
    expect(parse(ApprovalAnswerSchema, { mode: "default" }).ok).toBe(true);
    expect(parse(DenyAnswerSchema, { feedback: "not this file" }).ok).toBe(true);
    expect(parse(DenyAnswerSchema, { feedback: "" }).ok).toBe(false);
    expect(parse(ApprovalAnswerSchema, { feedback: "no" }).ok).toBe(true);
  });

  test("a question answer holds at most four questions", () => {
    const five = Object.fromEntries(
      ["a", "b", "c", "d", "e"].map((id) => [id, { selected: ["x"] }]),
    );
    expect(parse(QuestionAnswerSchema, five).ok).toBe(false);
  });

  test("the wire params carry the typed answer", () => {
    const params: ApprovalRespondParams = {
      approvalId: SOME_APPROVAL,
      decision: "answer",
      answer: { q1: { selected: ["a"], text: "why" } },
    };
    expect(parse(ApprovalRespondParamsSchema, params).ok).toBe(true);
    expect(
      parse(ApprovalRespondParamsSchema, { approvalId: SOME_APPROVAL, decision: "allow" }).ok,
    ).toBe(true);
    expect(
      parse(ApprovalRespondParamsSchema, {
        approvalId: SOME_APPROVAL,
        decision: "answer",
        answer: "free text",
      }).ok,
    ).toBe(false);
  });

  test("ApprovalResponse.answer accepts the canonical shapes as JSON", () => {
    const question: ApprovalResponse = { decision: "answer", answer: { q1: { selected: ["a"] } } };
    const plan: ApprovalResponse = { decision: "allow", answer: { mode: "default" } };
    const deny: ApprovalResponse = { decision: "deny", answer: { feedback: "no" } };
    expect([question, plan, deny]).toHaveLength(3);
  });
});

describe("question header and recommended option", () => {
  const base = {
    origin: {
      threadId: THREAD,
      turnId: null,
      stepId: null,
      toolCallId: null,
      caller: "main",
    },
    requestKey: "k1",
    title: "Pick one",
    remember: ["once"],
    surfaceThreadId: THREAD,
    requestedAt: 1,
  };
  function payload(question: object): unknown {
    return { ...base, body: { kind: "question", question: { questions: [question] } } };
  }

  test("header and recommended are optional extras of the request payload", () => {
    const plain = {
      id: "q1",
      text: "Which?",
      options: [],
      multiSelect: false,
      allowFreeText: true,
    };
    expect(parse(ApprovalRequestedPayloadSchema, payload(plain)).ok).toBe(true);
    const rich = {
      ...plain,
      header: "Scope",
      options: [
        { id: "a", label: "A", recommended: true },
        { id: "b", label: "B", description: "other" },
      ],
      allowFreeText: false,
    };
    expect(parse(ApprovalRequestedPayloadSchema, payload(rich)).ok).toBe(true);
    expect(parse(ApprovalRequestedPayloadSchema, payload({ ...plain, header: "" })).ok).toBe(false);
  });

  test("the service types carry the same extras", () => {
    const option: QuestionOption = { id: "a", label: "A", recommended: true };
    const item: QuestionItem = {
      id: "q1",
      header: "Scope",
      text: "Which?",
      options: [option],
      multiSelect: false,
      allowFreeText: false,
    };
    expect(item.options[0]?.recommended).toBe(true);
  });
});

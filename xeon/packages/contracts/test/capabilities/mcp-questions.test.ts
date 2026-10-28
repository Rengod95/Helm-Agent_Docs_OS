import { describe, expect, test } from "bun:test";
import {
  buildMcpInputResponses,
  decodeMcpAnswer,
  McpInputRequiredSchema,
  planMcpQuestionBody,
  uniformMcpAnswer,
  type CallContinuation,
  type CallOptions,
  type McpContinuation,
  type McpQuestion,
  type McpQuestionAnswer,
  type McpQuestionBody,
} from "../../src/capabilities/index.ts";
import { parse } from "../../src/index.ts";
import type { QuestionAnswer, QuestionBody } from "../../src/services/index.ts";
import type { Assignable, Expect } from "../types/expect.ts";

// L1.tools.spec §8.3 F 요청 12 (결정 D5 (a)): CallOptions.continuation과 McpQuestion → QuestionBody 규칙.

// 구조가 같아 services 타입으로 그대로 대입된다(capabilities는 services를 import할 수 없어 모양을 따로 적었다)
export type PlannedBodyIsAQuestionBody = Expect<Assignable<McpQuestionBody, QuestionBody>>;
export type QuestionBodyIsAPlannedBody = Expect<Assignable<QuestionBody, McpQuestionBody>>;
export type AnswerMatchesTheService = Expect<Assignable<QuestionAnswer, McpQuestionAnswer>>;
export type ServiceMatchesTheAnswer = Expect<Assignable<McpQuestionAnswer, QuestionAnswer>>;
// 연속 정보는 능력 입력(McpContinuation)과 호출 옵션(CallContinuation)에서 같은 모양이다
export type ContinuationFitsTheInput = Expect<Assignable<CallContinuation, McpContinuation>>;
export type InputFitsTheContinuation = Expect<Assignable<McpContinuation, CallContinuation>>;
export type OptionsCarryTheContinuation = Expect<
  Assignable<{ continuation: CallContinuation }, CallOptions>
>;

const FORM: McpQuestion = {
  key: "k1",
  kind: "elicitation_form",
  server: "files",
  message: "Which folder?",
  requestedSchema: {
    type: "object",
    properties: {
      folder: { type: "string", title: "Folder", enum: ["docs", "src"] },
      recursive: { type: "boolean" },
    },
    required: ["folder"],
  },
};
const URL_STEP: McpQuestion = {
  key: "k2",
  kind: "elicitation_url",
  server: "files",
  message: "Sign in",
  url: "https://example.com/auth",
};

describe("planMcpQuestionBody", () => {
  test("a form with two fields becomes one question per field", () => {
    const planned = planMcpQuestionBody([FORM]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const items = planned.value.body.questions;
    expect(items.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(items[0]?.options.map((o) => o.id)).toEqual(["docs", "src"]);
    expect(items[0]?.allowFreeText).toBe(false);
    expect(items[1]?.options.map((o) => o.id)).toEqual(["yes", "no"]);
  });

  test("more than four items collapse forms into one JSON field each", () => {
    const wide: McpQuestion = {
      ...FORM,
      requestedSchema: {
        type: "object",
        properties: Object.fromEntries(
          ["a", "b", "c", "d", "e"].map((name) => [name, { type: "string" }]),
        ),
      },
    };
    const planned = planMcpQuestionBody([wide]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.body.questions).toHaveLength(1);
    expect(planned.value.body.questions[0]?.allowFreeText).toBe(true);
  });

  test("too many questions is an error value", () => {
    const many: McpQuestion[] = ["a", "b", "c", "d", "e"].map((key) => ({
      key,
      kind: "elicitation_url",
      server: "files",
      message: "Sign in",
      url: `https://example.com/${key}`,
    }));
    const planned = planMcpQuestionBody(many);
    expect(planned).toEqual({ ok: false, error: { kind: "too_many_questions", count: 5 } });
  });
});

describe("decodeMcpAnswer", () => {
  test("a QuestionAnswer becomes inputResponses keyed by the server's request key", () => {
    const planned = planMcpQuestionBody([FORM, URL_STEP]);
    if (!planned.ok) throw new Error("plan failed");
    const answer: McpQuestionAnswer = {
      q1: { selected: ["docs"] },
      q2: { selected: ["yes"] },
      q3: { selected: ["yes"] },
    };
    const decoded = decodeMcpAnswer(planned.value, answer);
    expect(decoded).toEqual({
      ok: true,
      value: {
        k1: { action: "accept", content: { folder: "docs", recursive: true } },
        k2: { action: "accept" },
      },
    });
  });

  test("a value outside the form's enum is an error, not a silent accept", () => {
    const planned = planMcpQuestionBody([FORM]);
    if (!planned.ok) throw new Error("plan failed");
    const decoded = decodeMcpAnswer(planned.value, { q1: { selected: [], text: "tmp" } });
    expect(decoded.ok).toBe(false);
  });

  test("a denied or cancelled approval answers every question the same way", () => {
    const decline = uniformMcpAnswer([FORM, URL_STEP], "decline");
    expect(decline).toEqual({
      ok: true,
      value: { k1: { action: "decline" }, k2: { action: "decline" } },
    });
    const cancel = uniformMcpAnswer([FORM], "cancel");
    expect(cancel).toEqual({ ok: true, value: { k1: { action: "cancel" } } });
  });

  test("sampling questions get no response key", () => {
    const sampling: McpQuestion = { key: "s", kind: "sampling", server: "files", summary: "x" };
    expect(uniformMcpAnswer([sampling], "decline")).toEqual({ ok: true, value: {} });
  });
});

describe("buildMcpInputResponses", () => {
  test("rejects keys the server never asked", () => {
    const built = buildMcpInputResponses([URL_STEP], [{ key: "other", action: "cancel" }]);
    expect(built).toEqual({ ok: false, error: { kind: "unknown_key", key: "other" } });
  });
});

describe("McpInputRequiredSchema", () => {
  test("recognises the variant without an approvalId", () => {
    const variant = {
      status: "input_required",
      round: 1,
      inputRequests: { k2: { method: "elicitation/create" } },
      requestState: null,
      questions: [URL_STEP],
    };
    expect(parse(McpInputRequiredSchema, variant).ok).toBe(true);
    expect(parse(McpInputRequiredSchema, { status: "complete", contents: [] }).ok).toBe(false);
  });
});

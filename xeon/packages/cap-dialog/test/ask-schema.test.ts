import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  AskAnswerSchema,
  AskParams,
  buildAskAnswerSchema,
  checkAskQuestions,
  validateAskAnswer,
  type AskAnswer,
  type AskAnswerIssue,
  type AskQuestion,
} from "@xeon/contracts/capabilities";
import { Value } from "typebox/value";
import { fromQuestionAnswer, toQuestionAnswer, toQuestionBody } from "../src/ask/mapping.ts";

const SCOPE: AskQuestion = {
  id: "scope",
  question: "범위는?",
  options: [
    { id: "small", label: "작게", recommended: true },
    { id: "large", label: "크게" },
  ],
};
const NAME: AskQuestion = { id: "name", question: "이름은?" };

function issuesOf(questions: readonly AskQuestion[], answer: AskAnswer): AskAnswerIssue["code"][] {
  return validateAskAnswer(questions, answer).map((issue) => issue.code);
}

function question(id: string, count: number): AskQuestion {
  return {
    id,
    question: "?",
    options: Array.from({ length: count }, (_, index) => ({ id: `o${index}`, label: "o" })),
  };
}

describe("질문 스키마 검증", () => {
  test("질문 0개·5개, 선택지 1개·9개는 스키마가 거부한다", () => {
    expect(parse(AskParams, { questions: [] }).ok).toBe(false);
    expect(
      parse(AskParams, {
        questions: ["a", "b", "c", "d", "e"].map((id) => ({ id, question: "?" })),
      }).ok,
    ).toBe(false);
    expect(parse(AskParams, { questions: [question("q", 1)] }).ok).toBe(false);
    expect(parse(AskParams, { questions: [question("q", 9)] }).ok).toBe(false);
    expect(parse(AskParams, { questions: [question("q", 2)] }).ok).toBe(true);
    expect(parse(AskParams, { questions: [question("q", 8)] }).ok).toBe(true);
  });

  test("같은 질문 id, 추천 둘 이상, 선택지 id 중복은 checkAskQuestions 이슈다", () => {
    expect(checkAskQuestions([SCOPE, NAME])).toEqual([]);
    expect(checkAskQuestions([SCOPE, { ...SCOPE }])).toHaveLength(1);
    const twoRecommended: AskQuestion = {
      id: "q",
      question: "?",
      options: [
        { id: "a", label: "a", recommended: true },
        { id: "b", label: "b", recommended: true },
      ],
    };
    expect(checkAskQuestions([twoRecommended])).toHaveLength(1);
    const duplicateOption: AskQuestion = {
      id: "q",
      question: "?",
      options: [
        { id: "a", label: "a" },
        { id: "a", label: "b" },
      ],
    };
    expect(checkAskQuestions([duplicateOption])).toHaveLength(1);
  });
});

describe("답 검증", () => {
  test("validateAskAnswer의 이슈 6종이 각각 나오고 통과 사례가 있다", () => {
    const ok: AskAnswer = {
      answers: [
        { questionId: "scope", selected: ["small"], text: null },
        { questionId: "name", selected: [], text: "xeon" },
      ],
    };
    expect(issuesOf([SCOPE, NAME], ok)).toEqual([]);
    expect(
      issuesOf([SCOPE], { answers: [{ questionId: "other", selected: [], text: "x" }] }),
    ).toContain("unknown_question");
    const [scopeAnswer] = ok.answers;
    if (scopeAnswer === undefined) throw new Error("missing fixture");
    expect(issuesOf([SCOPE, NAME], { answers: [scopeAnswer] })).toEqual(["missing_answer"]);
    expect(
      issuesOf([SCOPE], { answers: [{ questionId: "scope", selected: ["huge"], text: null }] }),
    ).toEqual(["unknown_option"]);
    expect(
      issuesOf([SCOPE], {
        answers: [{ questionId: "scope", selected: ["small", "large"], text: null }],
      }),
    ).toEqual(["too_many_selected"]);
    const strict: AskQuestion = { ...SCOPE, allowFreeText: false };
    expect(
      issuesOf([strict], { answers: [{ questionId: "scope", selected: ["small"], text: "더" }] }),
    ).toEqual(["free_text_not_allowed"]);
    expect(
      issuesOf([SCOPE], { answers: [{ questionId: "scope", selected: [], text: null }] }),
    ).toEqual(["empty_answer"]);
  });

  test("buildAskAnswerSchema 결과로 검사한 결과가 구조 규칙과 같다", () => {
    const schema = buildAskAnswerSchema([SCOPE, NAME]);
    const good = {
      answers: [
        { questionId: "scope", selected: ["small"], text: null },
        { questionId: "name", selected: [], text: "xeon" },
      ],
    };
    expect(Value.Check(schema, good)).toBe(true);
    expect(
      Value.Check(schema, {
        answers: [
          { questionId: "scope", selected: ["huge"], text: null },
          { questionId: "name", selected: [], text: "xeon" },
        ],
      }),
    ).toBe(false);
    expect(parse(AskAnswerSchema, good).ok).toBe(true);
  });
});

describe("L1.tools 승인 레코드와의 변환", () => {
  test("질문 묶음은 QuestionBody 모양이다", () => {
    expect(toQuestionBody([SCOPE, NAME])).toEqual({
      questions: [
        {
          id: "scope",
          text: "범위는?",
          options: [
            { id: "small", label: "작게" },
            { id: "large", label: "크게" },
          ],
          multiSelect: false,
          allowFreeText: true,
        },
        { id: "name", text: "이름은?", options: [], multiSelect: false, allowFreeText: true },
      ],
    });
  });

  test("선택지가 없는 질문은 allowFreeText를 막아도 참으로 올린다", () => {
    const body = toQuestionBody([{ id: "q", question: "?", allowFreeText: false }]);
    expect(body).toMatchObject({ questions: [{ allowFreeText: true }] });
  });

  test("QuestionAnswer와 AskAnswer가 서로 옮겨진다", () => {
    const answer: AskAnswer = {
      answers: [
        { questionId: "scope", selected: ["small"], text: null },
        { questionId: "name", selected: [], text: "xeon" },
      ],
    };
    const record = toQuestionAnswer(answer);
    expect(record).toEqual({
      scope: { selected: ["small"] },
      name: { selected: [], text: "xeon" },
    });
    expect(fromQuestionAnswer(record, [SCOPE, NAME])).toEqual(answer);
  });

  test("모양이 틀린 답은 undefined다", () => {
    expect(fromQuestionAnswer(null, [SCOPE])).toBeUndefined();
    expect(fromQuestionAnswer([], [SCOPE])).toBeUndefined();
    expect(fromQuestionAnswer({ scope: "small" }, [SCOPE])).toBeUndefined();
    expect(fromQuestionAnswer({ scope: { selected: "small" } }, [SCOPE])).toBeUndefined();
    expect(fromQuestionAnswer({ scope: { selected: [], text: 3 } }, [SCOPE])).toBeUndefined();
    expect(fromQuestionAnswer({}, [SCOPE])).toBeUndefined();
  });
});

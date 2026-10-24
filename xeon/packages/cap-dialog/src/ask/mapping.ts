import type { AskAnswer, AskAnswerItem, AskQuestion } from "@xeon/contracts/capabilities";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import { isJsonObject } from "../util.ts";

// 질문 도메인 모양(AskQuestion, AskAnswer)과 L1.tools 승인 레코드 모양(QuestionBody, QuestionAnswer)을 서로 옮긴다.
// 레코드 모양이 정본이다(L1.tools.spec §3.6, wire `approval.respond`의 answer): L1.tools가 응답을 QuestionBody에 비춰 검사하므로
// 승인 요청의 대상은 QuestionBody여야 한다. `header`와 `recommended`도 레코드가 싣는다(F.8). `AskAnswer`는 wire를 지나지 않는다:
// 클라이언트는 QuestionBody를 그려 `QuestionAnswer`로 답하고 이 파일이 `AskAnswer`로 옮긴다.

function objectOf(value: JsonValue | null | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function optionBody(option: NonNullable<AskQuestion["options"]>[number]): JsonObject {
  return {
    id: option.id,
    label: option.label,
    ...(option.description === undefined ? {} : { description: option.description }),
    ...(option.recommended === undefined ? {} : { recommended: option.recommended }),
  };
}

/** 질문 묶음을 `approval.requested`의 `question` body로 옮긴다 */
export function toQuestionBody(questions: readonly AskQuestion[]): JsonObject {
  return {
    questions: questions.map((question): JsonObject => {
      const options = question.options ?? [];
      return {
        id: question.id,
        ...(question.header === undefined ? {} : { header: question.header }),
        text: question.question,
        options: options.map(optionBody),
        multiSelect: question.multiSelect ?? false,
        // 선택지가 없는 질문은 자유 입력이 유일한 답이다. L1.tools는 그 질문의 allowFreeText가 참이어야 받는다
        allowFreeText: options.length === 0 ? true : (question.allowFreeText ?? true),
      };
    }),
  };
}

function selectedOf(entry: JsonObject): string[] | undefined {
  const selected = entry["selected"];
  if (!Array.isArray(selected)) return undefined;
  const ids: string[] = [];
  for (const id of selected) {
    if (typeof id !== "string") return undefined;
    ids.push(id);
  }
  return ids;
}

/**
 * 승인 해결의 `answer`(`QuestionAnswer`: 질문 id → `{ selected, text? }`)를 `AskAnswer`로 옮긴다.
 * 모양이 틀리면 undefined다. 질문이 빠졌는지, 선택지가 맞는지는 `validateAskAnswer`가 본다.
 */
export function fromQuestionAnswer(
  raw: JsonValue | null,
  questions: readonly AskQuestion[],
): AskAnswer | undefined {
  const record = objectOf(raw);
  if (record === undefined) return undefined;
  const answers: AskAnswerItem[] = [];
  for (const question of questions) {
    const given = record[question.id];
    if (given === undefined) continue;
    const entry = objectOf(given);
    if (entry === undefined) return undefined;
    const selected = selectedOf(entry);
    const text = entry["text"];
    if (selected === undefined) return undefined;
    if (text !== undefined && typeof text !== "string") return undefined;
    answers.push({
      questionId: question.id,
      selected,
      text: text === undefined || text === "" ? null : text,
    });
  }
  if (answers.length === 0) return undefined;
  return { answers };
}

/** `AskAnswer`를 승인 응답의 `answer`(`QuestionAnswer`)로 옮긴다. 시간 제한의 추천 답에 쓴다 */
export function toQuestionAnswer(answer: AskAnswer): JsonObject {
  const entries: JsonObject = {};
  for (const item of answer.answers) {
    entries[item.questionId] = {
      selected: item.selected,
      ...(item.text === null ? {} : { text: item.text }),
    };
  }
  return entries;
}

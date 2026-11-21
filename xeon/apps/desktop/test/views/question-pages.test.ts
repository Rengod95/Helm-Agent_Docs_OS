import { describe, expect, test } from "bun:test";
import {
  questionAutoAdvanceOf,
  questionPageKeyOf,
  questionPageOf,
  questionPagedOf,
  questionPrimaryOf,
  questionStepsOf,
} from "../../src/views/approval-card/question-pages.ts";
import {
  answerOf,
  questionAnsweredOf,
  setPickText,
  togglePick,
  type QuestionDraft,
  type QuestionItem,
} from "../../src/views/approval-form.ts";

const purpose: QuestionItem = {
  id: "purpose",
  header: "용도",
  text: "무엇을 하려는 건가요?",
  options: [
    { id: "test", label: "E2E 시험" },
    { id: "scrape", label: "웹 데이터 수집" },
  ],
  multiSelect: false,
  allowFreeText: true,
};
const where: QuestionItem = {
  id: "where",
  header: "사용 위치",
  text: "어디에서 쓸 건가요?",
  options: [
    { id: "repo", label: "이 저장소 안" },
    { id: "ci", label: "CI 서버" },
  ],
  multiSelect: false,
  allowFreeText: false,
};
const browsers: QuestionItem = {
  id: "browsers",
  text: "어떤 브라우저로 돌릴까요?",
  options: [
    { id: "chromium", label: "Chromium" },
    { id: "firefox", label: "Firefox" },
  ],
  multiSelect: true,
  allowFreeText: false,
};
const three = [purpose, where, browsers];

const key = (
  name: string,
  mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({ key: name, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("question paging", () => {
  test("only two or more questions are paged", () => {
    expect([0, 1, 2, 3].map(questionPagedOf)).toEqual([false, false, true, true]);
  });

  test("the page is kept inside the questions", () => {
    expect([-1, 0, 1, 2, 3, 9, 1.7].map((page) => questionPageOf(page, 3))).toEqual([
      0, 0, 1, 2, 2, 2, 1,
    ]);
    expect(questionPageOf(4, 0)).toBe(0);
  });

  test("steps follow the question order and mark the current page", () => {
    const steps = questionStepsOf(three, {}, 1);
    expect(steps).toEqual([
      { index: 0, id: "purpose", header: "용도", answered: false, current: false },
      { index: 1, id: "where", header: "사용 위치", answered: false, current: true },
      { index: 2, id: "browsers", header: null, answered: false, current: false },
    ]);
  });

  test("answers stay in the draft while paging back and forth", () => {
    let draft: QuestionDraft = togglePick({}, purpose, "scrape");
    draft = togglePick(draft, where, "ci");
    // 쪽을 옮겨도 초안은 카드가 들고 있어 같은 값이다. 어느 쪽에서 봐도 답한 질문은 같다
    const answered = [0, 1, 2, 1, 0].map((page) =>
      questionStepsOf(three, draft, page).map((step) => step.answered),
    );
    for (const row of answered) expect(row).toEqual([true, true, false]);
    expect(questionStepsOf(three, draft, 0).map((step) => step.current)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("a step counts as answered by the same rule as the answer button", () => {
    expect(questionAnsweredOf(purpose, setPickText({}, "purpose", "   "))).toBe(false);
    expect(questionAnsweredOf(purpose, setPickText({}, "purpose", "직접 쓴 답"))).toBe(true);
    // 직접 입력을 받지 않는 질문은 글만 있으면 답이 아니다
    expect(questionAnsweredOf(where, setPickText({}, "where", "글"))).toBe(false);
    expect(questionAnsweredOf(browsers, togglePick({}, browsers, "firefox"))).toBe(true);
  });

  test("the primary button is next until the last question, then answer", () => {
    expect([0, 1, 2].map((page) => questionPrimaryOf(page, 3))).toEqual(["next", "next", "answer"]);
    expect(questionPrimaryOf(0, 1)).toBe("answer");
  });

  test("the answer is sent only when every page is answered", () => {
    let draft: QuestionDraft = togglePick({}, purpose, "test");
    draft = togglePick(draft, where, "repo");
    // 마지막 쪽에 와도 앞의 답이 다 있고 마지막 질문에 답해야 보낼 수 있다
    expect(questionPrimaryOf(2, 3)).toBe("answer");
    expect(answerOf(three, draft)).toBeNull();
    draft = togglePick(draft, browsers, "chromium");
    expect(answerOf(three, draft)).toEqual({
      purpose: { selected: ["test"] },
      where: { selected: ["repo"] },
      browsers: { selected: ["chromium"] },
    });
  });
});

const at = (question: QuestionItem, page: number, picked = true) =>
  questionAutoAdvanceOf({ question, picked, page, count: 3 });

describe("auto advance", () => {
  test("a single-choice question without free text moves on after a pick", () => {
    expect(at(where, 1)).toBe(true);
  });

  test("it does not move on for a cleared pick or on the last question", () => {
    expect(at(where, 1, false)).toBe(false);
    expect(at(where, 2)).toBe(false);
  });

  test("questions that take more input stay", () => {
    expect(at(purpose, 0)).toBe(false);
    expect(at(browsers, 1)).toBe(false);
    expect(at({ ...where, options: [] }, 1)).toBe(false);
  });
});

describe("page keys", () => {
  test("bare left and right arrows page back and forward", () => {
    expect([key("ArrowLeft"), key("ArrowRight")].map(questionPageKeyOf)).toEqual([-1, 1]);
  });

  test("other keys and arrows with a modifier do not page", () => {
    const keys = [
      key("ArrowUp"),
      key("ArrowDown"),
      key("Enter"),
      key("ArrowLeft", { shiftKey: true }),
      key("ArrowRight", { metaKey: true }),
      key("ArrowRight", { ctrlKey: true }),
      key("ArrowLeft", { altKey: true }),
    ];
    expect(keys.map(questionPageKeyOf)).toEqual([null, null, null, null, null, null, null]);
  });
});

import { questionAnsweredOf, type QuestionDraft, type QuestionItem } from "../approval-form.ts";

// 질문 카드의 넘김(DP-224 [결정: 2026-11-20 사용자, AGE-65]). 질문이 둘 이상이면 한 번에 하나만 보이고 넘긴다.
// 답(초안 `QuestionDraft`)은 카드가 들고 있어 넘겨도 남는다. "답하기"가 켜지는 규칙은 그대로다(`answerOf`: 모든 질문에 답이 있어야 한다).
// React 밖의 순수 값이라 question-pages.test.ts가 시험한다.

/** 넘김 표시의 한 칸: 몇 번째 질문인지, 답했는지, 지금 보이는지 */
export type QuestionStep = {
  readonly index: number;
  readonly id: string;
  /** 질문의 짧은 머리(`header`). 없으면 null */
  readonly header: string | null;
  readonly answered: boolean;
  readonly current: boolean;
};

/** 넘김을 쓰는가: 질문이 둘 이상일 때다. 하나면 지금처럼 넘김 없이 그린다 */
export function questionPagedOf(count: number): boolean {
  return count > 1;
}

/** 쪽 번호를 질문 범위 안으로 맞춘다(질문 수가 0이면 0) */
export function questionPageOf(page: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), count - 1);
}

/** 넘김 표시의 칸들. 답한 질문과 아직 답하지 않은 질문을 가른다 */
export function questionStepsOf(
  questions: readonly QuestionItem[],
  draft: QuestionDraft,
  page: number,
): readonly QuestionStep[] {
  const current = questionPageOf(page, questions.length);
  return questions.map((question, index) => ({
    index,
    id: question.id,
    header: question.header ?? null,
    answered: questionAnsweredOf(question, draft),
    current: index === current,
  }));
}

/** 주 단추의 뜻: 마지막 질문 전에는 "다음", 마지막(또는 질문 하나)에서는 "답하기"다 */
export type QuestionPrimary = "next" | "answer";

export function questionPrimaryOf(page: number, count: number): QuestionPrimary {
  return questionPageOf(page, count) < count - 1 ? "next" : "answer";
}

/**
 * 선택지를 눌러 고른 뒤 다음 질문으로 저절로 넘길지. 하나만 고르는 질문이고 직접 입력이 없으며, 이번 누름이 선택을 만들었고
 * (해제가 아니고), 마지막 질문이 아닐 때만이다. 여러 개 고르는 질문과 직접 입력이 있는 질문은 더 고르거나 쓸 수 있어 넘기지 않는다.
 * 화살표 키로 옮겨 고른 것(라디오의 기본 동작)도 넘기지 않는다: 부르는 쪽이 포인터 누름에서만 부른다
 */
export function questionAutoAdvanceOf(input: {
  readonly question: QuestionItem;
  readonly picked: boolean;
  readonly page: number;
  readonly count: number;
}): boolean {
  const { question } = input;
  return (
    !question.multiSelect &&
    !question.allowFreeText &&
    question.options.length > 0 &&
    input.picked &&
    questionPrimaryOf(input.page, input.count) === "next"
  );
}

type KeyLike = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
};

/** 넘김 글쇠: 수식 키 없는 ←는 이전, →는 다음. 그 밖은 null(입력 칸 안의 글쇠는 부르는 쪽이 거른다) */
export function questionPageKeyOf(event: KeyLike): -1 | 1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return null;
}

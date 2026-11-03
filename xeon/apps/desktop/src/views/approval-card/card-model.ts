import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";

// 승인 카드가 그리는 순수 값(시간 표시, 만료, 키 해석, 계획 접기, 검토 합계). React 밖에서 시험한다(approval-card-model.test.ts).
// 도구 인자·질문 답 조립은 ../approval-form.ts가 맡는다.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 계획 본문을 카드에 먼저 보이는 줄 수. 넘는 줄은 "전체 보기"로 접는다 */
export const PLAN_FOLD_LINES = 12;

/** 피드백 입력의 상한(계약 DenyAnswer·PlanAnswer.note의 최대 길이와 같다) */
export const FEEDBACK_MAX = 8192;

/** 요청 뒤 지난 시간. 1분 안은 "지금", 그 밖은 단위별로 내린 수 */
export type ApprovalAge =
  | { readonly unit: "now" }
  | { readonly unit: "minutes" | "hours" | "days"; readonly count: number };

export function approvalAgeOf(now: number, requestedAt: number): ApprovalAge {
  const elapsed = Math.max(0, now - requestedAt);
  if (elapsed < MINUTE_MS) return { unit: "now" };
  if (elapsed < HOUR_MS) return { unit: "minutes", count: Math.floor(elapsed / MINUTE_MS) };
  if (elapsed < DAY_MS) return { unit: "hours", count: Math.floor(elapsed / HOUR_MS) };
  return { unit: "days", count: Math.floor(elapsed / DAY_MS) };
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 로컬 시각 HH:MM. 만료 줄에 쓴다 */
export function clockTextOf(at: number): string {
  const when = new Date(at);
  return `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
}

/** 만료 시각과 만료 때 해결(거부 또는 정한 답). `expiresAt`이 없으면 만료가 없다 */
type ApprovalExpiry = { readonly at: number; readonly decision: "deny" | "answer" };

export function approvalExpiryOf(request: ApprovalRequestedPayload): ApprovalExpiry | null {
  if (request.expiresAt === undefined) return null;
  return {
    at: request.expiresAt,
    decision: request.onExpire?.decision === "answer" ? "answer" : "deny",
  };
}

/** 카드 안의 바로 가기 동작. Y는 기본 답, ⇧Y는 이 대화에서 항상, N은 거부 */
type ApprovalKeyAction = "primary" | "always" | "deny";

type ApprovalKeyLike = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
};

/** 수식 키(⌘ Ctrl Alt)가 함께 눌리면 바로 가기가 아니다(셸 단축키와 겹치지 않게 한다) */
export function approvalKeyOf(event: ApprovalKeyLike): ApprovalKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "y") return event.shiftKey ? "always" : "primary";
  if (key === "n" && !event.shiftKey) return "deny";
  return null;
}

/** 계획 본문을 앞 `max`줄과 나머지로 나눈다. 넘는 줄이 없으면 rest는 null */
export function foldPlanLines(
  text: string,
  max: number,
): { readonly head: string; readonly rest: string | null } {
  const lines = text.split("\n");
  if (lines.length <= max) return { head: text, rest: null };
  return { head: lines.slice(0, max).join("\n"), rest: lines.slice(max).join("\n") };
}

/** 검토 파일 목록의 합계. 파일 수와 hunk 수 */
export function reviewTotalsOf(files: readonly { readonly hunks: number }[]): {
  readonly files: number;
  readonly hunks: number;
} {
  return {
    files: files.length,
    hunks: files.reduce((sum, file) => sum + file.hunks, 0),
  };
}

/** 이 요청이 고를 수 있는 "이 대화에서 항상" 기억 범위. 없으면 null이다 */
export function alwaysRememberOf(
  remember: ApprovalRequestedPayload["remember"],
): "thread" | "always" | null {
  if (remember.includes("thread")) return "thread";
  if (remember.includes("always")) return "always";
  return null;
}

/** 피드백 입력을 보낼 글로 바꾼다. 앞뒤 공백만 있으면 없는 것으로 보고 null이다 */
export function feedbackTextOf(input: string): string | null {
  const text = input.trim();
  return text === "" ? null : text.slice(0, FEEDBACK_MAX);
}

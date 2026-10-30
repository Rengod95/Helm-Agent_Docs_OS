import type { ItemId } from "@xeon/contracts/conversation";

// L4.cli.spec §3.5. 화면 라이브러리와 무관한 그리기 명령(RenderOp)과 보기 모양이다. 타입만 둔다.

export interface ToolCallView {
  readonly itemId: ItemId;
  readonly toolCallId: string;
  readonly toolName: string;
  /** 한 줄, 120자 이하 */
  readonly argsSummary: string;
}

export interface ToolResultView {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  /** 재개 때 복구 규칙이 만든 결과(F.records §4.5) */
  readonly synthesized: boolean;
  /** §4.5 표시 규칙으로 만든 줄 */
  readonly lines: readonly string[];
}

export type RememberChoice = "once" | "thread" | "always";

interface QuestionOptionView {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly recommended: boolean;
}

export interface QuestionView {
  readonly id: string;
  readonly header: string | null;
  readonly text: string;
  readonly options: readonly QuestionOptionView[];
  readonly multiSelect: boolean;
  readonly allowFreeText: boolean;
}

/** 검토 카드의 파일 한 줄. hunk id는 파일 순번과 이 파일 안 hunk 순번으로 정해진다(§4.11) */
export interface ReviewFileView {
  readonly path: string;
  readonly hunks: number;
}

/** 승인 프롬프트가 kind별로 필요로 하는 구조. 제목·본문(body)은 모든 kind가 같다 */
type ApprovalForm =
  | { readonly kind: "tool" }
  | { readonly kind: "plan"; readonly nextModes: readonly string[] }
  | { readonly kind: "review"; readonly files: readonly ReviewFileView[] }
  | { readonly kind: "question"; readonly questions: readonly QuestionView[] };

export interface ApprovalView {
  /** approval.requested 이벤트 id(F wire §4.6 [가정]) */
  readonly approvalId: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly allowsAnswer: boolean;
  /** 이 요청이 허용하는 기억 범위(요청 payload의 remember). 빈 목록이면 이번만이다 */
  readonly remember: readonly RememberChoice[];
  readonly form: ApprovalForm;
}

export type RenderOp =
  | { readonly kind: "user"; readonly itemId: ItemId; readonly text: string }
  | {
      readonly kind: "assistant";
      readonly itemId: ItemId;
      readonly markdown: string;
      readonly thinking: string | null;
    }
  | { readonly kind: "toolCall"; readonly view: ToolCallView }
  | { readonly kind: "toolResult"; readonly view: ToolResultView }
  | {
      readonly kind: "custom";
      readonly itemId: ItemId;
      readonly customType: string;
      readonly text: string;
    }
  /** 휘발. text는 그 item의 지금까지 누적 텍스트다. 화면은 마지막 줄만 덮어써도 된다 */
  | { readonly kind: "progress"; readonly itemId: ItemId; readonly text: string }
  | { readonly kind: "clearProgress"; readonly itemId: ItemId }
  | { readonly kind: "approval"; readonly view: ApprovalView }
  | {
      readonly kind: "approvalResolved";
      readonly approvalId: string;
      readonly decision: "allow" | "deny" | "answer";
      /** 실제로 적용한 기억 범위. 요청한 범위와 다르면 낮춰 적용한 것이다(L1.tools.spec §4.7) */
      readonly remember: RememberChoice;
      readonly requestedRemember: RememberChoice | null;
      readonly resolvedBy: "user" | "noninteractive" | "cancelled" | "superseded" | "expired";
    }
  | {
      readonly kind: "turnEnd";
      readonly status: "completed" | "interrupted" | "failed";
      readonly error: string | null;
    }
  | { readonly kind: "notice"; readonly text: string };

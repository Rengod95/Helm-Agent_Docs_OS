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

export interface ApprovalView {
  /** approval.requested 이벤트 id(F wire §4.6 [가정]) */
  readonly approvalId: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly allowsAnswer: boolean;
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
  | { readonly kind: "approvalResolved"; readonly approvalId: string }
  | {
      readonly kind: "turnEnd";
      readonly status: "completed" | "interrupted" | "failed";
      readonly error: string | null;
    }
  | { readonly kind: "notice"; readonly text: string };

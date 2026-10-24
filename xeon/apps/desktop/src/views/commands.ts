import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@xeon/contracts";

// 화면이 부르는 명령. 구현은 src/app/commands.ts다. 명령은 거울을 바꾸지 않는다(FS-02):
// 보낸 직후의 표시(보내는 중, 실패)는 UI 스토어가, 결과는 엔진 이벤트가 거울에 넣는다.

export type CommandError =
  | { readonly kind: "offline" }
  | { readonly kind: "rejected"; readonly code: number | null }
  | { readonly kind: "failed" };

export type ApprovalDecision =
  | { readonly decision: "allow" | "deny"; readonly remember?: "once" | "thread" | "always" }
  /** 질문 응답은 QuestionAnswer(질문 id → 선택지 id 목록과 자유 입력)다(F.wire-settings.spec §3.3.1) */
  | {
      readonly decision: "answer";
      readonly answer: Readonly<Record<string, { selected: string[]; text?: string }>>;
    };

export interface Commands {
  selectThread(threadId: ThreadId): void;
  createThread(): Promise<Result<null, CommandError>>;
  /** requestId는 같은 입력의 재시도가 같은 값을 쓰도록 호출자가 만든다(spec 4.13) */
  sendTurn(
    threadId: ThreadId,
    text: string,
    requestId: string,
  ): Promise<Result<null, CommandError>>;
  interrupt(threadId: ThreadId): Promise<Result<null, CommandError>>;
  respondApproval(approvalId: EventId, response: ApprovalDecision): Promise<void>;
  reloadThreads(): void;
  retryTranscript(): void;
  reconnect(): void;
  restartEngine(): Promise<void>;
  /** 진단 묶음을 클립보드에 쓴다 */
  copyDiagnostics(): Promise<boolean>;
}

export const CommandsContext: React.Context<Commands | null> = createContext<Commands | null>(null);

export function useCommands(): Commands {
  const commands = useContext(CommandsContext);
  if (commands === null) throw new Bug("CommandsContext provider is missing");
  return commands;
}

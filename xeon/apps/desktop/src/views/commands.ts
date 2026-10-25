import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@xeon/contracts";
import type { TrustChoice, TrustStatus } from "@xeon/contracts/wire";
import type { LockedOption } from "../state/ui/index.ts";

// 화면이 부르는 명령. 구현은 src/app/commands.ts다. 명령은 거울을 바꾸지 않는다(FS-02):
// 보낸 직후의 표시(보내는 중, 실패)는 UI 스토어가, 결과는 엔진 이벤트가 거울에 넣는다.

export type CommandError =
  | { readonly kind: "offline" }
  /** 연결된 host에 그 메서드가 없다(-32601). 아직 구현하지 않은 host나 오래된 엔진이다 */
  | { readonly kind: "unsupported" }
  /** 다른 프로세스가 쓰기 소유를 쥐고 있다(`thread.locked`, 3002). 대안은 host가 준 목록이다 */
  | {
      readonly kind: "locked";
      readonly ownerKind: string;
      readonly options: readonly LockedOption[];
    }
  | { readonly kind: "rejected"; readonly code: number | null }
  | { readonly kind: "failed" };

export type ApprovalDecision =
  | { readonly decision: "allow" | "deny"; readonly remember?: "once" | "thread" | "always" }
  /** 질문 응답은 QuestionAnswer(질문 id → 선택지 id 목록과 자유 입력)다(F.wire-settings.spec §3.3.1) */
  | {
      readonly decision: "answer";
      readonly answer: Readonly<Record<string, { selected: string[]; text?: string }>>;
    };

/**
 * 프로젝트 신뢰(F.wire-settings.spec `trust.get`, `trust.decide`). 판정은 요청 결과로 얻는 값이라 거울에 넣지 않고
 * 부르는 부품의 로컬 상태에 둔다(FS-03). 결정을 보내면 host가 저장한 뒤의 판정을 돌려준다.
 */
export interface TrustCommands {
  status(workspace: string): Promise<Result<TrustStatus, CommandError>>;
  decide(workspace: string, choice: TrustChoice): Promise<Result<TrustStatus, CommandError>>;
}

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
  readonly trust: TrustCommands;
  /** `thread.locked` 대화 상자의 "관찰만" 선택. 성공하면 그 thread의 입력창이 잠긴다 */
  observeThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /** 같은 대화를 분기해 새 thread로 이어 쓴다. 성공하면 새 thread를 연다 */
  forkThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  dismissLocked(): void;
  /** 관찰을 끝내고 쓰기를 다시 시도하게 한다 */
  retryWrite(threadId: ThreadId): void;
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

import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@xeon/contracts";
import type { SecretName } from "@xeon/contracts/capabilities";
import type { TrustChoice, TrustStatus } from "@xeon/contracts/wire";
import type { SetupSnapshot } from "../settings/index.ts";
import type { LockedOption, Screen } from "../state/ui/index.ts";

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
interface TrustCommands {
  status(workspace: string): Promise<Result<TrustStatus, CommandError>>;
  decide(workspace: string, choice: TrustChoice): Promise<Result<TrustStatus, CommandError>>;
}

/**
 * 최소 설정 화면(G2-08). 모두 요청 결과로 얻는 값이라 거울에 넣지 않는다. 키 값은 어느 메서드도 받지 않는다:
 * 등록은 값 없는 `secret.beginEntry`가 시작하고 값은 호스트가 wire 밖에서 받는다.
 */
export interface SetupCommands {
  /**
   * 설정, 비밀 목록을 읽는다. `binaries`가 참이면 `host.status { includeBinaries: true }`로 외부 도구도 점검한다.
   * 점검은 자식 프로세스를 띄우므로 설정 화면이 열릴 때와 "다시 확인"에서만 참이다. 시작 안내 띠는 거짓이다.
   * 거짓이면 `binaries`와 `toolsReady`는 비어 있다.
   */
  load(options: { readonly binaries: boolean }): Promise<Result<SetupSnapshot, CommandError>>;
  /** `secret.beginEntry`. 값을 받는 수단이 이 연결에 없으면 `false`다(사이드카는 아직 없다) */
  beginKeyEntry(
    secretName: SecretName,
    action: "add" | "set",
  ): Promise<Result<boolean, CommandError>>;
  /** provider의 `apiKeyRef`를 `secret://<이름>`으로 정하고 켠다 */
  connectProviderKey(
    providerId: string,
    secretName: SecretName,
  ): Promise<Result<null, CommandError>>;
  setDefaultModel(ref: string): Promise<Result<null, CommandError>>;
  /** `settings.invalidated`를 받으면 부른다. 반환값은 구독 해제 */
  onInvalidated(listener: () => void): () => void;
}

export interface Commands {
  selectThread(threadId: ThreadId): void;
  /** `workspace`는 작업 폴더(절대 경로)이고 `thread.create`로 그대로 보낸다. 없으면 폴더 없는 대화다(G2-02) */
  createThread(workspace?: string): Promise<Result<null, CommandError>>;
  /** requestId는 같은 입력의 재시도가 같은 값을 쓰도록 호출자가 만든다(spec 4.13) */
  sendTurn(
    threadId: ThreadId,
    text: string,
    requestId: string,
  ): Promise<Result<null, CommandError>>;
  interrupt(threadId: ThreadId): Promise<Result<null, CommandError>>;
  respondApproval(approvalId: EventId, response: ApprovalDecision): Promise<void>;
  readonly trust: TrustCommands;
  readonly setup: SetupCommands;
  /** `thread.locked` 대화 상자의 "관찰만" 선택. 성공하면 그 thread의 입력창이 잠긴다 */
  observeThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /** 같은 대화를 분기해 새 thread로 이어 쓴다. 성공하면 새 thread를 연다 */
  forkThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  dismissLocked(): void;
  /** 관찰을 끝내고 쓰기를 다시 시도하게 한다 */
  retryWrite(threadId: ThreadId): void;
  showScreen(screen: Screen): void;
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

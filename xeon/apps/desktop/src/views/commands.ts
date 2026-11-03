import type { EventId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@fresnel/contracts";
import type { ScheduleListItem, SecretName } from "@fresnel/contracts/capabilities";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  ExtVersionsResult,
  HookEntry,
  HostConnection,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
  SecretListEntry,
  SecretReferencesResult,
  SecretTestResult,
  TrustChoice,
  TrustStatus,
  WireParams,
  WireResult,
} from "@fresnel/contracts/wire";
import type { CommandRowVM, KeyRegisterError, SetupSnapshot } from "@fresnel/client/settings";
import type { AttachFailureKind, TargetEntry } from "@fresnel/client";
import type { ToggleRequest } from "@fresnel/client/workbench";
import type { LockedOption, Screen } from "../state/ui/index.ts";
import type { EngineTarget } from "../transport/ipc.ts";

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
  | {
      readonly kind: "rejected";
      readonly code: number | null;
      /** host가 값 검사 실패(`settings.invalidValue`, 3102)에서 준 첫 문제의 문장. 설정 화면이 그대로 보인다 */
      readonly detail?: string;
    }
  | { readonly kind: "failed" }
  /** 엔진 대상을 바꾸는 중이라 쓰기를 보류했다(W-08). 새 엔진이 붙은 뒤 다시 보낸다 */
  | { readonly kind: "switching" };

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

/** `schedule.list` 값 + 서비스 모드 꺼짐 여부(`settings.get`의 `l0.process.service.enabled`) */
export interface ScheduleSnapshot {
  readonly items: readonly ScheduleListItem[];
  readonly serviceModeOff: boolean;
}

/**
 * 예약 화면(P-07, O-08). 목록은 요청 결과라 거울에 넣지 않는다(FS-03). `create`, `cancel`, `fire`는 host의 결과 값을
 * 그대로 돌려준다. 기대한 실패(`ok: false`의 `error`)는 transport 오류가 아니라 값이다. transport 오류(연결 없음,
 * 구형 host의 `unsupported`, 그 밖)만 바깥 `Result`의 `error`가 된다.
 */
export interface ScheduleCommands {
  list(): Promise<Result<ScheduleSnapshot, CommandError>>;
  create(
    params: WireParams<"schedule.create">,
  ): Promise<Result<WireResult<"schedule.create">, CommandError>>;
  cancel(scheduleId: string): Promise<Result<WireResult<"schedule.cancel">, CommandError>>;
  fire(scheduleId: string): Promise<Result<WireResult<"schedule.fire">, CommandError>>;
  /** 서비스 모드를 켠다(`settings.set`, 사용자 범위) */
  enableService(): Promise<Result<null, CommandError>>;
}

/** 연결 화면이 고른 대상. `local`은 이 기기의 사이드카, `remote`는 서비스 주소다(W-08) */
export type ConnectTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly address: string };

/** 연결 화면이 읽는 host 상태. `host.status` 결과와 서비스 모드 설정 값이다 */
export interface ConnectionSnapshot {
  readonly host: WireResult<"host.status">;
  readonly serviceEnabled: boolean;
}

/** 원격 대상 목록을 읽거나 쓰지 못했다(로컬 설정 파일) */
export type TargetStoreError = { readonly kind: "storage" };

/**
 * 연결 화면(P-08). 대상 목록은 로컬 설정 파일에서 읽고 쓴다(거울에 넣지 않는다). `retarget`은 셸 명령이고 진행은 엔진 상태와
 * 연결 상태가 알린다. 실패는 연결 실패 종류로 바꿔 돌려준다. 토큰은 이 명령들을 지나지 않는다(환경 변수로만 받는다).
 */
export interface ConnectionCommands {
  targets(): Promise<Result<readonly TargetEntry[], TargetStoreError>>;
  saveTargets(list: readonly TargetEntry[]): Promise<Result<null, TargetStoreError>>;
  /** 엔진이 붙을 대상을 바꾼다. 같은 대상이면 셸이 아무 일도 하지 않는다. 셸이 거절하면 실패 종류를 돌려준다 */
  retarget(target: ConnectTarget): Promise<Result<null, AttachFailureKind>>;
  /** 실패 뒤 다시 시도: 멈춘 엔진을 다시 띄우거나, 엔진은 떠 있는데 연결이 끊겼으면 다시 잇는다 */
  retry(): Promise<void>;
  /** `host.status`와 서비스 모드 설정. 연결이 없으면 `offline`이다 */
  load(): Promise<Result<ConnectionSnapshot, CommandError>>;
  /** 서비스 모드를 켜거나 끈다(`settings.set`, 사용자 범위). 적용은 엔진 재시작 뒤다 */
  setServiceMode(enabled: boolean): Promise<Result<null, CommandError>>;
  /** 서비스를 협조 종료한다(`host.shutdown`). 받아들여졌으면 `true`다 */
  stopService(): Promise<Result<boolean, CommandError>>;
}

/**
 * 최소 설정 화면(G2-08). 모두 요청 결과로 얻는 값이라 거울에 넣지 않는다. wire 메서드는 값을 받지 않는다:
 * 호스트가 값을 받을 수 있으면 값 없는 `secret.beginEntry`가 시작하고, 받을 수 없는 연결(사이드카)은 `registerKey`가
 * 셸의 `secret_register` 명령으로 값을 보낸다. 값은 wire를 지나지 않는다(L4.desktop.spec §4.14.1).
 */
export interface SetupCommands {
  /**
   * 설정, 시크릿 목록을 읽는다. `binaries`가 참이면 `host.status { includeBinaries: true }`로 외부 도구도 점검한다.
   * 점검은 자식 프로세스를 띄우므로 설정 화면이 열릴 때와 "다시 확인"에서만 참이다. 시작 안내 띠는 거짓이다.
   * 거짓이면 `binaries`와 `toolsReady`는 비어 있다.
   */
  load(options: { readonly binaries: boolean }): Promise<Result<SetupSnapshot, CommandError>>;
  /** `secret.beginEntry`. 호스트가 값을 받는 수단이 이 연결에 없으면 `false`다(사이드카 호스트는 항상 `false`, HS-44) */
  beginKeyEntry(
    secretName: SecretName,
    action: "add" | "set",
  ): Promise<Result<boolean, CommandError>>;
  /**
   * 셸이 값을 받아 번들된 `fresnel secret add|set`의 stdin에 한 번 쓴다. 값을 담은 `value`는 호출자가 보낸 뒤 덮는다.
   * 이 연결에 셸 경로가 없으면 `unavailable`이다.
   */
  registerKey(
    secretName: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, KeyRegisterError>>;
  /** provider의 `apiKeyRef`를 `secret://<이름>`으로 정하고 켠다 */
  connectProviderKey(
    providerId: string,
    secretName: SecretName,
  ): Promise<Result<null, CommandError>>;
  setDefaultModel(ref: string): Promise<Result<null, CommandError>>;
  /** `settings.invalidated`를 받으면 부른다. 반환값은 구독 해제 */
  onInvalidated(listener: () => void): () => void;
}

/**
 * 시크릿 화면의 기대하지 않은 실패. `secret.*`의 몇 가지 오류 종류만 구분하고 나머지는 `failed`다.
 * 값은 이 오류에도 들어 있지 않다(wire의 details에 값이 없다).
 */
export type SecretCommandError =
  | { readonly kind: "offline" }
  /** 연결된 host에 그 메서드가 없다(-32601) */
  | { readonly kind: "unsupported" }
  /** `secret.reauthRequired`: 재인증이 필요하다 */
  | { readonly kind: "reauthRequired" }
  /** `secret.notFound`: 그 이름의 시크릿이 없다 */
  | { readonly kind: "notFound" }
  /** `secret.inUse`: 설정이나 대화가 쓰고 있어 지울 수 없다 */
  | { readonly kind: "inUse" }
  | { readonly kind: "failed" };

/**
 * 시크릿 화면(P-10). 목록과 메타는 요청 결과라 거울에 넣지 않는다(FS-03). 값은 wire를 지나지 않는다:
 * 값 입력은 `registerKey`(셸 명령), 값 보기는 재인증 관문 뒤의 `beginReveal`(값 없이 호스트가 자기 창에 보인다)이다.
 */
export interface SecretCommands {
  /** `secret.list { meta, usage }`의 시크릿 항목 */
  list(): Promise<Result<readonly SecretListEntry[], SecretCommandError>>;
  references(name: SecretName): Promise<Result<SecretReferencesResult, SecretCommandError>>;
  test(name: SecretName): Promise<Result<SecretTestResult, SecretCommandError>>;
  /** `secret.meta`. 바뀐 시크릿 항목을 돌려준다 */
  editMeta(params: WireParams<"secret.meta">): Promise<Result<SecretListEntry, SecretCommandError>>;
  /** `secret.remove`. 지웠으면 `true`다 */
  remove(name: SecretName): Promise<Result<boolean, SecretCommandError>>;
  /** `secret.beginEntry`. 호스트가 값을 받으면 `true`(호스트 창), 이 화면이 받으면 `false`다 */
  beginEntry(name: SecretName, action: "add" | "set"): Promise<Result<boolean, SecretCommandError>>;
  /** 셸의 `secret_register`로 값을 보낸다. 값은 호출자가 보낸 뒤 덮는다 */
  registerKey(
    name: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, KeyRegisterError>>;
  /** `secret.beginReveal`. 호스트가 자기 창에 값을 보였으면 `true`다. 값은 이 경로로 오지 않는다 */
  beginReveal(name: SecretName): Promise<Result<boolean, SecretCommandError>>;
  /** 클립보드에 글을 쓴다. 빈 글은 비우기다 */
  writeClipboard(text: string): Promise<void>;
}

export interface WorkbenchCommands {
  /** `ext.list`. 전역 값이라 `threadId`를 보내지 않는다 */
  list(): Promise<Result<readonly ExtListEntry[], CommandError>>;
  /** `ext.get`: 매니페스트 훅·기능 바인딩·진단 */
  get(name: string): Promise<Result<ExtGetResult, CommandError>>;
  /** 켜기·끄기: `settings.set { key: "ext.<이름>.enabled", scope: "user" }` */
  toggle(request: ToggleRequest): Promise<Result<null, CommandError>>;
  /** 자동 꺼짐 다시 켜기. 적용은 다음 단계 경계다 */
  reenable(name: string): Promise<Result<null, CommandError>>;
  versions(name: string): Promise<Result<ExtVersionsResult, CommandError>>;
  /** 되돌리기. `restart`면 다음 시작에 적용된다(HS-108) */
  rollback(
    name: string,
    version: string,
    clearState: boolean,
  ): Promise<Result<"nextStepBoundary" | "restart", CommandError>>;
  /** `ext.health`(모든 확장). 실패 장부 배열 */
  health(): Promise<Result<readonly ExtHealthEntry[], CommandError>>;
  /** `hooks.list`: 훅마다 핸들러의 기본 순서(`order` 행)를 포함한다 */
  hooks(): Promise<Result<readonly HookEntry[], CommandError>>;
  /** `hooks.order.get`: 저장 값과 적용 중 순서 */
  orderGet(): Promise<Result<HooksOrderGetResult, CommandError>>;
  /** `hooks.order.set`: 저장만 한다. 적용은 다음 단계 경계다 */
  orderSet(
    hook: string,
    order: readonly string[],
  ): Promise<Result<HooksOrderSetResult, CommandError>>;
  /** `hooks.order.reset`: `hook`을 생략하면 모든 훅의 덮어쓰기를 지운다 */
  orderReset(hook?: string): Promise<Result<HooksOrderResetResult, CommandError>>;
  /** `hooks.order.preview`: 저장하지 않고 이 순서를 적용했을 때의 결과를 본다 */
  orderPreview(
    hook: string,
    order: readonly string[],
  ): Promise<Result<HooksOrderPreviewResult, CommandError>>;
  /** `trace.turn`: 한 턴의 훅별 핸들러 계측 */
  trace(threadId: ThreadId, turnId: TurnId): Promise<Result<TraceTurnResult, CommandError>>;
}

interface PluginUiCommands {
  withConnection<T>(
    run: (connection: HostConnection) => Promise<T>,
  ): Promise<Result<T, CommandError>>;
  /** 지금 연결. 재연결 뒤에는 새 연결이다. 화면이 연결을 붙잡고 있으면 낡은 연결로 요청이 간다. 없으면 null */
  current(): HostConnection | null;
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
  /**
   * 입력창이 `/`로 시작하는 줄을 슬래시 명령으로 보냈을 때(`sendTurn`) 호스트가 셸 주입 실행에 사람 확인을 요구했다. 이 호출이 같은 줄을
   * `confirmShell: true`로 다시 보낸다. 확인 대기가 없으면 아무 일도 하지 않는다.
   */
  confirmShell(): Promise<Result<null, CommandError>>;
  /** 셸 주입 확인을 거절한다. 아무것도 실행하지 않는다 */
  cancelShell(): void;
  /** 동작 명령이 낸 출력(`UiState.commandOutput`)을 닫는다 */
  dismissCommandOutput(): void;
  /** 엔진에 등록한 슬래시 명령 목록(`command.list`)을 목록·자동완성 view-model로 돌려준다. `threadId`를 주면 그 대화의 프로젝트 명령도 싣는다 */
  commandList(threadId: ThreadId | null): Promise<Result<readonly CommandRowVM[], CommandError>>;
  /** 보류 중이면 응답을 보내지 않고 카드에 `switching` 실패 표시를 둔다(보내는 중 표시는 켜지 않는다) */
  respondApproval(approvalId: EventId, response: ApprovalDecision): Promise<void>;
  /**
   * 엔진 대상을 바꾼다(W-08, `engine_retarget`). 바꾸는 동안 쓰기 명령(`sendTurn`, `interrupt`, `respondApproval`, `createThread`,
   * `forkThread`, `trust.decide`)은 `switching`으로 거절한다. 옛 엔진이 `shutdownGraceMs`까지 쓰기를 받을 수 있어서다.
   * `graceMs`는 `l4.desktop.engine.shutdownGraceMs`.
   */
  retargetEngine(target: EngineTarget, graceMs: number): Promise<Result<null, CommandError>>;
  readonly trust: TrustCommands;
  readonly setup: SetupCommands;
  /** 크래프트(`workbench`)의 확장 읽기·켜기·되돌리기 */
  readonly workbench: WorkbenchCommands;
  readonly schedule: ScheduleCommands;
  /** 플러그인 화면 실행 맥락이 쓰는 연결 한 번. 연결이 없으면 `offline`이다 */
  readonly pluginUi: PluginUiCommands;
  readonly connection: ConnectionCommands;
  readonly secrets: SecretCommands;
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

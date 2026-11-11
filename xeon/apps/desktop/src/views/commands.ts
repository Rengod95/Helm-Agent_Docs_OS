import type { RemoteAdapter } from "../app/remote/remote-types.ts";
import type {
  EventId,
  ModelThinkingLevel,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type {
  CompositionDecl,
  ExtTimingsResult,
  TestRunPhaseResult,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@fresnel/contracts";
import type { ScheduleListItem, SecretName } from "@fresnel/contracts/capabilities";
import type {
  DevkitReason,
  InstallPreview,
  KindEntry,
  PackResult,
  ScaffoldInput,
  ScaffoldResult,
} from "@fresnel/contracts/services";
import type { EffectiveSetting, SettingDefWire } from "@fresnel/contracts/settings";
import type { DenyAnswerJson, PlanAnswerJson, ReviewAnswerJson } from "@fresnel/contracts/records";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  ExtUiEntry,
  ExtVersionsResult,
  GroupDriveLockResult,
  GroupMetricsResult,
  GroupStatusWire,
  HookEntry,
  HostClientView,
  NotifyDeliveredParams,
  HostConnection,
  ExtInstallResult,
  ExtRemoveResult,
  ExtBindingsResult,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
  McpServerAction,
  McpServerRow,
  Profile,
  ProfileApplyResult,
  ProfileGetResult,
  ProfileInput,
  ProfilePreviewResult,
  ExtValidateDirResult,
  ExtValidateResult,
  SecretListEntry,
  SecretAuditResult,
  SecretReferencesResult,
  SecretTestResult,
  ExtTestListResult,
  MeasureDailyResult,
  MeasureTurnResult,
  ExtTestRunParams,
  ExtTestRunResult,
  SettingsExplainResult,
  SettingsReadFileResult,
  SettingsFileProblem,
  SettingsFileScope,
  SettingsWritableFileScope,
  SettingsWriteFileResult,
  StartupNotice,
  TrustChoice,
  TrustListResult,
  TrustStatus,
  WireParams,
  WireResult,
  WorkspaceStatusResult,
} from "@fresnel/contracts/wire";
import type {
  CommandRowVM,
  DecisionOutcome,
  KeyRegisterError,
  ProposalListVM,
  SettingsController,
  SetupSnapshot,
} from "@fresnel/client/settings";
import type { AttachFailureKind, OrderUpdate, TargetEntry, ToolsWebView } from "@fresnel/client";
import type { ThreadToggleRequest, ToggleRequest } from "@fresnel/client/workbench";
import type {
  LockedOption,
  RestartReason,
  ReviewTarget,
  Screen,
  SettingsJump,
  SettingsSection,
} from "../state/ui/index.ts";
import type {
  BackupReport,
  EngineTarget,
  PreviousRemoved,
  RestartOptions,
  RestoreReport,
  ServiceAutostart,
  StorageUsage,
} from "../transport/ipc.ts";
import type { PaletteUses } from "./palette/palette-model.ts";

// 화면이 부르는 명령. 구현은 src/app/commands.ts다. 명령은 거울을 바꾸지 않는다(FS-02):
// 보낸 직후의 표시(보내는 중, 실패)는 UI 스토어가, 결과는 엔진 이벤트가 거울에 넣는다.

/** `attachments.add`가 돌려준 입력 파트 */
export type AttachmentParts = WireResult<"attachments.add">["parts"];

/** `thread.export`의 형식. `markdown`은 읽기용 문서, `json`은 item 원형 배열이다 */
export type ExportFormat = WireParams<"thread.export">["format"];

/** 쪽을 모두 이어 붙인 내보내기 결과. `filename`은 host가 준 이름(`제목.md` 꼴)이고 `itemCount`는 전체 item 수다 */
export interface ExportDocument {
  readonly filename: string;
  readonly content: string;
  readonly itemCount: number;
}

/**
 * 실행 중에 보낸 입력이 들어갈 자리(`turn.start`의 `whenBusy`). `steer`는 다음 도구 라운드 뒤, `followUp`은 이번 턴이 끝난 뒤다.
 * 입력창의 "바로 / 끝난 뒤" 단추가 고른다. 데스크톱 입력창의 기본은 `followUp`이다.
 */
export type BusyInputMode = "steer" | "followUp";

/** 입력창 승인 모드 칩이 고를 수 있는 모드. `plan`과 `bypass`는 칩으로 들어가는 목표가 아니다(계획 승인과 설정이 정한다) */
export type SwitchMode = "default" | "acceptEdits";

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
      /** 입력 거절(`jsonrpc.invalidParams`)의 첫 문제 문장. `<종류>: <내용>` 꼴이면 화면이 종류를 가른다 */
      readonly issue?: string;
      /** 입력 거절의 첫 문제가 가리는 입력 이름(예: `planId`). 없으면 없다 */
      readonly path?: string;
      /** 설치 입력이 검사에서 걸린 사유 목록(`details.reasons`). 화면은 `message` 원문을 보이지 않는다 */
      readonly reasons?: readonly DevkitReason[];
    }
  | { readonly kind: "failed" }
  /** 엔진 대상을 바꾸는 중이라 쓰기를 보류했다(W-08). 새 엔진이 붙은 뒤 다시 보낸다 */
  | { readonly kind: "switching" };

export type ApprovalDecision =
  /** 계획 승인은 `{ mode }`, 수정 요청과 거부는 `{ feedback }`를 answer로 싣는다(F.wire-settings.spec §3.3.1). 그 밖에는 답이 없다 */
  | {
      readonly decision: "allow" | "deny";
      readonly remember?: "once" | "thread" | "always";
      readonly answer?: PlanAnswerJson | DenyAnswerJson;
    }
  /** 질문 응답은 QuestionAnswer(질문 id → 선택지 id 목록과 자유 입력), 검토 응답은 ReviewAnswer다(F.wire-settings.spec §3.3.1) */
  | {
      readonly decision: "answer";
      readonly answer:
        | Readonly<Record<string, { selected: string[]; text?: string }>>
        | ReviewAnswerJson;
    };

/**
 * 프로젝트 신뢰(F.wire-settings.spec `trust.get`, `trust.decide`). 판정은 요청 결과로 얻는 값이라 거울에 넣지 않고
 * 부르는 부품의 로컬 상태에 둔다(FS-03). 결정을 보내면 host가 저장한 뒤의 판정을 돌려준다.
 */
interface TrustCommands {
  status(workspace: string): Promise<Result<TrustStatus, CommandError>>;
  decide(workspace: string, choice: TrustChoice): Promise<Result<TrustStatus, CommandError>>;
  /** `trust.list`: 저장된 결정 목록(읽기 전용). 설정 화면의 "신뢰한 폴더" 구역이 읽는다 */
  list(): Promise<Result<TrustListResult, CommandError>>;
}

/**
 * 작업 폴더의 존재(`workspace.status`). 대화 화면의 띠가 대화를 열 때와 연결이 살아날 때 묻는다(F wire §3.3.1).
 * 구형 host에는 메서드가 없어 `unsupported`이고, 그때 띠는 그리지 않는다.
 */
interface WorkspaceCommands {
  status(workspace: string): Promise<Result<WorkspaceStatusResult, CommandError>>;
}

/**
 * `schedule.list` 값 + 서비스 모드 꺼짐 여부와 다시 시작 대기 여부. 꺼짐은 설정 값이 아니라 `host.status`의 모드로 본다
 * (`mode`가 `service`가 아니면 꺼진 것이다). 다시 시작 대기는 `settings.get`의 `l0.process.service.enabled`다.
 */
export interface ScheduleSnapshot {
  readonly items: readonly ScheduleListItem[];
  readonly serviceModeOff: boolean;
  /** 서비스 모드 값이 바뀌어 엔진을 다시 시작해야 적용되는가(`pendingUntil: "restart"`) */
  readonly serviceRestartPending: boolean;
}

/**
 * 예약 화면(P-07, O-08). 목록은 요청 결과라 거울에 넣지 않는다(FS-03). `create`, `cancel`, `fire`는 host의 결과 값을
 * 그대로 돌려준다. 기대한 실패(`ok: false`의 `error`)는 transport 오류가 아니라 값이다. transport 오류(연결 없음,
 * 구형 host의 `unsupported`, 그 밖)만 바깥 `Result`의 `error`가 된다.
 */
export interface ScheduleCommands {
  /** `schedule.list`. 거르기는 인자(`enabled: true`)로 보낸다. 모두는 빈 인자다 */
  list(params: WireParams<"schedule.list">): Promise<Result<ScheduleSnapshot, CommandError>>;
  create(
    params: WireParams<"schedule.create">,
  ): Promise<Result<WireResult<"schedule.create">, CommandError>>;
  cancel(scheduleId: string): Promise<Result<WireResult<"schedule.cancel">, CommandError>>;
  fire(scheduleId: string): Promise<Result<WireResult<"schedule.fire">, CommandError>>;
  /** `schedule.update`: 다시 켜기와 제목·프롬프트 고치기. 실패(없는 예약, 켠 예약 상한)는 호스트 오류라 `CommandError`다 */
  update(
    params: WireParams<"schedule.update">,
  ): Promise<Result<WireResult<"schedule.update">, CommandError>>;
  /** `schedule.runs`: 한 예약의 실행 기록(최근 것부터) */
  runs(scheduleId: string): Promise<Result<WireResult<"schedule.runs">, CommandError>>;
  /**
   * 서비스 모드를 켠다. 연결 화면의 켜기와 같은 흐름이다(`connection.setServiceMode(true)`): 설정을 쓰고, 이 기기면 서비스를 켠 뒤
   * 엔진을 다시 띄운다. 성공하면 적용된 것이라 `restartPending`은 거짓이다.
   */
  enableService(): Promise<Result<{ readonly restartPending: boolean }, CommandError>>;
}

/**
 * 테스트 화면(P-19, §6.26). 목록과 개발 모드 판정은 요청 결과라 거울에 넣지 않는다(FS-03). 실행과 Test run 제어는 host의 결과 값을
 * 그대로 돌려준다. `devMode`는 `l3.authoring.devMode` 설정이고, 키를 읽지 못하면(호스트가 모르는 키) 개발 모드가 아니다.
 */
export interface TestCommands {
  /** `ext.test.list`: replay와 Test run 기록 */
  list(): Promise<Result<ExtTestListResult["tests"], CommandError>>;
  /** 개발 모드인가. 연결이 없으면 `offline`, 그 밖의 읽기 실패는 개발 모드가 아닌 것으로 본다 */
  devMode(): Promise<Result<boolean, CommandError>>;
  /** `ext.test.run`: replay 시험을 돌린다 */
  run(params: ExtTestRunParams): Promise<Result<ExtTestRunResult, CommandError>>;
  /** `thread.create { testRun: true, profileId? }`: Test run 대화를 만든다(프로필은 만들면서 `thread` 층에 적용). 대화 id를 돌려준다 */
  createTestRun(profileId?: string): Promise<Result<string, CommandError>>;
  /** `testRun.pause`: 다음 단계 경계에서 멈춘다. 결과는 멈춘 채인가 */
  pause(threadId: string): Promise<Result<boolean, CommandError>>;
  /** `testRun.resume`: 멈춘 Test run을 다시 돌린다 */
  resume(threadId: string): Promise<Result<boolean, CommandError>>;
  /** `testRun.step`: 멈춘 채 경계 하나만 진행한다 */
  step(threadId: string): Promise<Result<boolean, CommandError>>;
  /** `testRun.phase`: 지금 단계 이름(Test run에서 `grp.<id>.state.committed`의 `phase`만) */
  phase(threadId: string): Promise<Result<TestRunPhaseResult, CommandError>>;
}

/**
 * 제안 화면(P-06). 목록은 `proposal.list`를 화면 값(`ProposalListVM`)으로, 결정은 `proposal.decide`를 문장이 된 결과(`DecisionOutcome`)로
 * 돌려준다. 둘 다 거울에 넣지 않는다(FS-03). 기대한 실패(`ok: false`)는 값이고, 연결과 host 실패만 `CommandError`다.
 */
export interface ProposalCommands {
  list(params: WireParams<"proposal.list">): Promise<Result<ProposalListVM, CommandError>>;
  decide(params: WireParams<"proposal.decide">): Promise<Result<DecisionOutcome, CommandError>>;
}

/**
 * 충돌하는 스킬 본문(W-14, 제안 화면). 본문은 요청 결과라 거울에 넣지 않는다(FS-03). 이름을 모르면 `not_found`다. host는 이것을
 * 입력 거절(`jsonrpc.invalidParams`)로 알리고, 명령이 화면 값으로 바꾼다. 스킬 기능이 꺼져 있으면 `unsupported`다.
 */
export interface SkillCommands {
  /** `knowledge.skills.view`. `threadId`를 주면 그 대화의 작업 폴더 기준으로 프로젝트 스킬을 찾는다 */
  view(
    name: string,
    threadId?: string,
  ): Promise<Result<WireResult<"knowledge.skills.view">, SkillViewError>>;
  /** `knowledge.skills.list`. 이 대화가 쓸 수 있는 스킬과 싣지 못한 이유. 슬래시 목록의 "스킬" 묶음이 읽는다. 스킬 설정이 꺼져 있으면 `unsupported` */
  list(threadId: string | null): Promise<Result<WireResult<"knowledge.skills.list">, CommandError>>;
}

/**
 * 기억 보기·고치기·지우기(W-19). 기억은 요청 결과라 거울에 넣지 않는다(FS-03). 쓰기 결과의 `view`는 쓴 뒤의 저장소다.
 * `baseHash`는 마지막으로 읽은 `fileHash`다. 바깥에서 바뀌었으면 `rejected`(path `baseHash`)다.
 */
export interface MemoryCommands {
  read(): Promise<Result<WireResult<"knowledge.memory.read">, CommandError>>;
  add(
    store: "user" | "env",
    text: string,
  ): Promise<Result<WireResult<"knowledge.memory.add">, CommandError>>;
  replace(
    store: "user" | "env",
    entryId: string,
    text: string,
    baseHash: string,
  ): Promise<Result<WireResult<"knowledge.memory.replace">, CommandError>>;
  remove(
    store: "user" | "env",
    entryId: string,
    baseHash: string,
  ): Promise<Result<WireResult<"knowledge.memory.remove">, CommandError>>;
}

/** 스킬 본문 읽기가 기대한 실패는 `not_found`뿐이고, 나머지는 연결과 host 실패다 */
export type SkillViewError = CommandError | { readonly kind: "not_found" };

/**
 * 변경 검토 화면(P-04). hunk 본문은 요청 결과라 거울에 넣지 않는다(FS-03). 승인 답은 `respondApproval`로 보낸다.
 * 읽기 실패(연결 없음, 없는 리뷰)는 `CommandError`다.
 */
export interface ReviewCommands {
  /** `review.get`. 리뷰의 파일과 hunk 본문을 읽는다 */
  get(reviewId: string): Promise<Result<WireResult<"review.get">, CommandError>>;
}

/**
 * 사용량 게이지(P-11 "사용량 (이 대화)"). 게이지는 요청 결과라 거울에 넣지 않는다(FS-03). 읽기만 하고 연결과 host 실패만 `CommandError`다.
 */
export interface UsageCommands {
  /** `usage.get`. `threadId`를 주면 그 대화의 게이지를 더한다. 한도와 재설정 시각은 host가 알 때만 준다 */
  get(params: WireParams<"usage.get">): Promise<Result<WireResult<"usage.get">, CommandError>>;
}

/**
 * 목표와 작업(P-14). 목표와 작업 목록은 요청 결과라 거울에 넣지 않는다(FS-03). 목표를 걸고 해제하는 것은 `command.run`에 `/goal` 줄을
 * 그대로 보낸다. `done`이 아닌 결과와 실패는 화면이 문장으로 바꾼다.
 */
export interface WorkCommands {
  goal(threadId: ThreadId): Promise<Result<WireResult<"goal.status">, CommandError>>;
  tasks(threadId: ThreadId): Promise<Result<WireResult<"work.tasks.list">, CommandError>>;
  goalCommand(
    threadId: ThreadId,
    text: string,
  ): Promise<Result<WireResult<"command.run">, CommandError>>;
  /** 계획의 모든 판(W-18). 모르는 계획 id는 `rejected`이고 `path`가 `planId`다 */
  planVersions(
    threadId: ThreadId,
    planId: string,
  ): Promise<Result<WireResult<"work.plans.versions">, CommandError>>;
}

/**
 * 연결 화면이 고른 대상. `local`은 이 기기의 사이드카, `remote`는 서비스 주소다(W-08). `label`은 이름이라 셸에는 가지 않고
 * 상태 표시줄의 "원격 · 이름"에 쓴다(app/connection.ts)
 */
export type ConnectTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly address: string; readonly label: string };

/**
 * 이 기기의 서비스 상태 카드(`service_status`). 엔진 대상이 이 기기일 때만 읽는다. `unknown`은 대상이 원격이거나 읽지 못한 것이다.
 * `attached`는 엔진이 지금 서비스에 붙어 있는가(`host.status.mode === "service"`)다. 소켓 경로와 토큰은 싣지 않는다.
 */
export type ServiceCard =
  | { readonly kind: "unknown" }
  | { readonly kind: "stopped"; readonly reason: string }
  | {
      readonly kind: "running";
      readonly pid: number;
      readonly version: string;
      readonly startedAt: number;
      readonly attached: boolean;
    };

/**
 * 연결 화면이 읽는 host 상태. `host.status` 결과와 다시 시작 대기 값이다. `remoteAllowRespond`는 원격 응답 허용 값이고,
 * 엔진이 그 설정을 알리지 않으면(카탈로그에 없으면) `null`이다. `service`는 이 기기의 서비스 상태다.
 */
export interface ConnectionSnapshot {
  readonly host: WireResult<"host.status">;
  readonly service: ServiceCard;
  /** 서비스 모드를 켜 두었지만 엔진을 다시 시작해야 켜진다(`settings.get`의 `pendingUntil: "restart"`). 예약 화면과 같은 근거다 */
  readonly restartPending: boolean;
  readonly remoteAllowRespond: boolean | null;
}

/** 원격 대상 목록을 읽거나 쓰지 못했다(로컬 설정 파일) */
export type TargetStoreError = { readonly kind: "storage" };

/**
 * 로그인 자동 시작을 읽거나 바꾸지 못했다. `code`는 셸이 준 닫힌 오류 코드다(`autostart_failed`, `bad-request`). 그 밖의 실패와
 * 모양이 틀린 답은 `unknown`이다. 등록 파일의 경로와 토큰은 어디에도 싣지 않는다.
 */
export interface AutostartError {
  readonly code: "autostart_failed" | "bad-request" | "unknown";
}

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
  /** `host.clients`(W-12): 열린 연결의 목록. 연결이 없으면 `offline`, 엔진이 이 메서드를 모르면 `unsupported`다 */
  clients(): Promise<Result<readonly HostClientView[], CommandError>>;
  /**
   * 서비스 모드를 켜거나 끈다(`settings.set`, 사용자 범위). 엔진 대상이 이 기기면 서비스를 켜거나 끈 뒤 엔진을 다시 띄워 바로 적용한다.
   * 원격 대상이면 설정만 쓴다. 켜지 못하면 설정을 꺼짐으로 되돌리고 `service` 오류를 준다.
   */
  setServiceMode(enabled: boolean): Promise<Result<null, CommandError>>;
  /** 이 기기의 서비스를 켠다(`setServiceMode(true)`와 같다). 카드의 시작 단추가 부른다 */
  startLocalService(): Promise<Result<null, CommandError>>;
  /** 이 기기의 서비스를 멈춘다(`setServiceMode(false)`와 같다). 엔진은 앱 안의 사이드카로 다시 뜬다 */
  stopLocalService(): Promise<Result<null, CommandError>>;
  /** 이 기기의 로그인 자동 시작 상태(`service_status`의 `autostart`). 서비스가 떠 있지 않아도 읽는다 */
  serviceAutostart(): Promise<Result<ServiceAutostart, AutostartError>>;
  /**
   * 로그인 자동 시작을 켜거나 끈다(`service_autostart_set`). 켜기 동의는 호출하는 화면이 받는다. 답의 `lingerAdvice`는
   * Linux에서 서비스를 로그아웃 뒤에도 두려면 `loginctl enable-linger`가 필요하다는 뜻이다.
   */
  setServiceAutostart(
    enabled: boolean,
  ): Promise<Result<{ readonly lingerAdvice: boolean }, AutostartError>>;
  /** 원격 연결에서 승인 요청에 답하는 것을 허락할지 바꾼다(`settings.set`, 사용자 범위). 바로 적용된다 */
  setRemoteRespond(enabled: boolean): Promise<Result<null, CommandError>>;
  /** 원격 서비스를 협조 종료한다(`host.shutdown`). 받아들여졌으면 `true`다. 이 기기의 서비스는 `stopLocalService`다 */
  stopService(): Promise<Result<boolean, CommandError>>;
}

/** 첫 실행 화면의 기본 그룹(L4.desktop-ux §6.5). 켜기 키는 `ext.<그룹>.enabled`(X 로더 예약 키)다 */
export type DefaultGroupId = "helm" | "learning";

/** 기본 그룹의 켜짐 값과 안전 모드 여부. `enabled`의 null은 설정 값을 쓴 적이 없다는 뜻이다(기본값은 화면 모델이 정한다) */
export interface GroupsSnapshot {
  readonly enabled: Readonly<Record<DefaultGroupId, boolean | null>>;
  /** 안전 모드로 떠 있으면 참(`host.status.safeMode`). 그룹은 실리지 않는다 */
  readonly safeMode: boolean;
}

/** 안전 모드의 원인(`host.status.safeModeCause`). user: 사용자가 켰다, startupFailures: 연속 시작 실패, flag: 실행 인자 */
export type SafeModeCause = "user" | "startupFailures" | "flag";

/**
 * 안전 모드 상태(`host.status`, W-35·W-39). 값이 없으면 거짓, null, 0이다. `suggest`는 연속 시작 실패가 제안 기준에 닿았다는 뜻이다.
 * 엔진이 running이 되면 한 번 읽는다(`safe-mode-provider.tsx`). 읽지 못하면 화면은 아무것도 그리지 않는다.
 */
export interface SafeModeSnapshot {
  readonly active: boolean;
  readonly cause: SafeModeCause | null;
  readonly startupFailures: number;
  readonly suggest: boolean;
}

/**
 * 호스트가 알리는 것(`host.status`의 `settingsProblems`와 `startupNotices`, F wire §3.3.1). 문제가 없으면 빈 목록이다.
 * 엔진이 running이 되고 연결이 열리면 한 번 읽고, `settings.invalidated`를 받으면 다시 읽는다(`host-notices-provider.tsx`).
 * 읽지 못하면 화면은 아무것도 그리지 않는다. `startupNotices`는 이번 시작에서 저장소가 알린 일이다(0바이트 DB를 옮긴 일 등).
 */
export interface HostNoticesSnapshot {
  readonly settingsProblems: readonly SettingsFileProblem[];
  readonly startupNotices: readonly StartupNotice[];
}

/** 검색 권장 단계의 값: 웹 provider 상태(`web.providers`)와 "나중에"를 이미 눌렀는지(데스크톱 로컬 설정) */
export interface SearchSnapshot {
  readonly web: ToolsWebView;
  readonly dismissed: boolean;
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
  /** 기본 그룹 두 개의 켜짐 값(`settings.get`)과 안전 모드(`host.status`)를 읽는다 */
  loadGroups(): Promise<Result<GroupsSnapshot, CommandError>>;
  /** 안전 모드 상태를 읽는다(`host.status`의 `safeMode`, `safeModeCause`, `startupFailures`, `suggestSafeMode`) */
  loadSafeMode(): Promise<Result<SafeModeSnapshot, CommandError>>;
  /** 호스트 알림을 읽는다(`host.status`의 `settingsProblems`). 읽지 못한 설정 파일이 없으면 빈 목록이다 */
  loadHostNotices(): Promise<Result<HostNoticesSnapshot, CommandError>>;
  /** 기본 그룹 하나를 켜거나 끈다(`settings.set { key: "ext.<그룹>.enabled", scope: "user" }`). 적용은 다음 단계 경계다 */
  setGroupEnabled(group: DefaultGroupId, enabled: boolean): Promise<Result<null, CommandError>>;
  /** 검색 권장을 읽는다(`web.providers`와 "나중에" 값) */
  loadSearch(): Promise<Result<SearchSnapshot, CommandError>>;
  /** 검색 권장을 "나중에"로 닫는다(데스크톱 로컬 설정 `l4.desktop.firstRun.searchHintDismissed`) */
  dismissSearchHint(): Promise<Result<null, CommandError>>;
  /** `settings.invalidated`를 받으면 부른다. 반환값은 구독 해제 */
  onInvalidated(listener: () => void): () => void;
  /** 키와 상관없이 `settings.invalidated`를 받으면 부른다(설정 파일 문제 띠가 파일이 고쳐진 것을 따라간다). 반환값은 구독 해제 */
  onAnyInvalidated(listener: () => void): () => void;
}

/**
 * 도구와 웹 화면(P-12). `providers`는 `web.providers` 결과를 화면 값으로 바꾼 것이고, `setOrder`는 `orderUpdateOf`가 검사한
 * 순서를 `settings.set` 한 번으로 쓴다. 둘 다 거울에 넣지 않는다(FS-03).
 */
export interface WebCommands {
  providers(): Promise<Result<ToolsWebView, CommandError>>;
  setOrder(update: OrderUpdate): Promise<Result<null, CommandError>>;
}

/**
 * "MCP 서버" 구역(W-15). `servers`와 `serverAction`은 wire 값을 그대로 돌려주고 거울에 넣지 않는다.
 * 서버 정의의 쓰기는 설정 파일 명령(`settings.readFile`·`writeFile { baseSha256 }`)이다. 화면이 읽고 한 서버만 고쳐 쓴다.
 */
export interface McpCommands {
  servers(): Promise<Result<readonly McpServerRow[], CommandError>>;
  serverAction(
    server: string,
    action: McpServerAction,
  ): Promise<Result<McpServerRow, CommandError>>;
}

/**
 * 설정 화면(P-09)의 컨트롤러. 연결이 없어도 준다(엔진 원천 항목은 빠지고 로컬 원천 항목은 쓸 수 있다). 컨트롤러는 연결마다 새로 만들고, 화면이 `dispose()`로 놓는다.
 * 읽기·쓰기·알림의 판정은 `@fresnel/client/settings`가 하고, 이 명령은 연결과 현재 대화만 잇는다(`app/settings.ts`).
 */
export interface SettingsCommands {
  open(): SettingsController;
  /** `settings.readFile`(파일 편집기). 범위가 `user`이면 대화를 보내지 않는다. 연결이 없으면 `offline`이다 */
  readFile(target: SettingsReadTarget): Promise<Result<SettingsReadFileResult, CommandError>>;
  /** `settings.writeFile`(파일 편집기). 읽은 뒤 파일이 바뀌었으면 `conflict`(3107)다 */
  writeFile(write: SettingsFileWrite): Promise<Result<SettingsWriteFileResult, SettingsWriteError>>;
}

/** 파일을 읽는 범위와 대화. 읽기는 관리 정책(`managed`)도 받는다(개요의 설정 파일 경로 목록) */
export interface SettingsReadTarget {
  readonly scope: SettingsFileScope;
  readonly threadId: ThreadId | null;
}

/** 파일 편집기가 고르는 범위와 대화. `project`와 `local`은 대화의 작업 폴더를 쓴다 */
export interface SettingsFileTarget {
  readonly scope: SettingsWritableFileScope;
  readonly threadId: ThreadId | null;
}

/** 파일 전체를 바꾸는 요청. `baseSha256`은 읽었을 때의 해시이고, 파일이 없었으면 `null`이다 */
export interface SettingsFileWrite extends SettingsFileTarget {
  readonly text: string;
  readonly baseSha256: string | null;
}

/** 파일 쓰기의 오류. 충돌은 화면이 다시 읽기로 맞추므로 따로 둔다 */
export type SettingsWriteError = CommandError | { readonly kind: "conflict" };

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
  /** `secret.audit`. 사용·거절 기록을 최근 순으로 전부 읽는다(개수 상한 없음). 값은 오지 않는다 */
  audit(name: SecretName): Promise<Result<SecretAuditResult, SecretCommandError>>;
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

/**
 * 데이터 복원이 되돌리지 못한 까닭. `kind`로 화면이 대응을 고르고, `message`는 화면에 보일 문장이다.
 * `fix`는 해결 한 줄이고, 셸이 그 문장을 주지 않으면 `null`이다.
 */
export type RestoreRefusalKind =
  /** 고른 폴더가 `fresnel db export`의 백업 폴더가 아니다(종료 코드 2) */
  | "not_a_backup"
  /** 백업이 이 빌드보다 새 버전이 만든 것이다 */
  | "future_version"
  /** 실행 중인 엔진이 데이터베이스를 쓰고 있다 */
  | "engine_running"
  /** 백업이 깨졌거나 Fresnel 데이터베이스가 아니다 */
  | "invalid"
  /** 입출력 오류, 디스크 가득 참, 그 밖의 실패 */
  | "io"
  /** 엔진 대상이 이 기기가 아니어서 셸이 거절했다 */
  | "remote"
  /** 다른 복원이 이미 진행 중이다 */
  | "busy";

export interface RestoreRefusal {
  readonly kind: RestoreRefusalKind;
  readonly message: string;
  readonly fix: string | null;
}

/**
 * 데이터 복원(P-09 고급 탭, `db_restore`). 되돌렸으면 `ok`이고 보고서를 준다. 되돌리지 못했으면 이유를 `error`로 준다.
 * 이 명령은 wire를 지나지 않으므로 연결 여부와 관계없이 셸을 바로 부른다. 복원 중에도 대화 쓰기는 셸 쪽에서 막힌다.
 */
export interface RestoreCommands {
  /** 이 앱이 셸에 마지막으로 보낸 엔진 대상. 바꾼 적이 없으면 `null`이다(모름). 원격이면 복원을 막는다 */
  engineTarget(): EngineTarget | null;
  run(backupDir: string): Promise<Result<RestoreReport, RestoreRefusal>>;
}

/**
 * 저장 공간 명령이 실패한 까닭. `kind`로 화면이 대응을 고르고, `message`는 화면에 보일 문장이다.
 * `fix`는 해결 한 줄이고, CLI가 그 줄을 주지 않으면 `null`이다.
 */
export interface StorageFailure {
  readonly kind:
    /** 고른 폴더나 사본 이름이 이 명령에 맞지 않는다(종료 코드 2) */
    | "usage"
    /** 디스크, 권한 등 환경 문제(종료 코드 3과 그 밖의 값) */
    | "environment"
    /** 확인하지 않아 멈췄다(종료 코드 1) */
    | "declined"
    /** 셸이 명령을 거절했다 */
    | "shell"
    /** 셸이 알 수 없는 모양을 돌려줬다 */
    | "bad_reply";
  readonly message: string;
  readonly fix: string | null;
}

/**
 * 설정 고급 탭의 저장 공간 명령(백업 만들기, 사용량 보기, 복원 전 사본 지우기, 데이터 폴더 열기).
 * 셸이 `fresnel db export|usage|previous-rm`을 엔진 없이 한 번 돌린다. wire를 지나지 않으므로 연결과 관계없이 셸을 바로 부른다.
 */
export interface StorageCommands {
  /** 이 앱이 셸에 마지막으로 보낸 엔진 대상. 바꾼 적이 없으면 `null`이다(모름) */
  engineTarget(): EngineTarget | null;
  /** 데이터 폴더의 사용량과 복원 전 사본 목록 */
  usage(): Promise<Result<StorageUsage, StorageFailure>>;
  /** 고른 폴더 아래에 백업 폴더를 새로 만든다. 만든 폴더 보고서를 준다 */
  backup(parentDir: string): Promise<Result<BackupReport, StorageFailure>>;
  /** 복원 전 사본 하나를 지운다. 이름은 `usage`가 준 것이다 */
  removePrevious(name: string): Promise<Result<PreviousRemoved, StorageFailure>>;
  /** 데이터 폴더를 파일 관리자로 연다. 열었으면 `true`다 */
  openDataDir(): Promise<boolean>;
}

/** 성능 측정 화면(P-20, §6.27). 측정 저장소 읽기만 한다. 측정이 꺼져 있으면 `enabled`가 거짓이다 */
export interface MeasureCommands {
  /** `measure.turn`: 한 Turn의 측정 행(Turn, 호출, 훅, 요청 구성, 캐시 사건) */
  turn(threadId: string, turnId: string): Promise<Result<MeasureTurnResult, CommandError>>;
  /** `measure.daily`: 종류와 지표 하나의 일별 집계 */
  daily(kind: string, metric: string): Promise<Result<MeasureDailyResult, CommandError>>;
  /** `group.promotion`: 승격 보고(읽기 전용). 대화가 없으면 인자 없이 보내 호스트가 가장 최근 대화를 고른다 */
  promotion(threadId: string | null): Promise<Result<WireResult<"group.promotion">, CommandError>>;
}

export interface WorkbenchCommands {
  /**
   * `ext.list`. `threadId`가 없으면 전역 값이다. 있으면 그 대화에서의 Registration 상태(`registration`, `plugins[].thread`)를 더한다
   * (런타임 탭의 "이 대화의 그룹과 확장").
   */
  list(threadId?: ThreadId): Promise<Result<readonly ExtListEntry[], CommandError>>;
  /**
   * 확장 목록이 바뀌었을 수 있으면 부른다: 확장 설정 키(`ext.`)가 바뀐 `settings.invalidated`, 자동 끄기 기록(내구 `scope.changed`).
   * 알림의 값은 싣지 않는다(다시 읽는 신호일 뿐). 반환값은 구독 해제
   */
  onChanged(listener: () => void): () => void;
  /** `ext.installPreview`: 폴더의 이름, 버전, 요청 권한을 디스크에 쓰지 않고 읽는다(Q9) */
  installPreview(source: string): Promise<Result<InstallPreview, CommandError>>;
  /** `ext.install`: 미리 보기에서 본 해시(`sha256`)와 같은 내용일 때만 설치한다 */
  install(source: string, sha256: string): Promise<Result<ExtInstallResult, CommandError>>;
  /**
   * `ext.remove { name, dropData? }`: 설치본 폴더를 지우고 로더에서 내린다. `now`이면 목록에서 바로 빠진다.
   * `dropData`는 참일 때만 싣는다(그 확장의 저장 테이블도 지운다)
   */
  remove(
    name: string,
    options?: { readonly dropData?: boolean },
  ): Promise<Result<ExtRemoveResult, CommandError>>;
  /** `ext.removePreview { name }`: 지우기 확인에 보일 저장 테이블과 행 수. 아무것도 바꾸지 않는다 */
  removePreview(name: string): Promise<Result<WireResult<"ext.removePreview">, CommandError>>;
  /** `ext.bindings { threadId? }`: 기능 id마다 지금 바인딩된 공급자, 받는 확장, 미충족 */
  bindings(threadId?: ThreadId): Promise<Result<ExtBindingsResult, CommandError>>;
  /** `ext.reload { name }`: 설치한 판으로 실행 중인 확장을 다음 단계 경계에서 바꾼다. 거절이면 옛 판이 그대로 돈다 */
  reload(name: string): Promise<Result<null, CommandError>>;
  /** `ext.get`: 매니페스트 훅·기능 바인딩·진단 */
  get(name: string): Promise<Result<ExtGetResult, CommandError>>;
  /** `group.list { threadId }`: 그룹마다 켜짐 요청 중인지(`pendingToggle`)와 drive 역할(`drive`) */
  groups(threadId: ThreadId): Promise<Result<readonly GroupStatusWire[], CommandError>>;
  /** `group.driveLock { threadId }`: 대화의 drive 락(보유, 차수, 상한과 사용량, 후보별 대기) */
  driveLock(threadId: ThreadId): Promise<Result<GroupDriveLockResult, CommandError>>;
  /** `ext.timings`: 훅마다 p50·p95와 실패 수. 계측이 꺼져 있으면 `traceEnabled`가 거짓이다 */
  timings(name: string, threadId?: ThreadId): Promise<Result<ExtTimingsResult, CommandError>>;
  /** `settings.explain { key, threadId }`: 설정 값, 이긴 범위, 그 값을 쓴 쪽(읽기만) */
  explain(key: string, threadId: ThreadId): Promise<Result<SettingsExplainResult, CommandError>>;
  /** 켜기·끄기: `settings.set { key: "ext.<이름>.enabled", scope: "user" }` */
  toggle(request: ToggleRequest): Promise<Result<null, CommandError>>;
  /** 자동 꺼짐 다시 켜기와 "켜 두기" 답: `settings.set { key: "ext.<이름>.enabled", value: true, scope: "user" }` 뒤 `ext.reenable { name }`. 적용은 다음 단계 경계다 */
  reenable(name: string): Promise<Result<null, CommandError>>;
  /** "끄기" 답: `settings.set { key: "ext.<이름>.enabled", value: false, scope: "user" }` 뒤 `ext.disableConfirm { name }`. 설정 쓰기가 실패하면 끄기를 보내지 않는다 */
  keepOff(name: string): Promise<Result<null, CommandError>>;
  /** 이 대화에서 켜기·끄기: `settings.set { key: "ext.<이름>.enabled", scope: "launch", threadId }`. 적용은 다음 단계 경계다 */
  toggleForThread(request: ThreadToggleRequest): Promise<Result<null, CommandError>>;
  /** `profile.list`: 저장된 프로필 목록 */
  profiles(): Promise<Result<readonly Profile[], CommandError>>;
  /** `profile.apply { id, threadId, layer: "thread" }`: 프로필을 이 대화에 쓴다. 결과는 쓴 키와 적용 시점이다 */
  applyProfile(id: string, threadId: ThreadId): Promise<Result<ProfileApplyResult, CommandError>>;
  /** `profile.put { profile, baseRev }`: 프로필 저장. 처음 만들면 `baseRev`는 null이고, 저장된 `rev`와 다르면 `settings.conflict`로 거절된다 */
  putProfile(
    profile: ProfileInput,
    baseRev: number | null,
  ): Promise<Result<ProfileGetResult, CommandError>>;
  /** `profile.delete { id }`: 프로필 삭제. 결과는 목록 개정이다 */
  deleteProfile(id: string): Promise<Result<number, CommandError>>;
  /** `profile.preview { id, threadId? }`(W-44): 적용했다면 어떻게 되는지 계산한다. 쓰지 않는다 */
  previewProfile(
    id: string,
    threadId?: ThreadId,
  ): Promise<Result<ProfilePreviewResult, CommandError>>;
  /** `ext.validateComposition { composition }`(W-47): 구성 선언 검사. 이슈 목록은 비어 있으면 통과다 */
  validateComposition(
    composition: CompositionDecl,
  ): Promise<Result<ExtValidateResult, CommandError>>;
  /** `ext.kinds`: 새 그룹의 시작점이 되는 종류 카탈로그 */
  kinds(): Promise<Result<readonly KindEntry[], CommandError>>;
  /** `ext.scaffold`: 대상 폴더에 뼈대를 만든다. 이름·폴더 거절은 `rejected`다 */
  scaffold(input: ScaffoldInput): Promise<Result<ScaffoldResult, CommandError>>;
  /** `ext.validate { dir }`: 폴더의 매니페스트와 AU 규칙 검사. 오류가 없으면 `ok`가 참이다 */
  validateDir(dir: string): Promise<Result<ExtValidateDirResult, CommandError>>;
  /** `ext.package { dir, out? }`: 설치 묶음을 만든다. `out`이 있으면 그 폴더(없거나 비어 있어야 한다)에 만든다(확장 상세의 "내보내기") */
  packDir(dir: string, out?: string): Promise<Result<PackResult, CommandError>>;
  versions(name: string): Promise<Result<ExtVersionsResult, CommandError>>;
  /** 되돌리기. `restart`면 다음 시작에 적용된다(HS-108) */
  rollback(
    name: string,
    version: string,
    clearState: boolean,
  ): Promise<Result<"nextStepBoundary" | "restart", CommandError>>;
  /** `ext.health`(모든 확장). 실패 장부 배열 */
  health(): Promise<Result<readonly ExtHealthEntry[], CommandError>>;
  /**
   * `hooks.list`: 훅마다 핸들러의 기본 순서(`order` 행)를 포함한다. `threadId`를 주면 그 대화의 작업 폴더·로컬 훅도 든다
   * (폴더를 신뢰하지 않았으면 그 훅은 목록에 없다). 생략하면 사용자·관리 범위만이다
   */
  hooks(threadId?: string): Promise<Result<readonly HookEntry[], CommandError>>;
  /**
   * 외부 훅 "끄기" 답: `hooks.disableConfirm { hook }`. 호스트가 꺼짐을 설정에 먼저 쓰므로 화면은 설정을 쓰지 않는다.
   * 없는 훅이면 `hooks.notFound`로 거절된다
   */
  hookKeepOff(hook: string): Promise<Result<null, CommandError>>;
  /** 외부 훅 "켜 두기"와 "다시 켜기" 답: `hooks.reenable { hook }` */
  hookReenable(hook: string): Promise<Result<null, CommandError>>;
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
  /**
   * 확장 설정(P-17 설정 탭): `settings.list`를 확장 접두사마다 한 번씩 부르고, 정의가 있으면 `settings.get`으로 유효 값을 읽는다.
   * `threadId`가 있으면 그 대화에서의 값이다(범위 `launch`는 이 대화만 덮는다). 줄 만들기와 범위 이름은 클라이언트가 한다.
   */
  settings(name: string, threadId?: ThreadId): Promise<Result<ExtSettingsRead, CommandError>>;
  /** `group.metrics { id, threadId? }`: 그룹 하나의 계측. 계측이 꺼져 있으면 `metrics`가 null이다 */
  metrics(id: string, threadId?: ThreadId): Promise<Result<GroupMetricsResult, CommandError>>;
  /** `ext.ui.list`(옛 이름 `ext.view.list`): 확장이 기여한 화면 항목 전부. 확장마다 거르는 일은 화면이 한다 */
  views(): Promise<Result<readonly ExtUiEntry[], CommandError>>;
}

/** 확장 설정 읽기 결과: 접두사별로 모은 정의와 유효 값 */
interface ExtSettingsRead {
  readonly defs: readonly SettingDefWire[];
  readonly values: readonly EffectiveSetting[];
}

interface PluginUiCommands {
  withConnection<T>(
    run: (connection: HostConnection) => Promise<T>,
  ): Promise<Result<T, CommandError>>;
  /** 지금 연결. 재연결 뒤에는 새 연결이다. 화면이 연결을 붙잡고 있으면 낡은 연결로 요청이 간다. 없으면 null */
  current(): HostConnection | null;
}

/**
 * 알림(P-03 받은 요청의 알림 묶음). 목록은 요청 결과라 거울에 넣지 않는다(FS-03). `onDelivered`는 연결이 바뀌면 끊기므로
 * 부르는 부품이 연결 상태가 바뀔 때 다시 건다.
 */
interface NoticeCommands {
  /** `notify.list { afterSeq: 0 }`: 지금까지 쌓인 알림. 대화를 주면 그 대화의 알림만(결과에는 대화가 없어 이 호출로 알림의 대화를 안다) */
  list(threadId?: ThreadId): Promise<Result<WireResult<"notify.list">, CommandError>>;
  /** `notify.delivered` 알림마다 `listener`를 부른다. 반환값은 구독 해제 */
  onDelivered(listener: (delivered: NotifyDeliveredParams) => void): () => void;
}

export interface Commands {
  selectThread(threadId: ThreadId): void;
  /** `workspace`는 작업 폴더(절대 경로)이고 `thread.create`로 그대로 보낸다. 없으면 폴더 없는 대화다(G2-02) */
  createThread(workspace?: string): Promise<Result<null, CommandError>>;
  /** requestId는 같은 입력의 재시도가 같은 값을 쓰도록 호출자가 만든다(spec 4.13) */
  /** `attachments`는 `addAttachment`가 돌려준 입력 파트다. 있으면 슬래시 명령으로 풀지 않고 글과 함께 대화 입력으로 보낸다 */
  /** `whenBusy`는 실행 중일 때 입력이 들어갈 자리다. 생략하면 `followUp`(끝난 뒤)이다 */
  sendTurn(
    threadId: ThreadId,
    text: string,
    requestId: string,
    attachments?: AttachmentParts,
    whenBusy?: BusyInputMode,
  ): Promise<Result<null, CommandError>>;
  /** `attachments.add`: 첨부 하나를 엔진에 올리고 입력 파트를 받는다. 쓰기 소유를 얻지 않는다 */
  addAttachment(
    threadId: ThreadId,
    source: WireParams<"attachments.add">["source"],
  ): Promise<Result<WireResult<"attachments.add">, CommandError>>;
  /** 첨부 하나의 크기 상한(`l2.dialog.attachments.maxBytes`, 호스트 값). 읽지 못하면 `null`이고 엔진이 올릴 때 판정한다 */
  attachmentLimit(): Promise<number | null>;
  /** 요약 뒤에도 그대로 두는 최근 토큰 수(`l1.context.keepRecentTokens`, 호스트 값). 이보다 적게 쌓인 대화는 요약할 것이 없다. 읽지 못하면 `null` */
  compactKeepTokens(): Promise<number | null>;
  interrupt(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /**
   * `turn.withdraw`(W-17): 큐에 넣고 아직 배치되지 않은 입력을 요청 키로 거둔다. 거둬졌으면 `true`, 찾지 못했거나 이미 배치됐으면 `false`다.
   * 쓰기 소유자만 한다(`interrupt`와 같다). 잠겨 있으면 `locked`이고 잠김 대화 상자를 띄운다.
   */
  withdrawInput(threadId: ThreadId, requestId: string): Promise<Result<boolean, CommandError>>;
  /** `thread.compact`: 지금 대화를 요약한다(수동 컴팩션). 요약할 것이 없으면 결과가 `skipped`로 와서 오류가 아니다 */
  compactThread(
    threadId: ThreadId,
    instructions?: string,
  ): Promise<Result<WireResult<"thread.compact">, CommandError>>;
  /** `thread.rename`: 대화 제목을 바꾼다. 목록 제목은 `thread.updated` 이벤트가 거울에 넣는다 */
  renameThread(threadId: ThreadId, title: string): Promise<Result<null, CommandError>>;
  /**
   * `thread.setModel`: 대화가 다음 turn부터 쓸 모델(`provider/id`)을 정한다. null이면 지정을 거두고 기본 모델로 돌아간다.
   * 값은 `thread.updated` 이벤트가 거울의 대화 요약(`ThreadSummary.model`)에 넣는다. 카탈로그에 없는 모델은 host가 거절한다
   */
  setThreadModel(threadId: ThreadId, model: string | null): Promise<Result<null, CommandError>>;
  /**
   * `settings.set { key: "l1.tools.permissionMode", scope: "launch", threadId }`: 이 대화의 권한 모드를 정한다(세션 범위 값이라 대화마다 따로).
   * 같은 값을 `ToolService.setMode`가 쓰는 세션 층에 쓰므로 `mode(threadId)`가 그 값을 읽는다. 쓰기 소유를 요구하므로 잠기면 `locked`다
   */
  setThreadMode(threadId: ThreadId, mode: SwitchMode): Promise<Result<null, CommandError>>;
  /** `settings.get { keys: ["l1.tools.permissionMode"], threadId }`의 값을 검사 없이 돌려준다. 네 모드인지는 `permissionModeOf`가 본다 */
  readThreadMode(threadId: ThreadId): Promise<Result<unknown, CommandError>>;
  /**
   * 이 대화의 권한 모드가 바뀌었을 수 있으면 부른다. 설정 쓰기는 `settings.invalidated`, 계획 승인처럼 호스트 안에서 쓴 세션 값은
   * `events.batch`의 `settings.changed` 기록으로 온다. 반환값은 구독 해제
   */
  onThreadModeChanged(threadId: ThreadId, listener: () => void): () => void;
  /**
   * `settings.set { key: "l1.models.thinkingLevel", scope: "launch", threadId }`: 이 대화의 추론 레벨을 정한다(세션 범위 값이라 대화마다 따로, 다음 turn부터).
   * 쓰기 소유를 요구하므로 잠기면 `locked`다
   */
  setThreadThinking(
    threadId: ThreadId,
    level: ModelThinkingLevel,
  ): Promise<Result<null, CommandError>>;
  /** `settings.get { keys: ["l1.models.thinkingLevel"], threadId }`의 값을 검사 없이 돌려준다. 알려진 레벨인지는 `thinkingLevelOf`가 본다 */
  readThreadThinking(threadId: ThreadId): Promise<Result<unknown, CommandError>>;
  /** 이 대화의 추론 레벨이 바뀌었을 수 있으면 부른다(`settings.invalidated`). 반환값은 구독 해제 */
  onThreadThinkingChanged(threadId: ThreadId, listener: () => void): () => void;
  /** `models.list`: 대화가 고를 수 있는 모델(문맥 창 포함). 요청 결과라 거울에 넣지 않는다(FS-03) */
  listModels(): Promise<Result<WireResult<"models.list">, CommandError>>;
  /** `thread.close`: 대화를 닫는다(열린 turn이 있으면 host가 `turn_running`으로 거절한다). 닫힘 표시는 `thread.closed` 이벤트가 한다 */
  closeThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /** `thread.delete`: 대화를 지운다. 성공하면 목록을 다시 읽고, 열려 있던 대화였다면 선택을 푼다 */
  deleteThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /**
   * `thread.export`를 쪽마다 끝까지 불러 한 문서로 이어 붙인다. 읽기라 쓰기 소유와 쓰기 보류(`switching`)와 무관하다.
   * 파일로 쓰는 일은 대화 내보내기 대화 상자가 `saveExport`로 한다.
   */
  exportThread(
    threadId: ThreadId,
    format: ExportFormat,
  ): Promise<Result<ExportDocument, CommandError>>;
  /** `turn.resume`: 멈춘 턴을 이어서 실행한다 */
  resumeTurn(threadId: ThreadId): Promise<Result<WireResult<"turn.resume">, CommandError>>;
  /**
   * 슬래시 명령 줄 하나를 `command.run`으로 보낸다. 대화 입력으로는 보내지 않는다(명령이 없으면 `not_command`로 온다).
   * 명령이 적용됐는지는 결과의 `status`가 `done`인지로 본다. 명령 팔레트의 탐구 시작·멈춤이 쓴다.
   */
  runCommandLine(
    threadId: ThreadId,
    text: string,
  ): Promise<Result<WireResult<"command.run">, CommandError>>;
  /** 명령 팔레트의 명령별 실행 횟수(로컬 설정). 저장한 적이 없으면 빈 객체다 */
  paletteUses(): PaletteUses;
  /** 명령 팔레트의 실행 횟수를 저장한다. 저장하지 못하면 `false`다 */
  savePaletteUses(uses: PaletteUses): Promise<boolean>;
  /** 마지막에 보던 대화 id(로컬 설정). 없으면 null */
  lastThreadId(): string | null;
  /** 보던 대화를 저장한다. 보던 대화가 없으면 null. 저장하지 못하면 `false`다 */
  saveLastThread(threadId: string | null): Promise<boolean>;
  /**
   * 입력창이 `/`로 시작하는 줄을 슬래시 명령으로 보냈을 때(`sendTurn`) 호스트가 셸 주입 실행에 사람 확인을 요구했다. 이 호출이 같은 줄을
   * `confirmShell: true`로 다시 보낸다. 확인 대기가 없으면 아무 일도 하지 않는다.
   */
  confirmShell(): Promise<Result<null, CommandError>>;
  /** 셸 주입 확인을 거절한다. 아무것도 실행하지 않는다 */
  cancelShell(): void;
  /** 동작 명령이 낸 출력(`UiState.commandOutput`)을 닫는다 */
  dismissCommandOutput(): void;
  /** 글을 클립보드에 쓴다. 쓰면 `true`다(결과 시트의 복사) */
  copyText(text: string): Promise<boolean>;
  /** 엔진에 등록한 슬래시 명령 목록(`command.list`)을 목록·자동완성 view-model로 돌려준다. `threadId`를 주면 그 대화의 프로젝트 명령도 싣는다 */
  commandList(threadId: ThreadId | null): Promise<Result<readonly CommandRowVM[], CommandError>>;
  /** 보류 중이면 응답을 보내지 않고 카드에 `switching` 실패 표시를 둔다(보내는 중 표시는 켜지 않는다) */
  respondApproval(approvalId: EventId, response: ApprovalDecision): Promise<void>;
  /**
   * 승인을 대기열에서 뺀다. host가 모르는 승인(`gone`)을 카드에서 지울 때 쓴다. 거울에서 지우고 카드의 응답 표시도 지운다.
   * 연결과 무관하게 바로 된다(host에 보내지 않는다).
   */
  dismissApproval(approvalId: EventId): void;
  /**
   * 엔진 대상을 바꾼다(W-08, `engine_retarget`). 바꾸는 동안 쓰기 명령(`sendTurn`, `interrupt`, `withdrawInput`, `respondApproval`, `createThread`,
   * `forkThread`, `trust.decide`)은 `switching`으로 거절한다. 옛 엔진이 `shutdownGraceMs`까지 쓰기를 받을 수 있어서다.
   * `graceMs`는 `l4.desktop.engine.shutdownGraceMs`.
   */
  retargetEngine(target: EngineTarget, graceMs: number): Promise<Result<null, CommandError>>;
  readonly trust: TrustCommands;
  readonly workspace: WorkspaceCommands;
  readonly setup: SetupCommands;
  /** 크래프트(`workbench`)의 확장 읽기·켜기·되돌리기 */
  readonly workbench: WorkbenchCommands;
  /** 테스트 화면(P-19)의 시험 목록, 실행, Test run 제어 */
  readonly tests: TestCommands;
  /** 성능 측정 화면(P-20)의 측정 읽기 */
  readonly measure: MeasureCommands;
  readonly schedule: ScheduleCommands;
  /** 플러그인 화면 실행 맥락이 쓰는 연결 한 번. 연결이 없으면 `offline`이다 */
  readonly pluginUi: PluginUiCommands;
  readonly connection: ConnectionCommands;
  /** 원격 접속(서버 모드) 명령. 실제 연결(`remoteAdapterOf`)로 보낸다. 옛 서비스는 `unsupported`다 */
  readonly remote: RemoteAdapter;
  readonly secrets: SecretCommands;
  /** 설정 고급 탭의 데이터 복원(`db_restore`) */
  readonly restore: RestoreCommands;
  /** 설정 고급 탭의 백업 만들기, 저장 공간 보기, 복원 전 사본 지우기, 데이터 폴더 열기 */
  readonly storage: StorageCommands;
  readonly settings: SettingsCommands;
  readonly web: WebCommands;
  /** "MCP 서버" 구역(W-15): 서버 목록, 다시 시작과 항상 끄기와 풀기, 사용자 범위 서버 표 쓰기 */
  readonly mcp: McpCommands;
  readonly proposals: ProposalCommands;
  readonly work: WorkCommands;
  readonly review: ReviewCommands;
  /** 제안 화면의 충돌 스킬 본문(W-14). 읽기 한 번이다 */
  readonly skills: SkillCommands;
  /** 설정 "대화와 컨텍스트" 탭의 기억 구역(W-19) */
  readonly memory: MemoryCommands;
  readonly usage: UsageCommands;
  readonly notices: NoticeCommands;
  /** `thread.locked` 대화 상자의 "관찰만" 선택. 성공하면 그 thread의 입력창이 잠긴다 */
  observeThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  /** 같은 대화를 분기해 새 thread로 이어 쓴다. 성공하면 새 thread를 연다 */
  forkThread(threadId: ThreadId): Promise<Result<null, CommandError>>;
  dismissLocked(): void;
  /** 관찰을 끝내고 쓰기를 다시 시도하게 한다 */
  retryWrite(threadId: ThreadId): void;
  showScreen(screen: Screen): void;
  /**
   * 입력창에 초점을 준다(⌘L). `insert`가 글이면 입력창이 비어 있을 때 그 글을 채운다(슬래시 명령 고르기). 입력창이 없으면 입력창이
   * 생길 때 받는다. 입력창은 받으면 `settleComposerRequest`를 부른다.
   */
  requestComposer(insert: string | null): void;
  settleComposerRequest(): void;
  /** 설정 화면을 열고 그 탭과 항목으로 옮긴다(명령 팔레트). 화면이 받으면 `settleSettingsJump`를 부른다 */
  requestSettingsJump(jump: SettingsJump): void;
  settleSettingsJump(): void;
  /** 설정 화면을 열고 그 구역으로 옮긴다("연결" 진입). 구역을 그리는 화면이 받으면 `settleSettingsSection`을 부른다 */
  requestSettingsSection(section: SettingsSection): void;
  settleSettingsSection(): void;
  /** 변경 검토 화면(P-04)을 이 승인으로 연다. 화면 자리는 App이 옮긴다 */
  openReview(target: ReviewTarget): void;
  reloadThreads(): void;
  retryTranscript(): void;
  reconnect(): void;
  /**
   * 엔진을 다시 띄운다. `options`를 생략하면 실패 상태의 "엔진 다시 시작"이다. 살아 있는 엔진은 `confirmed: true`를 줘야 한다.
   * 셸이 받으면 true, 거절하면 false다.
   */
  restartEngine(options?: RestartOptions): Promise<boolean>;
  /** 설치나 되돌리기처럼 다시 시작해야 적용되는 일을 상태 표시줄에 모은다 */
  noteRestartNeeded(reason: RestartReason): void;
  /** 403으로 실패한 모델을 적는다(입력창 모델 고르기가 그 행에 "이 키로 못 써요"를 단다) */
  noteModelDenied(key: string): void;
  /** 턴이 성공한 모델의 403 표시를 지운다 */
  clearModelDenied(key: string): void;
  /** 진단 묶음을 클립보드에 쓴다 */
  copyDiagnostics(): Promise<boolean>;
  /** 앱과 엔진 버전. 엔진은 아직 연결하지 못했으면 `null`이다 */
  versions(): { readonly app: string; readonly engine: string | null };
}

export const CommandsContext: React.Context<Commands | null> = createContext<Commands | null>(null);

export function useCommands(): Commands {
  const commands = useContext(CommandsContext);
  if (commands === null) throw new Bug("CommandsContext provider is missing");
  return commands;
}

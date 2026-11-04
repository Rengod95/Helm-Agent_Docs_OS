import type { EventId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  CompositionDecl,
  ExtTimingsResult,
  TestRunPhaseResult,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import { createContext, useContext } from "react";
import { Bug, type Result } from "@fresnel/contracts";
import type { ScheduleListItem, SecretName } from "@fresnel/contracts/capabilities";
import type { InstallPreview } from "@fresnel/contracts/services";
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
  HostConnection,
  ExtInstallResult,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
  Profile,
  ProfileApplyResult,
  ProfileGetResult,
  ProfileInput,
  ProfilePreviewResult,
  ExtValidateResult,
  SecretListEntry,
  SecretReferencesResult,
  SecretTestResult,
  ExtTestListResult,
  MeasureDailyResult,
  MeasureTurnResult,
  ExtTestRunParams,
  ExtTestRunResult,
  SettingsExplainResult,
  SettingsReadFileResult,
  SettingsWritableFileScope,
  SettingsWriteFileResult,
  TrustChoice,
  TrustStatus,
  WireParams,
  WireResult,
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
import type { LockedOption, ReviewTarget, Screen, SettingsJump } from "../state/ui/index.ts";
import type { EngineTarget, RestoreReport } from "../transport/ipc.ts";
import type { PaletteUses } from "./palette/palette-model.ts";

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
      /** 입력 거절(`jsonrpc.invalidParams`)의 첫 문제 문장. `<종류>: <내용>` 꼴이면 화면이 종류를 가른다 */
      readonly issue?: string;
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
  /** `schedule.list`. 거르기는 인자(`enabled: true`)로 보낸다. 모두는 빈 인자다 */
  list(params: WireParams<"schedule.list">): Promise<Result<ScheduleSnapshot, CommandError>>;
  create(
    params: WireParams<"schedule.create">,
  ): Promise<Result<WireResult<"schedule.create">, CommandError>>;
  cancel(scheduleId: string): Promise<Result<WireResult<"schedule.cancel">, CommandError>>;
  fire(scheduleId: string): Promise<Result<WireResult<"schedule.fire">, CommandError>>;
  /** 서비스 모드를 켠다(`settings.set`, 사용자 범위) */
  enableService(): Promise<Result<null, CommandError>>;
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
  /** `thread.create { testRun: true }`: Test run 대화를 만든다. 대화 id를 돌려준다 */
  createTestRun(): Promise<Result<string, CommandError>>;
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
}

/** 연결 화면이 고른 대상. `local`은 이 기기의 사이드카, `remote`는 서비스 주소다(W-08) */
export type ConnectTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly address: string };

/**
 * 연결 화면이 읽는 host 상태. `host.status` 결과와 서비스 모드 설정 값이다. `remoteAllowRespond`는 원격 응답 허용 값이고,
 * 엔진이 그 설정을 알리지 않으면(카탈로그에 없으면) `null`이다
 */
export interface ConnectionSnapshot {
  readonly host: WireResult<"host.status">;
  readonly serviceEnabled: boolean;
  readonly remoteAllowRespond: boolean | null;
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
  /** 원격 연결에서 승인 요청에 답하는 것을 허락할지 바꾼다(`settings.set`, 사용자 범위). 바로 적용된다 */
  setRemoteRespond(enabled: boolean): Promise<Result<null, CommandError>>;
  /** 서비스를 협조 종료한다(`host.shutdown`). 받아들여졌으면 `true`다 */
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
  /** 기본 그룹 하나를 켜거나 끈다(`settings.set { key: "ext.<그룹>.enabled", scope: "user" }`). 적용은 다음 단계 경계다 */
  setGroupEnabled(group: DefaultGroupId, enabled: boolean): Promise<Result<null, CommandError>>;
  /** 검색 권장을 읽는다(`web.providers`와 "나중에" 값) */
  loadSearch(): Promise<Result<SearchSnapshot, CommandError>>;
  /** 검색 권장을 "나중에"로 닫는다(데스크톱 로컬 설정 `l4.desktop.firstRun.searchHintDismissed`) */
  dismissSearchHint(): Promise<Result<null, CommandError>>;
  /** `settings.invalidated`를 받으면 부른다. 반환값은 구독 해제 */
  onInvalidated(listener: () => void): () => void;
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
 * 설정 화면(P-09)의 컨트롤러. 연결이 없어도 준다(엔진 원천 항목은 빠지고 로컬 원천 항목은 쓸 수 있다). 컨트롤러는 연결마다 새로 만들고, 화면이 `dispose()`로 놓는다.
 * 읽기·쓰기·알림의 판정은 `@fresnel/client/settings`가 하고, 이 명령은 연결과 현재 대화만 잇는다(`app/settings.ts`).
 */
export interface SettingsCommands {
  open(): SettingsController;
  /** `settings.readFile`(파일 편집기). 범위가 `user`이면 대화를 보내지 않는다. 연결이 없으면 `offline`이다 */
  readFile(target: SettingsFileTarget): Promise<Result<SettingsReadFileResult, CommandError>>;
  /** `settings.writeFile`(파일 편집기). 읽은 뒤 파일이 바뀌었으면 `conflict`(3107)다 */
  writeFile(write: SettingsFileWrite): Promise<Result<SettingsWriteFileResult, SettingsWriteError>>;
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

/** 성능 측정 화면(P-20, §6.27). 측정 저장소 읽기만 한다. 측정이 꺼져 있으면 `enabled`가 거짓이다 */
export interface MeasureCommands {
  /** `measure.turn`: 한 Turn의 측정 행(Turn, 호출, 훅, 요청 구성, 캐시 사건) */
  turn(threadId: string, turnId: string): Promise<Result<MeasureTurnResult, CommandError>>;
  /** `measure.daily`: 종류와 지표 하나의 일별 집계 */
  daily(kind: string, metric: string): Promise<Result<MeasureDailyResult, CommandError>>;
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
  /** `thread.compact`: 지금 대화를 요약한다(수동 컴팩션). 요약할 것이 없으면 결과가 `skipped`로 와서 오류가 아니다 */
  compactThread(threadId: ThreadId): Promise<Result<WireResult<"thread.compact">, CommandError>>;
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
   * 엔진 대상을 바꾼다(W-08, `engine_retarget`). 바꾸는 동안 쓰기 명령(`sendTurn`, `interrupt`, `respondApproval`, `createThread`,
   * `forkThread`, `trust.decide`)은 `switching`으로 거절한다. 옛 엔진이 `shutdownGraceMs`까지 쓰기를 받을 수 있어서다.
   * `graceMs`는 `l4.desktop.engine.shutdownGraceMs`.
   */
  retargetEngine(target: EngineTarget, graceMs: number): Promise<Result<null, CommandError>>;
  readonly trust: TrustCommands;
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
  readonly secrets: SecretCommands;
  /** 설정 고급 탭의 데이터 복원(`db_restore`) */
  readonly restore: RestoreCommands;
  readonly settings: SettingsCommands;
  readonly web: WebCommands;
  readonly proposals: ProposalCommands;
  readonly work: WorkCommands;
  readonly review: ReviewCommands;
  readonly usage: UsageCommands;
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
  /** 변경 검토 화면(P-04)을 이 승인으로 연다. 화면 자리는 App이 옮긴다 */
  openReview(target: ReviewTarget): void;
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

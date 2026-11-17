import type { TSchema } from "typebox";
import type {
  CallerInfo,
  FileChangeEntry,
  ToolHints,
  ToolName,
  ToolRisk,
} from "../capabilities/index.ts";
import type { JsonValue, ThreadId, TurnId, Usage } from "../conversation/index.ts";
import type { Result } from "../base/index.ts";
import type {
  ExtensionTables,
  MigrationRunner,
  ProjectorRegistry,
  RecordCommitPort,
  StoreError,
  StoreService,
  Unsubscribe,
} from "../records/index.ts";
import type {
  ExtTimingsResult,
  TestRunControlError,
  TestRunControlResult,
  TestRunPhaseResult,
  TraceTurnResult,
} from "./trace-types.ts";
import type { SpawnOutcome, SpawnSpec, TurnOutcome } from "./drive.ts";
import type { HookName } from "./hooks.ts";
import type { ExtensionName } from "./name.ts";
import type { PostItem, PostWhen } from "./post.ts";
import type { DriveLockId, RegistrationId } from "./registration-id.ts";
import type { EvidenceRef } from "./plugin-card.ts";
import type { ManifestIssue } from "./validate.ts";

// 호스트 포트와 로더 포트의 정본이다(F.extensions.spec §3.2.1, review.decisions-2 U-14·D-04).
// X(ext-host)는 이 이름을 import type으로 가져와 다시 export하고 자기 정의를 두지 않는다.

// ── 키와 조회 ───────────────────────────────────────────────────────────

declare const portApi: unique symbol;

/** Cordis 서비스 이름과 API 타입을 함께 실어 나르는 키. 런타임 값은 name과 member뿐이다 */
export interface PortKey<Api> {
  readonly name: `fresnel.${string}`;
  /** 있으면 서비스 객체의 이 속성이 포트다. 서비스 메서드 이름이 포트와 겹칠 때 쓴다(예: fresnel.session의 ext) */
  readonly member?: string;
  /** 팬텀 필드. 런타임에는 없다 */
  readonly [portApi]?: Api;
}

/** 포트 조회. 포트가 아직 등록되지 않았거나 내려갔으면 undefined. member가 있으면 그 속성을 돌려준다 */
export interface PortLookup {
  get<Api>(key: PortKey<Api>): Api | undefined;
}

// ── 루프 (서비스 fresnel.loop, 제공 core-loop) ─────────────────────────────

export interface LoopTurnRequest {
  readonly threadId: ThreadId;
  readonly scopeId: RegistrationId;
  readonly leaseId: DriveLockId;
  /** 펜싱 값. 포트는 현재 임대 차수보다 작은 값의 요청을 거부한다 */
  readonly leaseEpoch: number;
  /** (scopeId, requestId) 쌍이 thread 안에서 멱등 키다 */
  readonly requestId: string;
  readonly input: PostItem;
  readonly signal: AbortSignal;
}

export interface LoopTurnResult {
  readonly outcome: TurnOutcome;
  /** 이미 커밋된 turn의 기록을 돌려줬으면 참 */
  readonly replayed: boolean;
  /** 이 turn의 모델 사용량 합. replayed면 기록된 값 */
  readonly usage: Usage | null;
}

export interface LoopSpawnRequest {
  readonly threadId: ThreadId;
  readonly scopeId: RegistrationId;
  readonly leaseId: DriveLockId;
  readonly leaseEpoch: number;
  readonly requestId: string;
  readonly spec: SpawnSpec;
  readonly signal: AbortSignal;
}

export interface LoopSpawnResult {
  readonly outcome: SpawnOutcome;
  readonly replayed: boolean;
  readonly usage: Usage | null;
}

/** 대화에서 지금 도는 turn의 호출 조건. 플러그인이 부른 기능 호출이 `CallContext`로 그대로 이어받는다 */
export interface LoopCallConditions {
  /** 사람이 승인 요청에 답할 수 있는 실행인가 */
  readonly interactive: boolean;
  /** 서브에이전트 정의의 읽기 전용 샌드박스 천장. 없으면 천장이 없다 */
  readonly sandbox?: "read-only";
}

export interface LoopPort {
  /**
   * 이 대화에서 지금 도는 turn의 호출 조건. 도는 turn이 없으면 undefined(그러면 호출 문맥은 조건을 싣지 않는다).
   * 구현이 없는 포트(시험 대역)도 허용한다
   */
  callConditions?(threadId: ThreadId): LoopCallConditions | undefined;
  status(threadId: ThreadId): "idle" | "running";
  /** 유휴일 때 turn을 시작하고, 정착한 뒤 결과를 돌려준다. 실행 중이면 현재 turn이 정착한 뒤 시작한다 */
  runTurn(request: LoopTurnRequest): Promise<LoopTurnResult>;
  spawn(request: LoopSpawnRequest): Promise<LoopSpawnResult>;
  /** 유휴 상태에서 fn을 실행하는 동안 새 turn 시작을 막는다. 실행 중이면 정착 뒤 실행한다 */
  whenIdle<T>(threadId: ThreadId, fn: () => Promise<T>): Promise<T>;
}
export const LoopPortKey: PortKey<LoopPort> = { name: "fresnel.loop" };

// ── 입력 큐 (서비스 fresnel.tasks, 제공 core-tasks) ────────────────────────

export interface EnqueueRequest {
  readonly threadId: ThreadId;
  readonly scopeId: RegistrationId;
  /** PostOptions.requestId 그대로. (scopeId, requestId) 쌍이 thread 안 멱등 키다 */
  readonly requestId: string;
  readonly when: PostWhen;
  readonly item: PostItem;
}

export interface EnqueueResult {
  readonly duplicate: boolean;
}

/** 입력 큐가 항목을 받지 않은 이유. 저장소 실패와 닫힌 thread는 예상 가능한 거부다(TY-24, review.open-issues N-05) */
export type EnqueueError =
  | StoreError
  | { readonly kind: "invalid_request_id"; readonly requestId: string }
  | { readonly kind: "mode_not_supported"; readonly mode: string }
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId };

export interface InputQueuePort {
  /** 입력 큐 항목(input.queued) 하나를 커밋 키로 멱등하게 남긴다(F.records.spec §3.3, U-05) */
  enqueue(request: EnqueueRequest): Promise<Result<EnqueueResult, EnqueueError>>;
}
export const InputQueuePortKey: PortKey<InputQueuePort> = { name: "fresnel.tasks" };

// ── 기록 (서비스 fresnel.session의 ext 속성, 제공 core-persistence) ─────────

/** 정의는 F.records.spec §3.9 session-service.ts. records가 extensions보다 낮아 그쪽에 둔다 */
export type {
  ExtCommitRejectCode,
  ExtCommitRequest,
  ExtCommitResult,
  ExtRecordQuery,
  ExtRecordRow,
  ExtThreadSnapshot,
  OpenLease,
  RecordCommitPort,
  StoredScopeState,
} from "../records/index.ts";
export const RecordCommitPortKey: PortKey<RecordCommitPort> = {
  name: "fresnel.session",
  member: "ext",
};

// ── 확장 투영기 등록 (서비스 fresnel.session의 projectors 속성) ─────────────

/** SessionService.projectors(ProjectorRegistry)의 부분형. 투영기 name은 "ext.<확장 이름>"이다 */
export type ProjectorRegistryPort = Pick<ProjectorRegistry, "register" | "onFailure">;
export const ProjectorRegistryPortKey: PortKey<ProjectorRegistryPort> = {
  name: "fresnel.session",
  member: "projectors",
};

// ── 접두 테이블 (서비스 fresnel.store, 제공 platform-store) ─────────────────

/** StoreService의 부분형. scoped(owner)는 그 소유자 접두 테이블만 쓰는 StoreDb를 돌려준다 */
export type ScopedStorePort = Pick<StoreService, "scoped">;
export const ScopedStorePortKey: PortKey<ScopedStorePort> = { name: "fresnel.store" };

/**
 * StoreService.extensions의 부분형. 테이블을 정의하기 전에 확장 접두를 등록하고(`register`, 이미 있으면 그대로 둔다),
 * 확장 제거 때 그 확장의 접두 테이블을 지운다(`drop`, X.operations.spec §4.4.7)
 */
export type ExtensionTablesPort = Pick<ExtensionTables, "register" | "drop">;
/** 서비스 fresnel.store의 `extensions` 속성(member). 접두 테이블 등록·삭제 자리다 */
export const ExtensionTablesPortKey: PortKey<ExtensionTablesPort> = {
  name: "fresnel.store",
  member: "extensions",
};

/** StoreService.migrations의 부분형. 확장 호스트가 소유자 `xh`의 장부 테이블 마이그레이션을 적용한다(X.operations.spec §4.4.2) */
export type StoreMigrationsPort = Pick<MigrationRunner, "apply">;
/** 서비스 fresnel.store의 `migrations` 속성(member) */
export const StoreMigrationsPortKey: PortKey<StoreMigrationsPort> = {
  name: "fresnel.store",
  member: "migrations",
};

// ── 프로세스 실행 (서비스 fresnel.process, 제공 platform-process) ───────────

/**
 * 플러그인 호스트 프로세스를 띄우는 요청(review.m5-drive-isolation §3.1). 엔진이 자기 실행 파일을 다른 모드로 다시 실행한다
 * (`command` = `process.execPath`, `args`에 하위 명령). L0는 OS 샌드박스로 감싸 띄운다: 파일은 `readRoot`와 런타임 읽기뿐,
 * 쓰기 없음, 네트워크 전체 허용(§3.4 [결정: 2026-11-17 사용자])
 */
export interface IsolationSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** 플러그인 패키지 폴더(검토본 `tree/`, 초안은 `drafts/<draftId>/tree/`). 읽기 전용으로 열린다. 작업 폴더이기도 하다 */
  readonly readRoot: string;
  /** 허용 목록으로만 만든다. DB 경로와 시크릿은 넣지 않는다 */
  readonly env: Readonly<Record<string, string>>;
  /** "ext:<name>:<versionId>" */
  readonly label: string;
}

export interface IsolatedChild {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  /** 프로세스 트리 전체에 보낸다 */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type IsolationSpawnError =
  | { readonly kind: "spawn_failed"; readonly code: string; readonly message: string }
  /** 샌드박스에 넣어야 하는데 이 기기에서 격리할 수 없다. 격리 없이 띄우지 않는다(닫힌 실패) */
  | { readonly kind: "sandbox_unavailable"; readonly reason: string };

export interface IsolationProcessPort {
  spawn(spec: IsolationSpawnSpec): Promise<Result<IsolatedChild, IsolationSpawnError>>;
}

/** 외부 훅 실행. 사용처: X.operations.spec §3.7 */
export interface HookRunSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly maxStdoutChars: number;
  readonly maxStderrChars: number;
  readonly signal: AbortSignal;
}

export interface HookRawRun {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

export interface HookProcessPort {
  run(spec: HookRunSpec): Promise<HookRawRun>;
}

export interface ProcessPort extends IsolationProcessPort, HookProcessPort {}
export const ProcessPortKey: PortKey<ProcessPort> = { name: "fresnel.process" };

// ── 임대 정책 (서비스 fresnel.groups, 제공 group-sdk, 선택) ─────────────────

export interface DriveLockCandidate {
  readonly scopeId: RegistrationId;
  readonly extension: ExtensionName;
  readonly loadIndex: number;
  readonly defaultEnabled: boolean;
  /** 그 thread 활성 가지의 마지막 `scope.changed{status:"enabled"}` seq. 기록이 없으면 null */
  readonly enabledAtSeq: number | null;
}

export interface DriveLockArbiterPort {
  /** 후보 중 하나를 고른다. null이면 아무에게도 주지 않는다 */
  choose(threadId: ThreadId, candidates: readonly DriveLockCandidate[]): RegistrationId | null;
}
export const DriveLockArbiterPortKey: PortKey<DriveLockArbiterPort> = { name: "fresnel.groups" };

// ── 리소스 등록 (X.primitives.spec §3.9, §4.8) ───────────────────────────

export interface ToolResourceDef {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: TSchema;
  readonly replay: "safe" | "unsafe";
  /** 광고 방식. 생략은 "always"다. "deferred"이면 `tool_search`로 찾아야 광고된다(L1.tools.spec §4.1) */
  readonly exposure?: "always" | "deferred";
  /**
   * 선언한 위험 등급(`ToolRisk`). 생략하면 `hints`로 유도하고 그것도 없으면 `exec`다 [제안: M3-REQ-78].
   * `read`보다 낮은 승인 요구를 만드는 선언은 builtin 확장만 낼 수 있다. 그 밖의 확장이 `exec`보다 낮게 선언하면 X가 등록을 거부한다
   */
  readonly risk?: ToolRisk;
  /** 정책 힌트(`ToolHints`). 위험 등급을 유도하는 데 쓴다. `readOnly: true` 선언은 `risk`와 같은 신뢰 규칙을 따른다 */
  readonly hints?: ToolHints;
  /**
   * 있으면 같은 이름의 내장 도구를 대체하는 등록이다(F.capabilities.spec §10 [결정: 2026-11-03 사용자]).
   * L1.tools는 사용자가 승인하기 전까지 대체를 켜지 않고, 위험 등급은 원본보다 낮추지 않는다
   */
  readonly replaces?: ToolReplaceClaim;
  execute(
    args: JsonValue,
    ctx: {
      /** 도구가 실행된 대화. 위임 자식 대화에서 실행되면 그 자식 대화다 */
      readonly threadId: ThreadId;
      readonly signal: AbortSignal;
      /** 이 호출의 id. X가 멱등 키의 디스패치 키로 쓴다(M3-REQ-102) */
      readonly toolCallId: string;
      /** 호출 주체. 이번 turn에 untrusted 도구 결과를 읽었으면 `afterUntrusted`가 참이다(M3-REQ-100) */
      readonly caller: CallerInfo;
      /** 이 호출이 바꾼 파일을 알린다(M5e §4.7 `reported`). 코어가 `source`를 정하고 검증해 결과의 `fileChanges`에 합친다 */
      readonly changes?: ToolChangeReport;
    },
  ): Promise<unknown>;
}
/** 플러그인 도구가 알리는 파일 변경 한 건. `source`는 코어가 `reported`로 정하므로 적지 않는다 */
export type ReportedFileChange = Omit<FileChangeEntry, "source">;
/** `ctx.changes`. 알린 항목은 검증되지 않은 값으로 받아 코어가 모양을 확인한다(F.capabilities.spec §3.13) */
export interface ToolChangeReport {
  report(entries: readonly ReportedFileChange[]): void;
}
/** 모양은 L1.models.spec이 정한다 */
export type ProviderResourceDef = JsonValue;
/** 모양은 L2.mcp.spec(McpServerDefSchema)이 정한다 */
export type McpServerResourceDef = JsonValue;

/** 도구 등록 실패. 확장 조합이 같은 도구 이름을 내면 정상 운영 중에도 생긴다(TY-24) */
export type ToolRegisterError =
  | {
      /** 대체 선언 없이 같은 이름을 등록함 */
      readonly kind: "name_conflict";
      readonly toolName: string;
    }
  | {
      /** 대체할 수 없는 도구: 내장 기능 도구가 아니거나(`no_target`, `not_builtin`) 도구 실행 틀을 이루는 내장 도구(`core_pipeline`) */
      readonly kind: "replace_forbidden";
      readonly toolName: string;
      readonly reason: "no_target" | "not_builtin" | "core_pipeline";
    }
  | {
      /** 이미 다른 확장이 같은 내장 도구를 대체함 */
      readonly kind: "replace_conflict";
      readonly toolName: string;
      readonly existing: string;
    };

/** 내장 도구를 같은 이름으로 대체하겠다는 등록의 출처. 매니페스트 `replaces` 선언이 있는 이름에만 X가 싣는다 */
export interface ToolReplaceClaim {
  /** 대체하는 확장 이름 */
  readonly extension: string;
  /** 확장의 신뢰 등급. project도 같은 승인을 거친다 */
  readonly trust: "builtin" | "user" | "project" | "untrusted";
}

/** ToolService(fresnel.tools)가 포함하는 등록 부분형. 이름이 겹치면 등록은 통째로 실패하고 표는 그대로다 */
export interface ToolsPort {
  register(owner: RegistrationId, def: ToolResourceDef): Result<Unsubscribe, ToolRegisterError>;
}
/** ModelService(fresnel.models)가 포함하는 등록 부분형 */
export interface ModelsPort {
  registerProvider(owner: RegistrationId, name: string, config: ProviderResourceDef): Unsubscribe;
}
/** McpService(fresnel.mcp)가 포함하는 등록 부분형 */
export interface McpPort {
  registerServer(owner: RegistrationId, name: string, config: McpServerResourceDef): Unsubscribe;
}
export const ToolsPortKey: PortKey<ToolsPort> = { name: "fresnel.tools" };
export const ModelsPortKey: PortKey<ModelsPort> = { name: "fresnel.models" };
export const McpPortKey: PortKey<McpPort> = { name: "fresnel.mcp" };

// ── 로더 포트 (Cordis 서비스가 아니다. 조립 루트가 LoaderDeps로 넘긴다, X.loading-trust.spec §3.5) ──

/** 탐색이 쓰는 파일 접근. 구현 L0.os */
export interface LoaderFs {
  /** 없으면 null */
  readText(path: string): Promise<string | null>;
  /** 없으면 null. 항목 이름은 정렬하지 않은 원본 */
  listDir(
    path: string,
  ): Promise<
    readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null
  >;
  exists(path: string): Promise<boolean>;
  /** 심볼릭 링크를 푼 정규 경로 */
  realpath(path: string): Promise<string>;
}

/** 설치 위치의 OS별 경로. 값은 L0.os가 정한다 */
export interface LoaderPaths {
  /** 예: ~/.fresnel */
  readonly userDir: string;
  /** 관리 정책 디렉터리. 없으면 null */
  readonly managedDir: string | null;
  readonly homeDir: string;
}

/** 신뢰 파일 접근. 잠금과 원자 교체(임시 파일 + rename)는 구현(L0.os)이 맡는다 */
export interface TrustStoreBackend {
  /** 파일이 없으면 { ok: true, text: null } */
  read(): Promise<
    | { readonly ok: true; readonly text: string | null }
    | { readonly ok: false; readonly reason: string }
  >;
  /** 잠금을 잡고 현재 내용을 fn에 넘겨 반환값으로 교체한다 */
  update(fn: (current: string | null) => string): Promise<void>;
}

export type TrustChoiceKind = "folder" | "parent" | "session";

export interface TrustChoice {
  readonly kind: TrustChoiceKind;
  readonly verdict: "allow" | "deny";
}

export interface TrustUpdate {
  readonly path: string;
  /** null은 항목 삭제 */
  readonly verdict: "allow" | "deny" | null;
  readonly via: "prompt" | "point" | "command";
}

export interface TrustOption {
  readonly choice: TrustChoice;
  readonly label: string;
  readonly updates: readonly TrustUpdate[];
  readonly savedPath: string | null;
}

export interface TrustPromptRequest {
  readonly projectRoot: string;
  readonly parent: string | null;
  /** 찾은 신뢰 필요 자원(프로젝트 루트 기준 상대 경로) */
  readonly resources: readonly string[];
  readonly options: readonly TrustOption[];
}

/** 대화형 클라이언트(L4)가 구현한다. 취소나 닫힘은 undefined */
export interface TrustPrompter {
  ask(request: TrustPromptRequest, signal: AbortSignal): Promise<TrustChoice | undefined>;
}

// ── 계측 읽기와 Test run 제어(F.wire-settings.spec §3.3.6, X-15·X-19) ─────────────
// wire 처리기(`trace.turn`, `ext.timings`, `testRun.*`)가 이 포트에 대해 쓰이고, ext-host가 구현해 L4 조립이 연결한다.
// 값 검증이 없는 순수 인터페이스다. 결과 타입은 wire 결과 타입과 같다.

/** 핸들러 계측 읽기. 원천은 X-15 링 버퍼이고 `ext.timings`의 분포와 `trace.turn`이 같은 값을 쓴다 */
export interface TraceReadPort {
  /** X-15 계측이 켜져 있는가(`x.operations.trace.enabled`) */
  enabled(): boolean;
  /** 버퍼에 남은 Turn의 Trace. 버퍼 밖이면 undefined */
  turn(threadId: ThreadId, turnId: TurnId): TraceTurnResult | undefined;
  /** Hook별 핸들러 시간 분포(X-6). 같은 원천 */
  timings(filter: {
    readonly hook?: HookName;
    readonly registrationId?: RegistrationId;
  }): ExtTimingsResult;
}

/** Test run 대화의 단계 경계 멈춤 제어(X-19). 멈춘 동안 drive lock을 쥐고 있다 */
export interface TestRunControlPort {
  /** 다음 단계 경계에서 멈춘다 */
  pause(threadId: ThreadId): Result<TestRunControlResult, TestRunControlError>;
  resume(threadId: ThreadId): Result<TestRunControlResult, TestRunControlError>;
  /** 경계 하나만 진행하고 다시 멈춘다 */
  step(threadId: ThreadId): Result<TestRunControlResult, TestRunControlError>;
  phase(threadId: ThreadId): Result<TestRunPhaseResult, TestRunControlError>;
}

// ── 플러그인 로더 포트(M5c-1, docs/xeon/review/m5/profile-project-loader.md §3.5). 인터페이스만 둔다. PortKey 이름은 스펙이 정하지 않아 두지 않는다 ──

/** 대화가 쓰는 플러그인 집합. 구현은 호스트다. X는 호스트의 프로필 저장소를 import하지 않고 이 포트로 읽는다(DR-14) */
export interface PluginSetView {
  /** E(T): 이 대화의 켜짐 집합(플러그인 이름). 코어를 포함한다 */
  readonly plugins: readonly string[];
  /** 적용한 프로필 id. 대화가 가리키는 프로필이 없으면 `default`다(M5c §4.1.1) */
  readonly profileId: string;
  readonly profileRev: number;
  readonly commonRev: number;
  /** 대화가 저장한 프로필 id가 가리키는 프로필이 없어 `default`로 읽었으면 그 id. 있으면 `profile.applied { reason: "profile_missing" }` */
  readonly missingProfileId?: string;
}
export interface PluginSetPort {
  resolve(threadId: ThreadId): PluginSetView;
}
/** 대화별 켜짐 집합(E(T))을 주는 포트. 구현은 호스트이고, X는 이 키로 읽는다(M5c §3.5) */
export const PluginSetPortKey: PortKey<PluginSetPort> = {
  name: "fresnel.pluginSet",
};

/** 재료 한 덩어리의 키와 본문. 지침, 명령(프롬프트형), 에이전트 정의가 같은 모양을 쓴다 */
export interface MaterialText {
  readonly key: string;
  readonly text: string;
}
/** MCP 서버 정의 하나와 소유 플러그인. 합친 뒤에도 기록(E)이 `mcp.<서버>`의 소유자를 알아야 한다(§4.5.10) */
export interface McpServerMaterial {
  readonly plugin: string;
  readonly name: string;
  readonly config: McpServerResourceDef;
}
/**
 * 대화의 재료 공급. 구현은 X다. 반환 모양 가운데 스펙이 적지 않은 것(`skillRoots`, `agentDefinitions`, `commands`, `mcpServers`)은
 * 본문이나 경로로 가장 가까운 모양을 골랐다. [미결] 구현 때 확정한다
 */
export interface MaterialPort {
  instructions(threadId: ThreadId): readonly MaterialText[];
  /** 검토본 폴더의 루트 경로. 스킬 색인이 `roots.extension`으로 읽는다 */
  skillRoots(threadId: ThreadId): readonly string[];
  agentDefinitions(threadId: ThreadId): readonly MaterialText[];
  mcpServers(threadId: ThreadId): readonly McpServerMaterial[];
  commands(threadId: ThreadId): readonly MaterialText[];
}

/** 제출 요청. 담당 AI(플러그인 빌더)가 만든 폴더를 검토함으로 보낸다. 증거는 한 개 이상 필수다(§4.7.1) */
export interface PluginSubmitRequest {
  readonly dir: string;
  readonly originThreadId: ThreadId;
  readonly evidence: readonly [EvidenceRef, ...EvidenceRef[]];
  readonly purpose?: string;
}
export interface PluginSubmitResult {
  readonly draftId: string;
  readonly itemId: string;
}
/** 제출 실패. `kind`는 `plugin.invalid`·`plugin.tooLarge`·`plugin.symlinkRefused` 오류 이름에 대응한다 */
export type PluginSubmitError =
  | { readonly kind: "invalid"; readonly issues: readonly ManifestIssue[] }
  | { readonly kind: "too_large" }
  | { readonly kind: "symlink_refused" };
/**
 * 담당 AI만 부른다(wire 메서드가 아니다). 안에서 초안 만들기와 검토 항목 만들기를 한 번에 한다(§4.9).
 * 디스크 복사와 해시 계산이 있어 비동기다
 */
export interface PluginSubmitPort {
  submit(request: PluginSubmitRequest): Promise<Result<PluginSubmitResult, PluginSubmitError>>;
}

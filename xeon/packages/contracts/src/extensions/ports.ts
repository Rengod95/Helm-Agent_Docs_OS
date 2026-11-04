import type { TSchema } from "typebox";
import type { CallerInfo, ToolHints, ToolName, ToolRisk } from "../capabilities/index.ts";
import type { JsonValue, ThreadId, TurnId, Usage } from "../conversation/index.ts";
import type { Result } from "../base/index.ts";
import type {
  ExtensionTables,
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

export interface LoopPort {
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

/** StoreService.extensions의 부분형. 확장 제거 때 그 확장의 접두 테이블을 지운다(X.operations.spec §4.4.7) */
export type ExtensionTablesPort = Pick<ExtensionTables, "drop">;
/** 서비스 fresnel.store의 `extensions` 속성(member). 접두 테이블 등록·삭제 자리다 */
export const ExtensionTablesPortKey: PortKey<ExtensionTablesPort> = {
  name: "fresnel.store",
  member: "extensions",
};

// ── 프로세스 실행 (서비스 fresnel.process, 제공 platform-process) ───────────

/** 격리 확장 자식 프로세스(2차). 사용처: X.loading-trust.spec §3.8 */
export interface IsolationSpawnSpec {
  /** 자식 런타임 진입점. ext-host의 isolation/child-main.ts 절대 경로 */
  readonly main: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** 허용 목록으로만 만든다. DB 경로와 시크릿은 넣지 않는다(X.loading-trust.spec §4.9.6) */
  readonly env: Readonly<Record<string, string>>;
  /** "ext:<name>:<generation>" */
  readonly label: string;
}

export interface IsolatedChild {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface IsolationProcessPort {
  spawn(spec: IsolationSpawnSpec): Promise<IsolatedChild>;
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
    },
  ): Promise<unknown>;
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

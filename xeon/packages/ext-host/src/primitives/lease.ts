import { createHash } from "node:crypto";
import {
  Bug,
  assertNever,
  attemptAsync,
  detach,
  err,
  ok,
  parse,
  type Result,
} from "@fresnel/contracts";
import {
  AskRequestSchema,
  LoopPortKey,
  ModelsPortKey,
  RecordCommitPortKey,
  ToolsPortKey,
  type AskCard,
  type AskOutcome,
  type AskRequest,
  type DriveCommand,
  type DriveFrameView,
  type DriveLimits,
  InputQueuePortKey,
  type DriveLockBudget,
  type OpenLease,
  type PortKey,
  type PostItem,
  type StepResult,
  type RegistrationId,
  type SpawnOutcome,
  type SpawnSpec,
  type TurnInput,
  type TurnOutcome,
} from "@fresnel/contracts/extensions";
import type { ToolError, ToolResultView } from "@fresnel/contracts/capabilities";
import type { JsonValue, ThreadId, Usage } from "@fresnel/contracts/conversation";
import { DenyAnswerSchema, QuestionAnswerSchema, requestKeyFor } from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  type ApprovalResolution,
  type QuestionBody,
  type QuestionItem,
  type QuestionOption,
} from "@fresnel/contracts/services";
import { withAmbient, withoutAmbient, type DriveInvocation } from "./ambient.ts";
import { stateAs } from "../erase.ts";
import type { AnyState } from "./erased-types.ts";
import {
  topFrame,
  type BoundarySignal,
  type BoundaryTxn,
  type Generation,
  type HostCore,
  type LeaseRuntime,
  type ReleaseReason,
  type RegistrationRecord,
  type StartDriveError,
  type StartRequest,
  type ThreadRuntime,
} from "./core.ts";
import { isPluginProcessError } from "../isolation/errors.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { shouldSwitchNow } from "./switch-policy.ts";
import type { StateService } from "./state.ts";

/** 효과 없는 명령(`commit`만, 거부 결과)이 이어지는 단계 수 상한. 넘으면 이번 호출을 `yield`로 끝낸다(X.primitives.spec §4.4.3) [제안] */
export const MAX_CHAINED_REINVOKES = 8;

/**
 * 한 프레임이 낼 수 있는 `tool` 명령 수 상한. 도구 호출은 토큰을 쓰지 않고 성공하면 효과로 세므로 토큰 한도와 효과 없는 명령의
 * 연속 상한이 막지 못한다. 넘으면 `budget`으로 반납한다. 프레임의 한도 키(`DriveLimits`)가 아니라 엔진 상수다(기록·설정 스키마를
 * 건드리지 않는 가장 작은 추가) [제안]
 */
export const MAX_DRIVE_TOOL_COMMANDS = 64;

/** 프레임별 `tool` 명령 수. 프로세스 안에서만 센다(재시작 뒤에는 다시 0에서 시작한다) */
const toolCommandCounts = new WeakMap<LeaseRuntime, number>();

/** 사용자 메시지를 전달한 뒤 단계 함수가 `turn`이나 `done`으로 처리하지 않고 지나갈 수 있는 단계 수(drive-isolation.md 2.4) */
const USER_MESSAGE_STEP_LIMIT = 3;

/**
 * 주도권 스택의 유지와 부여(drive-isolation.md 2.1, 2.2). 프레임 스택은 `ThreadRuntime.frames`에 있고 맨 위 프레임만 단계 함수를 부른다.
 * 부여 계기는 시작 요청 큐 하나뿐이다(사용자 명령, 프로필 시작). 중재와 후보 추첨은 없다
 */
export interface LeaseBroker {
  /** openThread: 저장된 열린 임대 목록(오래된 것부터, 맨 위가 마지막)으로 스택을 세운다. 죽은 scope의 프레임은 restart로 반납 예정이 된다 */
  restore(thread: ThreadRuntime, open: readonly OpenLease[]): void;
  /** scope가 꺼지면 모든 thread에서 그 scope의 프레임과 그 위 프레임을 반납 예정으로 바꾼다 */
  releaseForRegistration(scopeId: RegistrationId, reason: ReleaseReason): void;
  /** 한 thread에서만 scope가 꺼질 때 그 프레임과 그 위 프레임을 반납 예정으로 바꾼다(P-28) */
  releaseForRegistrationIn(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    reason: ReleaseReason,
  ): void;
  /** prepare: 반납 예정 프레임의 lease.released 초안(맨 위부터) */
  collectReleases(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** prepare: 시작 요청 큐 맨 앞으로 부여 초안과 `txn.grant`를 만든다 */
  grant(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle(committed): 커밋된 반납·부여를 스택에 반영한다 */
  applyCommitted(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle 뒤: 경계 종류에 맞게 맨 위 프레임의 단계 함수를 부른다 */
  onBoundary(thread: ThreadRuntime, signal: BoundarySignal): void;
  /** 명령·도구 호출이 상태 판을 올렸다: 맨 위 프레임이 있고 thread가 유휴면 단계를 한 번 예약한다(X.primitives.spec §4.4.3) */
  onDirectCommit(thread: ThreadRuntime, scopeId: RegistrationId): void;
  /**
   * 사용자가 보낸 메시지를 주도 중인 단계 함수에 전달한다(drive-isolation.md 2.4). 주도 중이면 메시지를 받아 참을 돌려주고
   * 다음 단계의 `last: { kind: "user" }`로 준다. 주도 중이 아니면 거짓이고 코어 루프가 평소대로 받는다
   */
  claimUserInput(thread: ThreadRuntime, item: PostItem): boolean;
  /**
   * 주도 시작 요청을 큐에 넣는다(사용자 명령, drive-isolation.md 2.2). 사용자 요청은 멈춤을 푼다. 스택이 차 있으면 전환 정책
   * (switch-policy.ts)에 따라 스택 전체를 내리고 새 주도를 부여한다. 대상이 맞지 않는 것은 부여 경계에서 버리므로 여기서는
   * scope와 drive 자격의 명백한 실패만 거부한다
   */
  startDrive(
    threadId: ThreadId,
    scopeId: RegistrationId,
    trigger: "user" | "profile",
    input: JsonValue | null,
  ): Result<void, StartDriveError>;
  /** 읽기: thread의 스택을 아래에서 위로 주는 `drive.frames` 모양. 코어 루프가 맨 아래 깊이 0이다 */
  framesOf(thread: ThreadRuntime): readonly DriveFrameView[];
  /**
   * 훅 안에서 부른 `agents.judge`, `models.complete`가 쓴 토큰을 맨 위 프레임과 스택 아래 모든 프레임의 사용량에 더한다(`model` 명령과 같다).
   * 주도 프레임이 없으면(코어 루프의 보통 턴) 더할 곳이 없다
   */
  chargeTokens(thread: ThreadRuntime, tokens: number): void;
}

/**
 * 필드마다 base = 요청 ?? 일반 기본값, 실효 = min(base, 천장). 둘 다 없으면 그 필드는 상한 없음이다
 * (X.primitives.spec §4.4.2, review.decisions-2 U-12). 요청이 천장보다 크면 clamped에 필드 이름을 담는다
 */
function effectiveLimits(
  defaults: DriveLimits,
  ceiling: DriveLimits,
  requested: DriveLimits | undefined,
): { readonly limits: DriveLimits; readonly clamped: readonly string[] } {
  const clamped: string[] = [];
  const out: { maxTurns?: number; maxSpawns?: number; maxTokens?: number } = {};
  for (const key of ["maxTurns", "maxSpawns", "maxTokens"] as const) {
    const fromRequest = requested?.[key];
    const base = fromRequest ?? defaults[key];
    const cap = ceiling[key];
    if (base !== undefined && cap !== undefined) {
      if (fromRequest !== undefined && fromRequest > cap) clamped.push(key);
      out[key] = Math.min(base, cap);
    } else if (base !== undefined) {
      out[key] = base;
    } else if (cap !== undefined) {
      // 요청도 기본값도 없고 천장만 있으면 천장이 곧 상한이다
      out[key] = cap;
    }
  }
  return { limits: out, clamped };
}

function remaining(limit: number | undefined, used: number): number | null {
  return limit === undefined ? null : Math.max(0, limit - used);
}

function release(lease: LeaseRuntime, reason: ReleaseReason): void {
  if (lease.status !== "active") return;
  lease.status = "releasing";
  lease.reason = reason;
  lease.abort.abort(new DOMException(`lease released: ${reason}`, "AbortError"));
}

/**
 * 임대가 아직 활성인가. 단계 함수와 명령이 기다린 뒤의 상태를 다시 읽는다(호출 앞의 검사로 좁혀진 타입을 그대로 믿지 않는다)
 */
function isActive(lease: LeaseRuntime): boolean {
  return lease.status === "active";
}

/** 명령이 거부 결과가 되는 `StepOutcome`. 예외가 아니다 */
function refusal(code: string): StepOutcome {
  return { kind: "result", result: { kind: "refused", code } };
}

/**
 * 맡긴 프레임을 다시 주도하게 한다. 위 프레임의 결과(`done`)나 끊김(`aborted`)이 이 프레임의 첫 `last`다. 커밋 뒤에만 부른다
 */
function resumeWaiting(frame: LeaseRuntime, last: StepResult): void {
  frame.pendingLast = last;
  frame.state = "driving";
  frame.wantInvoke = true;
}

/** 스택의 `index`번 프레임과 그 위 프레임 전부를 반납한다. 그 프레임은 `reason`, 위 프레임은 `revoked`다 */
function releaseFrom(thread: ThreadRuntime, index: number, reason: ReleaseReason): void {
  thread.frames
    .slice(index)
    .forEach((frame, offset) => release(frame, offset === 0 ? reason : "revoked"));
}

function leaseError(lease: LeaseRuntime): PrimitiveError {
  return lease.reason === "budget"
    ? new PrimitiveError("lease_budget", `lease ${lease.leaseId} is out of budget`, {
        scopeId: lease.scopeId,
      })
    : new PrimitiveError("lease_revoked", `lease ${lease.leaseId} is no longer active`, {
        scopeId: lease.scopeId,
      });
}

function budgetOf(lease: LeaseRuntime): DriveLockBudget {
  return {
    turns: remaining(lease.limits.maxTurns, lease.used.turns),
    spawns: remaining(lease.limits.maxSpawns, lease.used.spawns),
    tokens: remaining(lease.limits.maxTokens, lease.used.tokens),
  };
}

function tokensOf(usage: Usage | null): number {
  return usage?.totalTokens ?? 0;
}

/**
 * 명령 호출 직전 한도 검사. 횟수 축은 `turns`와 `spawns`만 있고 `tokens`는 횟수 검사를 건너뛰고 토큰 소진만 본다.
 * 토큰 상한은 모든 명령의 호출 직전에 검사한다(spec §4.4.2 5번). 소진이면 `budget`으로 반납하고 `lease_budget`을 던진다
 */
function assertBudget(lease: LeaseRuntime, kind: "turns" | "spawns" | "tokens"): void {
  const countLeft =
    kind === "tokens"
      ? null
      : remaining(
          kind === "turns" ? lease.limits.maxTurns : lease.limits.maxSpawns,
          lease.used[kind],
        );
  const tokensLeft = remaining(lease.limits.maxTokens, lease.used.tokens);
  if ((countLeft !== null && countLeft <= 0) || (tokensLeft !== null && tokensLeft <= 0)) {
    release(lease, "budget");
    throw leaseError(lease);
  }
}

/** `tool` 명령 직전 검사: 이 프레임이 낸 `tool` 명령 수가 상한에 닿았으면 `budget`으로 반납한다 */
function assertToolCommandAllowed(lease: LeaseRuntime): void {
  const used = toolCommandCounts.get(lease) ?? 0;
  if (used >= MAX_DRIVE_TOOL_COMMANDS) {
    release(lease, "budget");
    throw leaseError(lease);
  }
  toolCommandCounts.set(lease, used + 1);
}

/** `tool`, `model` 명령을 부르기 직전 검사: 임대가 활성이고 토큰 상한이 남았는가 */
function assertCallAllowed(lease: LeaseRuntime): void {
  if (lease.status !== "active") throw leaseError(lease);
  assertBudget(lease, "tokens");
}

/**
 * 맨 위 프레임 `lease`가 쓴 양을 자기와 스택 아래 모든 프레임의 사용량에 더한다(drive-isolation.md 2.3). 맡긴 쪽의 남은 한도는
 * 이 값으로 줄어든다. `lease`가 이미 스택에서 내려갔으면(반납이 커밋된 뒤의 끝난 호출) 남은 프레임이 모두 아래 프레임이다
 */
function charge(
  thread: ThreadRuntime,
  lease: LeaseRuntime,
  delta: { readonly turns: number; readonly spawns: number; readonly tokens: number },
): void {
  const at = thread.frames.indexOf(lease);
  const below = at < 0 ? thread.frames : thread.frames.slice(0, at + 1);
  for (const frame of below) {
    frame.used.turns += delta.turns;
    frame.used.spawns += delta.spawns;
    frame.used.tokens += delta.tokens;
  }
}

/** 맡은 프레임 한도 한 항목: 실효 값을 맡긴 쪽의 남은 양으로 한 번 더 min한다. 맡긴 쪽에 상한이 없으면 실효 값 그대로다 */
function capInherited(
  own: number | undefined,
  parentLimit: number | undefined,
  parentUsed: number,
): number | undefined {
  const left = remaining(parentLimit, parentUsed);
  if (left === null) return own;
  return own === undefined ? left : Math.min(own, left);
}

/** 맡은 프레임의 한도(drive-isolation.md 2.3). 맡긴 프레임이 아직 쓰지 않은 양을 넘지 못한다 */
function inheritedLimits(own: DriveLimits, parent: LeaseRuntime): DriveLimits {
  const maxTurns = capInherited(own.maxTurns, parent.limits.maxTurns, parent.used.turns);
  const maxSpawns = capInherited(own.maxSpawns, parent.limits.maxSpawns, parent.used.spawns);
  const maxTokens = capInherited(own.maxTokens, parent.limits.maxTokens, parent.used.tokens);
  return {
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(maxSpawns === undefined ? {} : { maxSpawns }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

/** 승인 요청 키의 해시(F `requestKeyFor`가 받는 동기 해시). boundary.ts의 커밋 키 해시와 같은 방식이다 */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 승인 카드(`AskCard`)를 승인 요청의 질문 본문으로 옮긴다. 선택 필드는 값이 있을 때만 싣는다(exactOptionalPropertyTypes).
 * 필드 이름과 뜻이 같아 값만 옮긴다
 */
function questionBodyOf(card: AskCard): QuestionBody {
  return {
    questions: card.questions.map((question): QuestionItem => ({
      id: question.id,
      ...(question.header === undefined ? {} : { header: question.header }),
      text: question.text,
      options: question.options.map((option): QuestionOption => ({
        id: option.id,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
        ...(option.recommended === undefined ? {} : { recommended: option.recommended }),
      })),
      multiSelect: question.multiSelect,
      allowFreeText: question.allowFreeText,
    })),
  };
}

/** 승인 카드 제목의 기본값: 그룹 표시 이름(매니페스트 `displayName`). 없거나 비었으면 확장 이름 */
function approvalTitleOf(record: RegistrationRecord): string {
  const displayName = record.manifest.displayName;
  return displayName === undefined || displayName === "" ? record.extension : displayName;
}

/**
 * 해결된 승인을 `AskOutcome`으로 옮긴다. 답(`answer`)은 질문 답의 정본 모양이어야 하고, 맞지 않으면 기록이 깨진 것이다.
 * 답이 아닌 결정(거부, 취소, 만료, 비대화형)은 거부로 끝나며, 거부 사유(`feedback`)는 `DenyAnswer`가 있을 때만 싣는다
 */
function askOutcomeOf(resolution: ApprovalResolution, scopeId: RegistrationId): AskOutcome {
  if (resolution.decision === "answer") {
    const answer = parse(QuestionAnswerSchema, resolution.answer);
    if (!answer.ok) {
      throw new PrimitiveError("record_invalid", "the recorded answer is not a question answer", {
        scopeId,
      });
    }
    return { status: "answered", answer: answer.value };
  }
  const deny = parse(DenyAnswerSchema, resolution.answer);
  if (!deny.ok) return { status: "denied", resolvedBy: resolution.resolvedBy };
  return { status: "denied", resolvedBy: resolution.resolvedBy, feedback: deny.value.feedback };
}

/** 엔진이 명령을 실행하는 데 쓰는 안쪽 통로. 플러그인에게는 보이지 않는다(공개 계약은 `DriveStep`) */
interface StepLoop {
  turn(input: TurnInput): Promise<TurnOutcome>;
  spawn(spec: SpawnSpec): Promise<SpawnOutcome>;
  ask(request: AskRequest): Promise<AskOutcome>;
}

/** 한 호출 안에서 단계 사이에 이어 가는 값 */
interface StepProgress {
  last: StepResult | null;
  /** 요청 id 순번이 이어지는 상태 판과 다음 순번. 상태 판이 바뀌면 0부터 다시 센다(재시작 뒤 같은 단계가 같은 id를 만들게) */
  rev: number | null;
  nextIndex: number;
  totalEffects: number;
  quiet: number;
  /** `done`으로 끝났을 때 그 결과 */
  result: JsonValue | null;
}

/**
 * 한 단계의 실행이 끝난 모양. `result`면 다음 단계로 이어지고 나머지는 이번 호출이 끝난다. `handoff`는 맡겼다는 뜻이다:
 * 이 프레임은 기다리고 이번 호출이 끝난다(drive-isolation.md 2.1)
 */
type StepOutcome =
  | { readonly kind: "result"; readonly result: StepResult }
  | { readonly kind: "yield" }
  | { readonly kind: "done"; readonly result: JsonValue | null }
  | { readonly kind: "handoff" }
  | { readonly kind: "inactive" };

const INACTIVE: StepOutcome = { kind: "inactive" };

/** `commit`으로 감싼 명령의 맨 안쪽(실제로 실행되는 마지막) 명령 */
function finalCommandOf(command: DriveCommand<AnyState>): DriveCommand<AnyState> {
  return command.do === "commit" ? finalCommandOf(command.next) : command;
}

/** 명령 결과 하나를 단계 결과, 기록할 결과 요약, 효과 여부로 옮긴다. 효과는 실제로 실행이 끝난 호출만 센다 */
interface Settlement {
  readonly step: StepResult;
  readonly outcome: string;
  readonly effect: boolean;
}

function refusedSettlement(code: string): Settlement {
  return { step: { kind: "refused", code }, outcome: "refused", effect: false };
}

/**
 * 플러그인 기능 호출의 결과를 옮긴다(hooks-core-boundary §4.6). `denied`는 거부한 쪽이 있을 때만 `denied`이고(없으면 취소·만료라
 * `refused`), `blocked`의 출처는 ToolError가 싣지 못해 `{ plugin: null, hook: null }`이다
 */
function toolSettlementOf(result: Result<ToolResultView, ToolError>): Settlement {
  if (result.ok) {
    return {
      step: { kind: "ok", of: "tool", value: result.value },
      outcome: result.value.isError ? "error" : "completed",
      effect: true,
    };
  }
  const error = result.error;
  switch (error.kind) {
    case "denied":
      if (error.resolvedBy === undefined) return refusedSettlement("denied");
      return {
        step: { kind: "denied", by: error.resolvedBy, reason: error.message },
        outcome: "denied",
        effect: false,
      };
    case "blocked":
      return {
        step: { kind: "blocked", by: { plugin: null, hook: null }, reason: error.message },
        outcome: "blocked",
        effect: false,
      };
    case "aborted":
      return { step: { kind: "aborted" }, outcome: "aborted", effect: false };
    case "unavailable":
    case "invalid_args":
    case "hook_cycle":
    case "hook_depth":
    case "storage":
    case "unknown_outcome":
      return refusedSettlement(error.kind);
    default:
      return assertNever(error.kind, "toolSettlementOf");
  }
}

/** 명령 하나를 실행하는 문맥 */
interface StepContext {
  readonly thread: ThreadRuntime;
  readonly lease: LeaseRuntime;
  readonly record: RegistrationRecord;
  readonly generation: NonNullable<RegistrationRecord["generation"]>;
  readonly loop: StepLoop;
  readonly invocation: DriveInvocation;
  /** 이 단계의 `last`가 사용자 메시지이면 그 메시지의 순번. 그 메시지로 여는 turn의 기본 요청 id 재료다 */
  readonly userSeq: number | null;
}

/** 예외가 "거부" 결과가 될 수 있으면 그 코드. PrimitiveError는 `code`, 루프 거부는 `kind`를 쓴다. 그 밖은 버그라 undefined */
function refusalCodeOf(error: unknown): string | undefined {
  if (error instanceof PrimitiveError) return error.code;
  if (error instanceof Error && "kind" in error && typeof error.kind === "string") {
    return error.kind;
  }
  return undefined;
}

/** 승인 결과를 단계 결과로 옮긴다. 사람이 거부했으면 `denied`, 취소·만료·무인 처리는 `ask`의 변형이다 */
function askStepResult(outcome: AskOutcome): StepResult {
  if (outcome.status === "answered") {
    return { kind: "ask", answer: "answered", value: outcome.answer };
  }
  switch (outcome.resolvedBy) {
    case "user":
      return { kind: "denied", by: "human", reason: outcome.feedback ?? null };
    case "noninteractive":
      return { kind: "ask", answer: "noninteractive", value: null };
    case "expired":
      return { kind: "ask", answer: "expired", value: null };
    case "cancelled":
    case "superseded":
    // 플러그인의 `ask.human.before`가 질문을 취소한 경우다. 주도 쪽에는 취소로 보인다
    case "extension":
      return { kind: "ask", answer: "cancelled", value: null };
    default:
      return assertNever(outcome.resolvedBy, "askStepResult");
  }
}

/** 명령 실행 하나를 부른다. 임대가 더는 활성이 아니면 이번 호출을 끝내고, 거부 사유가 있으면 `refused` 결과로 바꾼다 */
async function runGuarded<T>(
  ctx: StepContext,
  call: () => Promise<T>,
): Promise<
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly out: StepOutcome }
> {
  const called = await attemptAsync(call);
  if (called.ok) return { ok: true, value: called.value };
  const cause = called.error.cause;
  if (ctx.lease.status !== "active") return { ok: false, out: INACTIVE };
  if (
    cause instanceof PrimitiveError &&
    (cause.code === "lease_revoked" || cause.code === "lease_budget")
  ) {
    return { ok: false, out: INACTIVE };
  }
  const code = refusalCodeOf(cause);
  if (code === undefined) throw cause;
  return { ok: false, out: { kind: "result", result: { kind: "refused", code } } };
}

export interface LeaseBrokerHooks {
  /** 함수 쪽 사유로 반납이 정해진 뒤(error, idle) 다음 경계를 기다리지 않고 유휴 적용을 예약한다 */
  requestApply(threadId: ThreadRuntime["threadId"]): void;
}

/** 프레임 하나를 만드는 재료. 부여와 복원이 같은 모양을 만든다 */
interface FrameInit {
  readonly leaseId: string;
  readonly lineageId: string;
  readonly scopeId: RegistrationId;
  readonly threadId: ThreadId;
  readonly leaseEpoch: number;
  readonly limits: DriveLimits;
  readonly used: { turns: number; spawns: number; tokens: number };
  readonly parent: string | null;
  readonly depth: number;
  readonly contentHash: string | null;
  readonly calledBy: string | null;
  readonly input: JsonValue | null;
  readonly state: "driving" | "waiting";
  readonly wantInvoke: boolean;
  readonly committed: boolean;
  readonly restoring: boolean;
}

function frameOf(init: FrameInit): LeaseRuntime {
  return {
    leaseId: init.leaseId,
    lineageId: init.lineageId,
    scopeId: init.scopeId,
    threadId: init.threadId,
    leaseEpoch: init.leaseEpoch,
    limits: init.limits,
    used: init.used,
    status: "active",
    reason: undefined,
    abort: new AbortController(),
    parent: init.parent,
    depth: init.depth,
    contentHash: init.contentHash,
    restoring: init.restoring,
    state: init.state,
    asking: false,
    input: init.input,
    pendingLast: null,
    calledBy: init.calledBy,
    result: null,
    wantInvoke: init.wantInvoke,
    idleStreak: 0,
    idleRev: null,
    lastBaseRev: null,
    running: false,
    missed: false,
    firstStepDone: false,
    userSeq: 0,
    inbox: [],
    userSteps: null,
    deliveredUser: null,
    committed: init.committed,
  };
}

/**
 * 실행 하나의 추적 표지. 단계 함수가 질문을 기다리는 동안에는 추적을 떼어, `whenSettled`(시험의 settled, 교체, 종료)가
 * 사람의 답을 기다리며 멈추지 않게 한다. 답이 오면 다시 건다
 */
interface RunTrack {
  current: PromiseWithResolvers<void> | null;
}

/** 주도 중인 scope가 꺼지거나 정의가 지워질 때: 그 scope의 가장 아래 프레임과 그 위 프레임을 반납한다 */
function releaseScope(thread: ThreadRuntime, scopeId: RegistrationId, reason: ReleaseReason): void {
  const index = thread.frames.findIndex((frame) => frame.scopeId === scopeId);
  if (index >= 0) releaseFrom(thread, index, reason);
}

/**
 * 복원된 프레임을 아래에서 위로 확인한다. 이 경계의 적용 뒤에도 scope가 켜져 있지 않으면 그 프레임과 위 프레임을 `restart`로 반납한다
 * (`activating`은 이 경계에서 켜지는 scope다)
 */
function verifyRestored(thread: ThreadRuntime, txn: BoundaryTxn): void {
  for (const frame of thread.frames) {
    if (!frame.restoring) continue;
    frame.restoring = false;
    const alive =
      thread.active.has(frame.scopeId) ||
      txn.activating.some((record) => record.id === frame.scopeId);
    if (!alive) {
      releaseFrom(thread, thread.frames.indexOf(frame), "restart");
      return;
    }
  }
}

export function createLeaseBroker(
  core: HostCore,
  stateService: StateService,
  hooks: LeaseBrokerHooks,
): LeaseBroker {
  /** 맨 위 프레임이 도는 실행의 추적 표지(프레임마다). `start`가 만들고 `ask`가 떼고 붙인다 */
  const tracks = new WeakMap<LeaseRuntime, RunTrack>();

  function loopStatusIdle(threadId: LeaseRuntime["threadId"]): boolean {
    const loop = core.ports.get(LoopPortKey);
    return loop === undefined || loop.status(threadId) !== "running";
  }

  function warnPortOnce(thread: ThreadRuntime, name: string): void {
    if (thread.warnedPorts.has(name)) return;
    thread.warnedPorts.add(name);
    core.deps.report({
      level: "warning",
      code: "port_unavailable",
      message: `${name} is not provided, so no drive lease is granted`,
    });
  }

  function trackRun(track: RunTrack): void {
    const done = Promise.withResolvers<void>();
    track.current = done;
    core.track(done.promise);
  }

  function untrackRun(track: RunTrack): void {
    track.current?.resolve();
    track.current = null;
  }

  /** 질문 대기 중인 실행을 추적에서 뗀다. 답이 오면 `resumeRun`이 다시 건다 */
  function parkRun(lease: LeaseRuntime): void {
    const track = tracks.get(lease);
    if (track !== undefined) untrackRun(track);
  }

  function resumeRun(lease: LeaseRuntime): void {
    const track = tracks.get(lease);
    if (track !== undefined && track.current === null) trackRun(track);
  }

  function makeStepLoop(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    invocation: DriveInvocation,
  ): StepLoop {
    const requireLoop = () => {
      const loop = core.ports.get(LoopPortKey);
      if (loop === undefined) {
        throw new PrimitiveError("port_unavailable", "fresnel.loop (LoopPort) is not provided", {
          scopeId: lease.scopeId,
        });
      }
      return loop;
    };
    return {
      // X-17 `ask` 명령(X.primitives.spec §4.4.4, drive-isolation.md 2.1·2.6). 임대는 반납하지 않는다. 프레임 상태만 질문 대기가 되고,
      // 답이나 반납(끊김)이 올 때까지 이 호출이 기다린다. 답이 이미 있으면 기록된 결과를 바로 돌려준다.
      // 기다리는 동안 turn·spawn 예산과 호출 순번은 쓰지 않는다
      async ask(request: AskRequest): Promise<AskOutcome> {
        if (lease.status !== "active") throw leaseError(lease);
        const approvals = core.ports.get(ApprovalServicePortKey);
        if (approvals === undefined) {
          throw new PrimitiveError(
            "port_unavailable",
            "fresnel.approvals (ApprovalService) is not provided",
            { scopeId: lease.scopeId },
          );
        }
        // 경계 입력이므로 스키마로 검사한다(TY-10). 맞지 않는 요청은 승인을 만들기 전에 거부한다
        const checked = parse(AskRequestSchema, request);
        if (!checked.ok) {
          throw new PrimitiveError("record_invalid", "loop.ask request is not an AskRequest", {
            scopeId: lease.scopeId,
          });
        }
        const record = core.scopes.get(lease.scopeId);
        // 활성 프레임의 scope는 정의가 있어야 한다. 정의를 지우기 전에 teardown이 프레임을 반납한다
        if (record === undefined) throw new Bug("loop.ask_scope_missing_for_active_lease");
        const opened = await approvals.open({
          origin: {
            threadId: lease.threadId,
            turnId: null,
            stepId: null,
            toolCallId: null,
            caller: `ext:${record.extension}`,
          },
          // Registration id를 넣어 두 Registration이 같은 requestId를 써도 승인이 겹치지 않게 한다
          requestKey: requestKeyFor(`ask:${lease.scopeId}:${checked.value.requestId}`, sha256Hex),
          title: checked.value.title ?? approvalTitleOf(record),
          body: { kind: "question", question: questionBodyOf(checked.value.card) },
          remember: ["once"],
        });
        if (!opened.ok) {
          throw new PrimitiveError(
            "storage_unavailable",
            `the question approval could not be opened (${opened.error.kind})`,
            { scopeId: lease.scopeId },
          );
        }
        const { request: approval, resolution } = opened.value;
        // 이미 답이 있으면(재시작 뒤의 재호출, 같은 requestId의 되돌아온 호출) 기록된 결과를 돌려준다
        if (resolution !== null) return askOutcomeOf(resolution, lease.scopeId);
        // 답을 기다린다. 프레임은 질문 대기가 되고 임대는 그대로다(drive-isolation.md 2.1). 반납이나 닫기가 기다림을 끊는다
        lease.asking = true;
        parkRun(lease);
        const signal = AbortSignal.any([thread.abort.signal, lease.abort.signal]);
        const waited = await approvals.wait(approval.approvalId, signal).finally(() => {
          lease.asking = false;
          resumeRun(lease);
        });
        if (!waited.ok) {
          // 기다림이 끊겼다(반납, 닫기). 임대가 활성이 아니면 runGuarded가 이 거부를 inactive로 본다
          if (waited.error.kind === "aborted") throw leaseError(lease);
          throw new PrimitiveError(
            "storage_unavailable",
            "the question approval is not waiting in this runtime",
            { scopeId: lease.scopeId },
          );
        }
        return askOutcomeOf(waited.value, lease.scopeId);
      },
      async turn(input: TurnInput): Promise<TurnOutcome> {
        if (lease.status !== "active") throw leaseError(lease);
        assertBudget(lease, "turns");
        const loop = requireLoop();
        const index = invocation.i;
        invocation.i += 1;
        const requestId = input.requestId ?? `${lease.lineageId}:${invocation.baseRev}.${index}`;
        // turn 안의 도구와 서비스는 재실행되는 문맥이 아니다. drive의 ambient가 따라 들어가지 않게 끊는다(ADR-0015 §3.1 1번)
        const result = await withoutAmbient(() =>
          loop.runTurn({
            threadId: lease.threadId,
            scopeId: lease.scopeId,
            leaseId: lease.leaseId,
            leaseEpoch: lease.leaseEpoch,
            requestId,
            input: input.input,
            // 반납이 진행 중인 turn을 끊지 않게 lease.signal이 아니라 thread 신호를 넘긴다
            signal: thread.abort.signal,
          }),
        );
        if (!result.replayed) {
          charge(thread, lease, { turns: 1, spawns: 0, tokens: tokensOf(result.usage) });
          invocation.effects += 1;
        }
        return result.outcome;
      },
      async spawn(spec: SpawnSpec): Promise<SpawnOutcome> {
        if (lease.status !== "active") throw leaseError(lease);
        assertBudget(lease, "spawns");
        const loop = requireLoop();
        const index = invocation.i;
        invocation.i += 1;
        const requestId = spec.requestId ?? `${lease.lineageId}:${invocation.baseRev}.${index}`;
        const result = await withoutAmbient(() =>
          loop.spawn({
            threadId: lease.threadId,
            scopeId: lease.scopeId,
            leaseId: lease.leaseId,
            leaseEpoch: lease.leaseEpoch,
            requestId,
            spec,
            signal: lease.abort.signal,
          }),
        );
        if (!result.replayed) {
          charge(thread, lease, { turns: 0, spawns: 1, tokens: tokensOf(result.usage) });
          invocation.effects += 1;
        }
        return result.outcome;
      },
    };
  }

  /**
   * 명령 결과를 대화 로그에 남긴다(`drive.command_settled`, 결정 U1). 커밋 키가 (임대 scope, 명령 요청 id)라
   * 재시작 뒤 같은 단계가 다시 돌아도 사건이 하나만 남는다
   */
  async function recordSettled(
    ctx: StepContext,
    requestId: string,
    command: "turn" | "ask" | "spawn" | "model" | "tool",
    outcome: string,
    ref?: string,
  ): Promise<void> {
    const records = core.ports.get(RecordCommitPortKey);
    if (records === undefined) return;
    const { thread, lease } = ctx;
    const result = await records.commit({
      threadId: thread.threadId,
      requestId: `dcs:${sha256Hex(`${lease.scopeId}|${requestId}`).slice(0, 40)}`,
      drafts: [
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "drive.command_settled",
          payload: {
            scopeId: lease.scopeId,
            requestId,
            command,
            outcome,
            ...(ref === undefined ? {} : { ref }),
          },
        }),
      ],
    });
    if (result.status === "rejected") {
      throw new PrimitiveError(
        "storage_unavailable",
        `the drive command result could not be recorded: ${result.code}`,
        { scopeId: lease.scopeId },
      );
    }
  }

  /** 필요한 포트를 얻는다. 없으면 `port_unavailable`로 던지고 `runGuarded`가 거부 결과로 바꾼다(`requireLoop`와 같은 방식) */
  function requirePortOf<T>(key: PortKey<T>, label: string, lease: LeaseRuntime): T {
    const port = core.ports.get(key);
    if (port === undefined) {
      throw new PrimitiveError("port_unavailable", `${label} is not provided`, {
        scopeId: lease.scopeId,
      });
    }
    return port;
  }

  /**
   * 맡을 플러그인(확장 이름)의 scope. 한 확장이 플러그인 여럿을 등록하면 scope가 여럿이므로, 이름과 id가 같은 루트를 고르고
   * 그것도 없으면 하나뿐일 때만 고른다. 고를 수 없으면 `null`이다
   */
  function handoffTargetOf(name: string): RegistrationRecord | null {
    const same = [...core.scopes.values()].filter((record) => record.extension === name);
    const root = same.find((record) => record.id === name);
    if (root !== undefined) return root;
    return same.length === 1 ? (same[0] ?? null) : null;
  }

  /** 맡긴 프레임의 플러그인 이름. 기록의 `parent`로 맡긴 프레임을 찾아 그 scope의 확장 이름을 낸다. 맡긴 것이 아니면 null */
  function callerNameOf(open: readonly OpenLease[], parent: string | null): string | null {
    if (parent === null) return null;
    const scopeId = open.find((item) => item.leaseId === parent)?.scopeId;
    return scopeId === undefined ? null : (core.scopes.get(scopeId)?.extension ?? null);
  }

  /**
   * `handoff` 명령(drive-isolation.md 2.1). 거부할 것이면 `refused` 결과로 돌려준다(예외가 아니다). 맞으면 맡을 요청을 큐 맨 앞에 넣고
   * 맡긴 프레임을 `waiting`으로 둔 뒤 이번 호출을 끝낸다. 부여는 다음 경계에서 한다(`decideHandoff`)
   */
  function handoffOf(
    ctx: StepContext,
    command: { readonly to: string; readonly input: JsonValue },
  ): StepOutcome {
    const { thread, lease, record } = ctx;
    if (lease.status !== "active") return INACTIVE;
    if (command.to === record.extension) return refusal("self_handoff");
    if (thread.frames.some((frame) => core.scopes.get(frame.scopeId)?.extension === command.to)) {
      return refusal("already_in_stack");
    }
    const target = handoffTargetOf(command.to);
    if (target === null || drivableOf(thread, target.id, null) === null) {
      return refusal("target_unavailable");
    }
    // 새 프레임이 스택에 들어간 뒤의 길이(코어 루프 위 프레임 수)가 상한을 넘으면 거부한다
    if (thread.frames.length + 1 > core.deps.settings.driveMaxDepth(thread.threadId)) {
      return refusal("depth_limit");
    }
    thread.startQueue.unshift({
      scopeId: target.id,
      trigger: "handoff",
      input: command.input,
      parentLeaseId: lease.leaseId,
    });
    lease.state = "waiting";
    return { kind: "handoff" };
  }

  /** 명령 하나를 블록으로 실행한다. `handoff`는 `handoffOf`가 맡는다 */
  async function executeCommand(
    ctx: StepContext,
    command: DriveCommand<AnyState>,
  ): Promise<StepOutcome> {
    const { lease, invocation, loop, thread, record, generation } = ctx;
    const nextId = (): string =>
      ctx.userSeq === null
        ? `${lease.lineageId}:${invocation.baseRev}.${invocation.i}`
        : `${lease.lineageId}:u${String(ctx.userSeq)}.${invocation.i}`;
    switch (command.do) {
      case "turn": {
        const requestId = command.requestId ?? nextId();
        const ran = await runGuarded(ctx, () => loop.turn({ input: command.input, requestId }));
        if (!ran.ok) return ran.out;
        await recordSettled(ctx, requestId, "turn", ran.value.status, ran.value.turnId);
        if (ran.value.status === "aborted" && thread.userStopped) {
          return { kind: "result", result: { kind: "aborted" } };
        }
        return { kind: "result", result: { kind: "ok", of: "turn", value: ran.value } };
      }
      case "spawn": {
        const requestId = command.requestId ?? nextId();
        const ran = await runGuarded(ctx, () =>
          loop.spawn({
            agent: command.agent,
            task: command.task,
            requestId,
            ...(command.background === undefined ? {} : { background: command.background }),
            ...(command.label === undefined ? {} : { label: command.label }),
          }),
        );
        if (!ran.ok) return ran.out;
        await recordSettled(ctx, requestId, "spawn", ran.value.status, ran.value.childThreadId);
        return { kind: "result", result: { kind: "ok", of: "spawn", value: ran.value } };
      }
      case "ask": {
        const requestId = command.requestId ?? nextId();
        const ran = await runGuarded(ctx, () =>
          loop.ask({
            requestId,
            card: command.card,
            ...(command.title === undefined ? {} : { title: command.title }),
          }),
        );
        if (!ran.ok) return ran.out;
        await recordSettled(
          ctx,
          requestId,
          "ask",
          ran.value.status === "answered" ? "answered" : ran.value.resolvedBy,
        );
        return { kind: "result", result: askStepResult(ran.value) };
      }
      case "tool": {
        const requestId = command.requestId ?? nextId();
        // 도구 실행은 관문 전체를 지난다(플러그인 판정 훅, 권한, 승인, 샌드박스, 실행 기록). 턴 안의 도구와 같은 ambient 분리를 쓴다
        const ran = await runGuarded(ctx, () => {
          assertCallAllowed(lease);
          assertToolCommandAllowed(lease);
          const tools = requirePortOf(ToolsPortKey, "fresnel.tools (ToolsPort)", lease);
          return withoutAmbient(() =>
            tools.executeForPlugin({
              threadId: lease.threadId,
              plugin: { name: record.extension, scopeId: lease.scopeId },
              via: "drive",
              target: { kind: "tool", name: command.name },
              input: command.args,
              requestId,
              signal: lease.abort.signal,
            }),
          );
        });
        if (!ran.ok) return ran.out;
        const settled = toolSettlementOf(ran.value);
        if (settled.effect) invocation.effects += 1;
        await recordSettled(ctx, requestId, "tool", settled.outcome);
        return { kind: "result", result: settled.step };
      }
      case "model": {
        const requestId = command.requestId ?? nextId();
        // 메시지가 없거나 시스템 메시지뿐이면 제공자에게 보낼 대화가 없다. 호출하지 않고 거부한다
        if (command.messages.every((message) => message.role === "system")) {
          return { kind: "result", result: { kind: "refused", code: "input_invalid" } };
        }
        const ran = await runGuarded(ctx, () => {
          assertCallAllowed(lease);
          const models = requirePortOf(ModelsPortKey, "fresnel.models (ModelsPort)", lease);
          return withoutAmbient(() =>
            models.completeForPlugin({
              threadId: lease.threadId,
              plugin: { name: record.extension, scopeId: lease.scopeId },
              requestId,
              messages: command.messages,
              ...(command.label === undefined ? {} : { label: command.label }),
              signal: lease.abort.signal,
            }),
          );
        });
        if (!ran.ok) return ran.out;
        const called = ran.value;
        if (!called.ok) {
          if (called.error.kind === "aborted") {
            await recordSettled(ctx, requestId, "model", "aborted");
            return { kind: "result", result: { kind: "aborted" } };
          }
          // 가드 차단과 제공자 오류는 효과로 세지 않는다. 같은 단계가 계속 실패하면 연속 상한(MAX_CHAINED_REINVOKES)에서 끝난다
          await recordSettled(ctx, requestId, "model", "refused");
          return { kind: "result", result: { kind: "refused", code: called.error.kind } };
        }
        const { replayed, ...value } = called.value;
        // 같은 프로세스 안의 재생은 처음 호출에서 이미 차감했다(drive-isolation.md §2.3)
        if (!replayed)
          charge(thread, lease, { turns: 0, spawns: 0, tokens: value.usage?.total ?? 0 });
        invocation.effects += 1;
        await recordSettled(ctx, requestId, "model", "completed");
        return { kind: "result", result: { kind: "ok", of: "model", value } };
      }
      case "commit": {
        const committed = await runGuarded(ctx, () =>
          stateService.commit(record, generation, command.state),
        );
        if (!committed.ok) return committed.out;
        return executeCommand(ctx, command.next);
      }
      case "yield":
        return { kind: "yield" };
      case "done":
        return { kind: "done", result: command.result ?? null };
      case "handoff":
        return handoffOf(ctx, command);
      default:
        return assertNever(command, "executeCommand");
    }
  }

  /** 전달 중이던 사용자 메시지를 코어 루프로 돌려보낸다. 입력 큐에 다음 입력으로 넣어 평소처럼 처리되게 한다 */
  function returnUserMessage(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    item: PostItem,
    index = 0,
  ): void {
    const queue = core.ports.get(InputQueuePortKey);
    if (queue === undefined) return;
    detach(
      queue
        .enqueue({
          threadId: thread.threadId,
          scopeId: lease.scopeId,
          requestId: `user-return:${lease.leaseId}:${String(index)}`.slice(0, 64),
          // `next`는 도는 turn에 붙기만 하고 유휴 thread에서 turn을 시작하지 않는다. 돌려받은 사용자 말은 끝난 뒤에라도 turn이 되어야 한다
          when: "followUp",
          item,
        })
        .then(() => undefined),
      (cause) => {
        core.deps.report({
          level: "error",
          code: "handler_failed",
          scopeId: lease.scopeId,
          message: "a user message could not be handed back to the loop",
          cause,
        });
      },
    );
  }

  /** 부여를 기다리던 사용자 메시지를 코어 루프로 돌려보낸다. 프레임도 시작 요청도 없을 때만 부른다(요청이 남았으면 그 요청이 받는다) */
  function returnHeldIfUnclaimed(thread: ThreadRuntime): void {
    if (thread.heldUser.length === 0) return;
    if (thread.frames.length > 0) return;
    if (thread.startQueue.some((entry) => entry.trigger !== "handoff")) return;
    const queue = core.ports.get(InputQueuePortKey);
    const held = thread.heldUser.splice(0);
    if (queue === undefined) return;
    for (const message of held) {
      detach(
        queue
          .enqueue({
            threadId: thread.threadId,
            scopeId: message.scopeId,
            requestId: `user-return:${message.requestId}`.slice(0, 64),
            when: "followUp",
            item: message.item,
          })
          .then(() => undefined),
        (cause) => {
          core.deps.report({
            level: "error",
            code: "handler_failed",
            scopeId: message.scopeId,
            message: "a held user message could not be handed back to the loop",
            cause,
          });
        },
      );
    }
  }

  /** 임대가 내려가면 전달하지 못한 사용자 메시지를 코어 루프로 돌려보낸다(메시지가 묻히지 않게) */
  function flushUserMessages(thread: ThreadRuntime, lease: LeaseRuntime): void {
    const pending = [
      ...(lease.deliveredUser === null ? [] : [lease.deliveredUser]),
      ...lease.inbox,
    ];
    lease.deliveredUser = null;
    lease.userSteps = null;
    lease.inbox.length = 0;
    pending.forEach((item, index) => {
      returnUserMessage(thread, lease, item, index);
    });
  }

  /**
   * 다음 단계의 `last`를 정한다. 전달할 사용자 메시지가 있으면 그 메시지가 `last`다(2.4).
   * 전달한 메시지를 단계 함수가 `USER_MESSAGE_STEP_LIMIT` 단계 안에 처리하지 않으면 임대를 내리고 메시지를 코어 루프로 돌려보낸다.
   * 처리는 `turn`이나 `done` 명령이다. 돌려보냈으면 참
   */
  function nextLast(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    last: StepResult | null,
  ): { readonly last: StepResult | null; readonly handedBack: boolean } {
    if (lease.deliveredUser !== null && lease.userSteps !== null) {
      lease.userSteps += 1;
      if (lease.userSteps > USER_MESSAGE_STEP_LIMIT) {
        returnUserMessage(thread, lease, lease.deliveredUser);
        lease.deliveredUser = null;
        lease.userSteps = null;
        // 사용자 말이 묻히지 않게 스택 전체를 내린다(drive-isolation.md 2.4). 아래 프레임의 메시지는 그 프레임의 반납 때 돌려보낸다
        releaseFrom(thread, 0, "revoked");
        return { last, handedBack: true };
      }
    }
    // 첫 단계가 끝나기 전에는 메시지를 전달하지 않는다(시작 주도가 항상 먼저)
    if (!lease.firstStepDone) return { last, handedBack: false };
    const message = lease.inbox.shift();
    if (message === undefined) return { last, handedBack: false };
    lease.deliveredUser = message;
    lease.userSteps = 0;
    lease.userSeq += 1;
    return { last: { kind: "user", message }, handedBack: false };
  }

  /**
   * 단계를 하나씩 돌린다: 단계 함수에 입력을 주고, 돌려받은 명령을 실행하고, 결과를 다음 단계의 `last`로 준다.
   * `yield`, `done`, 임대 반납, 효과 없는 단계의 상한(`MAX_CHAINED_REINVOKES`)에서 끝난다
   */
  async function runSteps(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    record: RegistrationRecord,
    generation: NonNullable<RegistrationRecord["generation"]>,
    drive: NonNullable<NonNullable<RegistrationRecord["generation"]>["drive"]>,
    progress: StepProgress,
  ): Promise<"yield" | "done" | "inactive" | "handoff"> {
    if (lease.status !== "active") return "inactive";
    const next = nextLast(thread, lease, progress.last);
    if (next.handedBack) return "inactive";
    const baseRev = stateService.revOf(thread.threadId, lease.scopeId);
    if (progress.rev !== baseRev) {
      progress.rev = baseRev;
      progress.nextIndex = 0;
    }
    const invocation: DriveInvocation = {
      leaseId: lease.leaseId,
      lineageId: lease.lineageId,
      baseRev,
      signal: lease.abort.signal,
      i: progress.nextIndex,
      effects: 0,
    };
    const ctx: StepContext = {
      thread,
      lease,
      record,
      generation,
      loop: makeStepLoop(thread, lease, invocation),
      invocation,
      userSeq: next.last?.kind === "user" ? lease.userSeq : null,
    };
    const outcome = await withAmbient(
      {
        threadId: thread.threadId,
        scopeId: lease.scopeId,
        point: null,
        dispatchKey: null,
        counter: 0,
        drive: invocation,
        handler: null,
      },
      async () => {
        const command = await drive.fn({
          state: stateAs(stateService.docOf(thread.threadId, lease.scopeId)),
          last: next.last,
          budget: budgetOf(lease),
          frame: { frameDepth: lease.depth + 1, calledBy: lease.calledBy, input: lease.input },
        });
        if (lease.deliveredUser !== null) {
          // 처리는 `turn`(commit으로 감싸도 같다)이나 `done`이다. `done`으로 물러나면 메시지는 코어 루프가 받는다
          const final = finalCommandOf(command);
          if (final.do === "turn" || final.do === "done") {
            if (final.do === "done") returnUserMessage(thread, lease, lease.deliveredUser);
            lease.deliveredUser = null;
            lease.userSteps = null;
          }
        }
        return executeCommand(ctx, command);
      },
    );
    lease.firstStepDone = true;
    progress.nextIndex = Math.max(invocation.i, progress.nextIndex + 1);
    progress.totalEffects += invocation.effects;
    progress.quiet = invocation.effects > 0 ? 0 : progress.quiet + 1;
    if (outcome.kind === "done") progress.result = outcome.result;
    // 단계 하나가 끝난 경계다. 사용자 명령이 기다리고 정책이 허락하면 스택 전체를 내린다(drive-isolation.md 2.2).
    // `done`으로 끝난 맨 위는 invoke가 따로 맡는다(맨 위는 done으로 내려가고 아래만 revoked가 된다)
    if (isActive(lease) && outcome.kind !== "done") {
      const takeover = userTakeover(thread);
      if (takeover !== null && shouldSwitchNow({ running: true, asking: false, stepEnded: true })) {
        switchForUser(thread, takeover);
        return "inactive";
      }
    }
    if (outcome.kind !== "result") return outcome.kind;
    progress.last = outcome.result;
    if (progress.quiet >= MAX_CHAINED_REINVOKES) {
      core.deps.report({
        level: "info",
        code: "scope_notice",
        scopeId: lease.scopeId,
        extension: record.extension,
        message: `drive of ${lease.scopeId} ran ${String(MAX_CHAINED_REINVOKES)} commands in a row without an effect; it is asked again at the next boundary`,
      });
      return "yield";
    }
    return runSteps(thread, lease, record, generation, drive, progress);
  }

  async function invoke(thread: ThreadRuntime, lease: LeaseRuntime): Promise<void> {
    const record = core.scopes.get(lease.scopeId);
    const generation = record?.generation;
    if (record === undefined || generation === null || generation === undefined) {
      release(lease, "disabled");
      lease.running = false;
      return;
    }
    if (generation.stale) {
      // 공급자 재시작으로 세대를 다시 만드는 중이다. 임대는 두고 다음 경계에서 새 단계 함수로 이어 간다
      lease.running = false;
      lease.wantInvoke = true;
      return;
    }
    const drive = generation.drive;
    if (drive === null) {
      release(lease, "disabled");
      lease.running = false;
      return;
    }
    const startRev = stateService.revOf(thread.threadId, lease.scopeId);
    // 반납된 위 프레임의 결과는 이 프레임의 첫 `last`다(맡기기 복귀). 한 번만 쓴다
    const first = lease.pendingLast;
    lease.pendingLast = null;
    const progress: StepProgress = {
      last: first,
      rev: null,
      nextIndex: 0,
      totalEffects: 0,
      quiet: 0,
      result: null,
    };
    let end: "yield" | "done" | "inactive" | "handoff" = "yield";
    try {
      end = await runSteps(thread, lease, record, generation, drive, progress);
    } catch (error) {
      lease.running = false;
      if (lease.status !== "active") {
        // 상한 소진·회수로 이미 반납이 정해졌다. 거부를 그대로 던진 것은 오류가 아니다
        if (lease.status === "releasing") hooks.requestApply(thread.threadId);
        return;
      }
      // 프로세스가 끝나서(종료, 시간 초과) 생긴 실패는 등록을 고장으로 표시하지 않는다. 감독이 한 번 다시 띄우고, 다음 시작 요청이
      // 새 프레임을 맡는다(drive-isolation.md 3.3). 그 밖의 던짐은 단계 오류다
      if (isPluginProcessError(error)) {
        core.deps.report({
          level: "error",
          code: error.reason,
          scopeId: lease.scopeId,
          extension: record.extension,
          message: "drive step ended with its plugin process; lease released with error",
          cause: error,
        });
      } else {
        record.driveError = true;
        record.lastError = {
          code: error instanceof PrimitiveError ? error.code : "registration_setup_failed",
          message: error instanceof Error ? error.message : "drive step threw",
        };
        core.deps.report({
          level: "error",
          code: error instanceof PrimitiveError ? error.code : "handler_failed",
          scopeId: lease.scopeId,
          extension: record.extension,
          message: "drive step threw; lease released with error",
          cause: error,
        });
      }
      release(lease, "error");
      hooks.requestApply(thread.threadId);
      return;
    }
    lease.running = false;
    const endRev = stateService.revOf(thread.threadId, lease.scopeId);
    lease.lastBaseRev = endRev;
    // 맡긴 프레임은 사용자 메시지를 맨 위에게 넘기지 않으므로 여기서 코어 루프로 돌려보낸다
    if (lease.status !== "active" || end === "done" || end === "handoff") {
      flushUserMessages(thread, lease);
    }
    if (end === "done" && lease.status === "active") {
      lease.result = progress.result;
      release(lease, "done");
      // 맨 위가 끝났고 아래 프레임이 있으며 사용자 명령이 기다리면, 아래 프레임은 맡긴 결과를 받지 않고 revoked로 내린다
      if (thread.frames.length > 1) {
        const takeover = userTakeover(thread);
        if (
          takeover !== null &&
          shouldSwitchNow({ running: true, asking: false, stepEnded: true })
        ) {
          switchForUser(thread, takeover);
        }
      }
      hooks.requestApply(thread.threadId);
      return;
    }
    if (lease.status !== "active") {
      if (lease.status === "releasing") hooks.requestApply(thread.threadId);
      return;
    }
    // 맡겼다: 이 프레임은 기다리고 부여는 다음 경계에서 한다. 같은 호출을 다시 부르지 않는다
    if (end === "handoff") {
      hooks.requestApply(thread.threadId);
      return;
    }
    // 같은 상태 판으로 효과 없이 두 번 연속 `yield`로 끝나면 idle 반납(X.primitives.spec §4.4.3)
    if (progress.totalEffects > 0) {
      lease.idleStreak = 0;
    } else if (lease.idleRev === startRev) {
      lease.idleStreak += 1;
    } else {
      lease.idleRev = startRev;
      lease.idleStreak = 1;
    }
    // 전달한 사용자 메시지를 아직 처리하지 않았으면 idle로 내리지 않는다: 아래에서 다시 불러 단계 한도 안에 돌려보내게 한다
    if (lease.idleStreak >= 2 && lease.inbox.length === 0 && lease.deliveredUser === null) {
      release(lease, "idle");
      hooks.requestApply(thread.threadId);
      return;
    }
    // 실행 중에 호출 조건이 지나갔거나 사용자 메시지가 와 있고 thread가 유휴면 바로 다시 부른다
    // 전달한 메시지를 `yield`로 넘겼으면 다음 경계를 기다리지 않고 다시 불러 단계를 센다(2.4: 3단계 안에 처리하지 않으면 코어 루프로 돌아간다)
    if (
      (lease.missed || lease.inbox.length > 0 || lease.deliveredUser !== null) &&
      loopStatusIdle(thread.threadId)
    ) {
      start(thread, lease);
    }
  }

  function start(thread: ThreadRuntime, lease: LeaseRuntime): void {
    // 맡기고 기다리는 프레임은 위 프레임이 끝나 `pendingLast`를 받을 때까지 단계 함수를 부르지 않는다
    if (lease.state !== "driving") return;
    lease.running = true;
    lease.wantInvoke = false;
    lease.missed = false;
    const track: RunTrack = { current: null };
    tracks.set(lease, track);
    trackRun(track);
    detach(
      invoke(thread, lease).finally(() => {
        untrackRun(track);
      }),
      (cause) => {
        core.deps.report({
          level: "error",
          code: "handler_failed",
          message: "background task failed",
          cause,
        });
      },
    );
  }

  /**
   * 부여 대상이 지금 주도할 수 있는가: 열린 세대에 drive가 있고 오류가 없으며 이 thread가 켜 둔 scope다.
   * `txn`은 이 경계에서 열거나 켜질 scope를 보려고 넘긴다. 경계 밖(명령의 `handoff`, 사용자 명령의 전환)에서는 `null`이다
   */
  function drivableOf(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    txn: BoundaryTxn | null,
  ): {
    readonly record: RegistrationRecord;
    readonly generation: Generation;
    readonly drive: NonNullable<Generation["drive"]>;
  } | null {
    const record = core.scopes.get(scopeId);
    if (record === undefined || record.driveError) return null;
    const generation = record.generation;
    if (generation === null || generation.stale) return null;
    if (!generation.open && txn?.opening.includes(record) !== true) return null;
    const drive = generation.drive;
    if (drive === null) return null;
    const activeHere = thread.active.has(record.id) || txn?.activating.includes(record) === true;
    if (!activeHere) return null;
    return { record, generation, drive };
  }

  /** 시작 요청 하나를 큐에서 뺀다. 대상이 맞지 않아 버릴 때와 스택이 차서 버릴 때 쓴다(진단 scope_notice) */
  function dropRequest(thread: ThreadRuntime, request: StartRequest, why: string): void {
    const at = thread.startQueue.indexOf(request);
    if (at >= 0) thread.startQueue.splice(at, 1);
    returnHeldIfUnclaimed(thread);
    core.deps.report({
      level: "info",
      code: "scope_notice",
      scopeId: request.scopeId,
      message: `drive start of ${request.scopeId} was dropped: ${why}`,
    });
  }

  /**
   * 시작 요청 하나로 프레임을 부여한다: `lease.acquired` 초안과 `txn.grant`를 만든다. `parent`가 있으면 맡기기다. 실효 한도는
   * 설정으로 정하고, 맡기기면 맡긴 쪽의 남은 양으로 한 번 더 줄인다(drive-isolation.md 2.3). 큐에서 지우는 일은 커밋 뒤다
   */
  function grantOf(
    thread: ThreadRuntime,
    txn: BoundaryTxn,
    request: StartRequest,
    target: {
      readonly record: RegistrationRecord;
      readonly drive: NonNullable<Generation["drive"]>;
    },
    parent: LeaseRuntime | null,
  ): void {
    const { record, drive } = target;
    const requested = effectiveLimits(
      core.deps.settings.driveDefaultLimits(thread.threadId),
      core.deps.settings.driveLimits(thread.threadId),
      drive.options.limits(),
    );
    if (requested.clamped.length > 0) {
      core.deps.report({
        level: "info",
        code: "drive_limits_clamped",
        scopeId: record.id,
        extension: record.extension,
        message: `drive limits ${requested.clamped.join(", ")} were clamped to the ceiling x.primitives.driveLimits`,
      });
    }
    const limits = parent === null ? requested.limits : inheritedLimits(requested.limits, parent);
    const leaseEpoch = (thread.leaseEpochs.get(record.id) ?? 0) + 1;
    // 스택 인덱스다. 맡기기는 맨 위 바로 위에 올리므로 맡긴 프레임의 깊이 + 1과 같다
    const depth = thread.frames.length;
    const draft = makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: "lease.acquired",
      payload: { leaseId: "", scopeId: record.id, lineageId: "", limits, leaseEpoch },
      turnId: txn.signal.turnId,
      stepId: txn.signal.stepId,
    });
    // 임대 id는 부여 초안의 이벤트 id를 그대로 쓴다(불투명 문자열, 40자 이하). 계통은 새로 연다(lineageId = leaseId)
    const leaseId = draft.id;
    // 검토본 단위의 판 식별자. 재시작 복원이 검토본과 맞춘다(M5c §4.3.5). 내장과 원본 탐색 단위는 값이 없어 싣지 않는다
    const contentHash = core.units.get(record.extension)?.contentHash ?? null;
    // 선택 필드는 값이 있을 때만 싣는다(exactOptionalPropertyTypes)
    txn.drafts.push({
      ...draft,
      payload: {
        leaseId,
        scopeId: record.id,
        lineageId: leaseId,
        limits,
        leaseEpoch,
        depth,
        ...(parent === null ? {} : { parent: parent.leaseId }),
        ...(contentHash === null ? {} : { contentHash }),
      },
    });
    txn.grant = frameOf({
      leaseId,
      lineageId: leaseId,
      scopeId: record.id,
      threadId: thread.threadId,
      leaseEpoch,
      limits,
      used: { turns: 0, spawns: 0, tokens: 0 },
      parent: parent?.leaseId ?? null,
      depth,
      contentHash,
      calledBy: parent === null ? null : (core.scopes.get(parent.scopeId)?.extension ?? null),
      input: request.input,
      state: "driving",
      wantInvoke: true,
      committed: false,
      restoring: false,
    });
    txn.startRequest = request;
  }

  /**
   * 맡기기 요청의 부여 판단(drive-isolation.md 2.1). 맡긴 프레임이 맨 위이고 `waiting`일 때만 맡은 프레임을 올린다. 대상을 쓸 수
   * 없으면 요청을 버리고 맡긴 프레임을 `aborted`로 이어 준다. 그 이어 줌은 커밋 뒤에 한다(`abandoning`)
   */
  function decideHandoff(thread: ThreadRuntime, txn: BoundaryTxn, request: StartRequest): void {
    const parent = topFrame(thread);
    // 맡긴 프레임이 내려가면 그 프레임이 낸 요청도 같은 경계에서 지운다(collectReleases). 남은 맡기기 요청은 맨 위가 낸 것이다
    if (parent === null || parent.leaseId !== request.parentLeaseId) {
      throw new Bug("lease.handoff_parent_missing");
    }
    if (parent.state !== "waiting") throw new Bug("lease.handoff_parent_not_waiting");
    const target = drivableOf(thread, request.scopeId, txn);
    if (target === null) {
      txn.abandoning = request;
      return;
    }
    grantOf(thread, txn, request, target, parent);
  }

  /**
   * 시작 요청 큐 맨 앞으로 부여를 판단한다. 맡기기는 맨 위의 대기가 풀릴 때 부여하고, 사용자와 프로필 시작은 스택이 비어 있을 때 부여한다.
   * 대상이 맞지 않으면 요청을 버린다. 사용자 명령이 스택을 바꾸는 일은 `startDrive`와 단계 경계(`runSteps`)가 맡는다
   */
  function decide(thread: ThreadRuntime, txn: BoundaryTxn): void {
    if (thread.child) return;
    if (txn.grant !== null || txn.releasing.length > 0) return;
    const request = thread.startQueue[0];
    if (request === undefined) return;
    if (request.trigger === "handoff") {
      decideHandoff(thread, txn, request);
      return;
    }
    if (topFrame(thread) !== null) {
      // 스택이 차 있으면 프로필 시작은 버린다. 사용자 명령은 큐에 둔 채 전환(switch-policy)을 기다린다
      if (request.trigger === "profile") dropRequest(thread, request, "the drive stack is busy");
      return;
    }
    // 사용자가 멈춘 뒤에는 사용자 명령만 주도를 시작한다
    if (thread.userStopped && request.trigger !== "user") return;
    const loop = core.ports.get(LoopPortKey);
    const records = core.ports.get(RecordCommitPortKey);
    if (loop === undefined || records === undefined) {
      warnPortOnce(thread, loop === undefined ? "fresnel.loop" : "fresnel.session");
      return;
    }
    const target = drivableOf(thread, request.scopeId, txn);
    if (target === null) {
      dropRequest(thread, request, "the scope cannot lead this conversation now");
      return;
    }
    grantOf(thread, txn, request, target, null);
  }

  /**
   * 사용자 명령 가운데 전환을 기다리는 첫 요청. 맨 위와 같은 scope이거나 지금 주도할 수 없으면 버리고 `null`이다(스택은 그대로)
   */
  function userTakeover(thread: ThreadRuntime): StartRequest | null {
    const request = thread.startQueue.find((item) => item.trigger === "user");
    if (request === undefined) return null;
    const top = topFrame(thread);
    if (top !== null && top.scopeId === request.scopeId) {
      dropRequest(thread, request, "the scope already leads this conversation");
      return null;
    }
    if (drivableOf(thread, request.scopeId, null) === null) {
      dropRequest(thread, request, "the scope cannot lead this conversation now");
      return null;
    }
    return request;
  }

  /**
   * 사용자 명령이 주도를 가져간다: 스택 전체를 `revoked`로 내리고 한 줄로 알린다(묻지 않는다, drive-isolation.md 2.2). 내려간 쪽의
   * 상태는 이미 커밋돼 있다. 반납은 다음 경계에서 커밋하고, 그 뒤 사용자 명령이 부여된다
   */
  function switchForUser(thread: ThreadRuntime, request: StartRequest): void {
    const top = topFrame(thread);
    if (top === null) return;
    const from = core.scopes.get(top.scopeId)?.extension ?? top.scopeId;
    const to = core.scopes.get(request.scopeId)?.extension ?? request.scopeId;
    releaseFrom(thread, 0, "revoked");
    core.deps.report({
      level: "info",
      code: "scope_notice",
      scopeId: top.scopeId,
      message: `${from} 주도를 ${to}으로 바꿨다(사용자 명령)`,
    });
    hooks.requestApply(thread.threadId);
  }

  return {
    restore(thread, open) {
      // 위에서 아래로 더해 각 프레임이 쓴 양(위 프레임의 own 포함)을 다시 센다. 저장된 `used`는 각 프레임의 own이다
      const running = { turns: 0, spawns: 0, tokens: 0 };
      const rebuilt: LeaseRuntime[] = [];
      for (const item of open.toReversed()) {
        running.turns += item.used.turns;
        running.spawns += item.used.spawns;
        running.tokens += item.used.tokens;
        rebuilt.push(
          frameOf({
            leaseId: item.leaseId,
            lineageId: item.lineageId,
            scopeId: item.scopeId,
            threadId: thread.threadId,
            leaseEpoch: item.leaseEpoch,
            limits: item.limits,
            used: { ...running },
            parent: item.parent,
            depth: item.depth,
            contentHash: item.contentHash,
            // 맡긴 쪽 이름은 기록의 `parent`로 찾는다. 맡길 때 넘긴 입력은 기록에 없어 null이다
            calledBy: callerNameOf(open, item.parent),
            input: null,
            state: "waiting",
            wantInvoke: false,
            committed: true,
            restoring: true,
          }),
        );
        thread.leaseEpochs.set(
          item.scopeId,
          Math.max(item.leaseEpoch, thread.leaseEpochs.get(item.scopeId) ?? 0),
        );
      }
      rebuilt.reverse();
      // 맨 위만 다시 묻는다. 아래 프레임은 맡긴 기록으로 기다린다
      const top = rebuilt.at(-1);
      if (top !== undefined) {
        top.state = "driving";
        top.wantInvoke = true;
      }
      thread.frames.push(...rebuilt);
      // 죽은 scope(레코드 없음, 켜지지 않은 채 원하지 않음, 세대 닫힘, stale)의 프레임은 그 프레임과 위 프레임 전부를 restart로 반납한다.
      // 원하는데 세대가 아직 없는 scope는 이 열기의 첫 적용이 켠다. 켜지지 않으면 `collectReleases`가 확인해 반납한다
      const deadAt = rebuilt.findIndex((frame) => {
        const record = core.scopes.get(frame.scopeId);
        // 원하는 켜짐은 `wantedBy`와 같다: 이 대화의 요청이 있으면 그것이고, 없으면 등록의 켜기 요청이다
        if (record === undefined) return true;
        if (!(thread.want.get(frame.scopeId)?.enabled ?? record.desired)) return true;
        const generation = record.generation;
        if (generation === null) return false;
        return !generation.open || generation.stale;
      });
      if (deadAt >= 0) releaseFrom(thread, deadAt, "restart");
    },
    releaseForRegistration(scopeId, reason) {
      for (const thread of core.threads.values()) releaseScope(thread, scopeId, reason);
    },
    releaseForRegistrationIn(thread, scopeId, reason) {
      releaseScope(thread, scopeId, reason);
    },
    collectReleases(thread, txn) {
      // 재시작 뒤 복원된 프레임은 이 경계가 scope를 적용한 뒤에 확인한다(`turn_settled`는 적용하지 않는다)
      if (txn.signal.kind !== "turn_settled") verifyRestored(thread, txn);
      if (txn.signal.kind === "turn_settled") {
        // 사용자 중단이면 스택 전체를 내리고 시작 요청을 비운다. 사용자의 다음 명령이 정착할 때까지 프로필·맡기기 시작을 막는다
        thread.userStopped = txn.signal.userInterrupted === true;
        if (thread.userStopped) {
          thread.startQueue.splice(0);
          returnHeldIfUnclaimed(thread);
          releaseFrom(thread, 0, "revoked");
        }
      }
      // 반납이 정해진 프레임을 맨 위부터 모은다. 커밋되지 않은 프레임은 없다(부여는 커밋 뒤에 스택에 들어간다)
      for (const frame of thread.frames.toReversed()) {
        if (frame.status !== "releasing" || !frame.committed) continue;
        if (frame.reason === undefined) throw new Bug("lease.releasing_without_reason");
        txn.drafts.push(
          makeDraft(core.deps.ids, {
            threadId: thread.threadId,
            kind: "lease.released",
            payload: { leaseId: frame.leaseId, scopeId: frame.scopeId, reason: frame.reason },
            turnId: txn.signal.turnId,
            stepId: txn.signal.stepId,
          }),
        );
        txn.releasing.push(frame);
      }
      // 내려가는 프레임이 낸 맡기기 요청은 그 프레임과 함께 버린다. 맡긴 쪽이 없는 요청은 부여되지 않는다
      const gone = new Set(txn.releasing.map((frame) => frame.leaseId));
      if (gone.size > 0) {
        const kept = thread.startQueue.filter(
          (request) => request.parentLeaseId === null || !gone.has(request.parentLeaseId),
        );
        thread.startQueue.splice(0, thread.startQueue.length, ...kept);
      }
    },
    grant(thread, txn) {
      decide(thread, txn);
    },
    applyCommitted(thread, txn) {
      if (txn.releasing.length > 0) {
        const released = new Set(txn.releasing);
        const before = thread.frames;
        // 반납된 프레임 가운데 가장 아래 것이 새 맨 위 바로 위였다. 그 결과가 맡긴 쪽의 복귀 값이다
        const lowest = before.findIndex((frame) => released.has(frame));
        const finished = lowest >= 0 ? before[lowest] : undefined;
        thread.frames = before.filter((frame) => !released.has(frame));
        for (const frame of txn.releasing) {
          frame.status = "released";
          // 내려간 프레임에 남은 사용자 메시지는 코어 루프로 돌려보낸다(묻히지 않게). 실행 중인 호출은 끝날 때 돌려보낸다
          if (!frame.running) flushUserMessages(thread, frame);
          core.notify({ kind: "lease", scopeId: frame.scopeId, threadId: thread.threadId });
        }
        const top = topFrame(thread);
        if (top !== null && top.state === "waiting" && finished !== undefined) {
          // 맡긴 프레임: `done`이면 결과를, 그 밖의 사유(error, disabled, budget, idle, restart, revoked)면 끊김을 준다
          resumeWaiting(
            top,
            finished.reason === "done"
              ? { kind: "handoff", status: "done", result: finished.result }
              : { kind: "handoff", status: "aborted", result: null },
          );
        }
        // 새 임대 판단이 시작된다. 같은 경계에서 못 한 다음 요청의 부여를 이어서 판단한다
        hooks.requestApply(thread.threadId);
      }
      if (txn.abandoning !== null) {
        // 대상을 쓸 수 없는 맡기기: 요청을 버리고 맡긴 프레임을 끊김으로 이어 준다(drive-isolation.md 2.1)
        const request = txn.abandoning;
        dropRequest(thread, request, "the scope cannot lead this conversation now");
        const parent = topFrame(thread);
        if (
          parent !== null &&
          parent.leaseId === request.parentLeaseId &&
          parent.state === "waiting"
        ) {
          resumeWaiting(parent, { kind: "handoff", status: "aborted", result: null });
        }
        hooks.requestApply(thread.threadId);
      }
      const grant = txn.grant;
      if (grant !== null) {
        grant.committed = true;
        thread.frames.push(grant);
        thread.leaseEpochs.set(grant.scopeId, grant.leaseEpoch);
        // 부여를 기다리며 쥐고 있던 사용자 메시지는 새 프레임의 몫이다
        grant.inbox.push(...thread.heldUser.splice(0).map((held) => held.item));
        // 커밋이 성공해야 요청을 뺀다. 실패하면 다음 경계가 같은 요청을 다시 판단한다
        if (txn.startRequest !== null) {
          const at = thread.startQueue.indexOf(txn.startRequest);
          if (at >= 0) thread.startQueue.splice(at, 1);
        }
        core.notify({ kind: "lease", scopeId: grant.scopeId, threadId: thread.threadId });
      }
    },
    claimUserInput(thread, item) {
      if (thread.child) return false;
      const lease = topFrame(thread);
      if (lease === null) {
        // 시작 요청이 이미 큐에 있으면 프레임이 잡힐 때까지 메시지를 쥐고 있다가 그 프레임의 첫 단계 뒤에 전달한다(2.4).
        // 부여가 먼저인지 메시지가 먼저인지에 따라 행선지가 갈리지 않는다. 요청이 프레임 없이 사라지면 코어 루프로 돌려보낸다
        const request = thread.startQueue.find((entry) => entry.trigger !== "handoff");
        if (request === undefined || thread.userStopped) return false;
        thread.heldUser.push({
          item,
          scopeId: request.scopeId,
          requestId: core.deps.ids.next("evt"),
        });
        return true;
      }
      // 맡기고 기다리는 맨 위는 메시지를 받지 않는다. 루프가 평소대로 처리한다
      if (lease.status !== "active" || lease.state !== "driving" || !lease.committed) {
        return false;
      }
      const record = core.scopes.get(lease.scopeId);
      if (record === undefined || record.generation?.open !== true) return false;
      lease.inbox.push(item);
      if (!lease.running && loopStatusIdle(thread.threadId)) start(thread, lease);
      return true;
    },
    startDrive(threadId, scopeId, trigger, input) {
      const thread = core.threads.get(threadId);
      if (thread === undefined) return err({ kind: "unknown_thread" });
      const record = core.scopes.get(scopeId);
      if (record === undefined) return err({ kind: "unknown_scope" });
      if (thread.child) return err({ kind: "child_thread" });
      if (record.driveError) return err({ kind: "drive_error" });
      // 세대가 열려 있으면 drive 등록을 확인한다. 꺼진 scope는 세대가 없어 확인하지 못하고, 부여 경계가 버린다
      if (record.generation !== null && record.generation.drive === null) {
        return err({ kind: "not_drive" });
      }
      // 사용자가 다시 명령하면 멈춤을 푼다
      if (trigger === "user") thread.userStopped = false;
      // 같은 scope와 같은 계기, 같은 입력의 요청이 이미 큐에 있으면 하나로 본다. 입력이 연달아 와도 시작은 한 번만 부여된다
      // (테스트 대화의 상주 시작 Drive가 입력마다 요청한다, M5c §4.8.6)
      const queued = thread.startQueue.some(
        (item) =>
          item.scopeId === scopeId &&
          item.trigger === trigger &&
          item.parentLeaseId === null &&
          item.input === input,
      );
      if (!queued) thread.startQueue.push({ scopeId, trigger, input, parentLeaseId: null });
      // 주도 중에 온 사용자 명령: 질문 대기나 실행 밖이면 지금 스택을 바꾸고, 실행 중이면 단계 경계에서 바꾼다(switch-policy.ts)
      const top = topFrame(thread);
      if (trigger === "user" && top !== null && top.status === "active") {
        const takeover = userTakeover(thread);
        const situation = { running: top.running, asking: top.asking, stepEnded: false };
        if (takeover !== null && shouldSwitchNow(situation)) switchForUser(thread, takeover);
      }
      hooks.requestApply(threadId);
      return ok(undefined);
    },
    chargeTokens(thread, tokens) {
      const top = thread.frames.at(-1);
      if (top === undefined || tokens <= 0) return;
      charge(thread, top, { turns: 0, spawns: 0, tokens });
    },
    framesOf(thread) {
      // 맨 아래는 코어 루프(깊이 0)다. 플러그인 프레임의 깊이는 스택 인덱스에 1을 더한 값이다
      const coreFrame: DriveFrameView = {
        depth: 0,
        plugin: null,
        versionId: null,
        leaseId: null,
        state: "driving",
        used: { turns: 0, spawns: 0, tokens: 0 },
        limits: {},
      };
      const plugins = thread.frames.map((frame): DriveFrameView => ({
        depth: frame.depth + 1,
        plugin: core.scopes.get(frame.scopeId)?.extension ?? null,
        versionId: frame.contentHash,
        leaseId: frame.leaseId,
        state: frame.asking ? "asking" : frame.state,
        used: { turns: frame.used.turns, spawns: frame.used.spawns, tokens: frame.used.tokens },
        limits: {
          ...(frame.limits.maxTurns === undefined ? {} : { turns: frame.limits.maxTurns }),
          ...(frame.limits.maxSpawns === undefined ? {} : { spawns: frame.limits.maxSpawns }),
          ...(frame.limits.maxTokens === undefined ? {} : { tokens: frame.limits.maxTokens }),
        },
      }));
      return [coreFrame, ...plugins];
    },
    onDirectCommit(thread, scopeId) {
      // 명령이 돌아온 뒤에 실행하려고 lifecycle 디스패치처럼 한 번 넘긴다
      core.track(
        (async () => {
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          const lease = topFrame(thread);
          if (lease === null) return;
          if (lease.scopeId !== scopeId || lease.status !== "active" || !lease.committed) return;
          const record = core.scopes.get(scopeId);
          if (record === undefined || record.generation?.open !== true) return;
          if (lease.running) {
            lease.missed = true;
            return;
          }
          const changed = stateService.revOf(thread.threadId, scopeId) !== lease.lastBaseRev;
          // thread가 실행 중이면 turn_settled 경계가 부른다
          if ((changed || lease.wantInvoke) && loopStatusIdle(thread.threadId))
            start(thread, lease);
        })(),
      );
    },
    onBoundary(thread, signal) {
      const lease = topFrame(thread);
      if (lease === null || lease.status !== "active" || !lease.committed) return;
      const record = core.scopes.get(lease.scopeId);
      if (record === undefined || record.generation?.open !== true) return;
      if (signal.kind === "step_end") return;
      if (lease.running) {
        lease.missed = true;
        return;
      }
      const changed = stateService.revOf(thread.threadId, lease.scopeId) !== lease.lastBaseRev;
      const due = lease.wantInvoke || signal.kind === "turn_settled" || changed;
      if (due && loopStatusIdle(thread.threadId)) start(thread, lease);
    },
  };
}

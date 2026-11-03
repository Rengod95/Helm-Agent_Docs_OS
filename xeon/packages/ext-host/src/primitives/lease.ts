import { createHash } from "node:crypto";
import { Bug, detach, parse } from "@fresnel/contracts";
import {
  AskRequestSchema,
  DriveLockArbiterPortKey,
  LoopPortKey,
  RecordCommitPortKey,
  type AskCard,
  type AskOutcome,
  type AskRequest,
  type DriveLimits,
  pluginDefaultEnabled,
  type DriveLockBudget,
  type LoopHandle,
  type OpenLease,
  type RegistrationId,
  type SpawnOutcome,
  type SpawnSpec,
  type TurnInput,
  type TurnOutcome,
} from "@fresnel/contracts/extensions";
import type { Usage } from "@fresnel/contracts/conversation";
import { DenyAnswerSchema, QuestionAnswerSchema, requestKeyFor } from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  type ApprovalResolution,
  type ApprovalService,
  type QuestionBody,
  type QuestionItem,
  type QuestionOption,
} from "@fresnel/contracts/services";
import { withAmbient, withoutAmbient, type DriveInvocation } from "./ambient.ts";
import type {
  BoundarySignal,
  BoundaryTxn,
  HostCore,
  LeaseRuntime,
  ReleaseReason,
  RegistrationRecord,
  ThreadRuntime,
} from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { DEFAULT_LEASE_WAIT_LIMIT } from "./settings.ts";
import type { StateService } from "./state.ts";

/** 경계 없이 상태 커밋만 하고 반환한 drive를 바로 다시 부르는 연속 횟수 상한(X.primitives.spec §4.4.3) [제안] */
export const MAX_CHAINED_REINVOKES = 8;

export interface LeaseBroker {
  /** openThread: 저장된 열린 임대를 되살린다. 설치되지 않았거나 꺼진 scope의 임대는 restart로 반납 예정이 된다 */
  restore(thread: ThreadRuntime, open: OpenLease | null): void;
  /** scope가 꺼지면 모든 thread에서 그 scope의 임대를 반납 예정(disabled)으로 바꾼다 */
  releaseForRegistration(scopeId: RegistrationId, reason: ReleaseReason): void;
  /** 한 thread에서만 scope가 꺼질 때 그 thread의 임대를 반납 예정으로 바꾼다(P-28) */
  releaseForRegistrationIn(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    reason: ReleaseReason,
  ): void;
  /** prepare: 반납 예정 임대의 lease.released 초안 */
  collectReleases(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** prepare: 후보 계산과 lease.acquired 초안 */
  grant(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle(failed): 이 경계가 올린 대기 계수를 되돌린다 */
  revertWait(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle(committed): 커밋된 반납·부여를 반영한다 */
  applyCommitted(thread: ThreadRuntime, txn: BoundaryTxn): void;
  /** settle 뒤: 경계 종류에 맞게 drive 함수를 부른다 */
  onBoundary(thread: ThreadRuntime, signal: BoundarySignal): void;
  /** 명령·도구 호출이 상태 판을 올렸다: 임대가 있고 thread가 유휴면 drive를 한 번 예약한다(X.primitives.spec §4.4.3) */
  onDirectCommit(thread: ThreadRuntime, scopeId: RegistrationId): void;
  /** 임대를 반납 예정으로 바꾼다. 활성이 아니면 아무 일도 하지 않는다 */
  release(lease: LeaseRuntime, reason: ReleaseReason): void;
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

function assertBudget(lease: LeaseRuntime, kind: "turns" | "spawns"): void {
  const limit = kind === "turns" ? lease.limits.maxTurns : lease.limits.maxSpawns;
  const left = remaining(limit, lease.used[kind]);
  // 토큰 상한도 turn·spawn 호출 직전에 검사한다(spec §4.4.2 5번). 소진이면 lease_budget으로 거부한다
  const tokensLeft = remaining(lease.limits.maxTokens, lease.used.tokens);
  if ((left !== null && left <= 0) || (tokensLeft !== null && tokensLeft <= 0)) {
    release(lease, "budget");
    throw leaseError(lease);
  }
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

export interface LeaseBrokerHooks {
  /** 함수 쪽 사유로 반납이 정해진 뒤(error, idle) 다음 경계를 기다리지 않고 유휴 적용을 예약한다 */
  requestApply(threadId: ThreadRuntime["threadId"]): void;
}

export function createLeaseBroker(
  core: HostCore,
  stateService: StateService,
  hooks: LeaseBrokerHooks,
): LeaseBroker {
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

  /**
   * `loop.ask`로 답을 기다리는 Registration과 그 승인 id(thread별). 답이 해결되면 지운다. thread 객체를 키로 두어
   * 같은 thread id로 다시 연 thread의 항목과 섞이지 않는다(X-17)
   */
  const askWaiting = new WeakMap<ThreadRuntime, Map<RegistrationId, string>>();

  function markAskWaiting(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    approvalId: string,
  ): void {
    const waiting = askWaiting.get(thread) ?? new Map<RegistrationId, string>();
    waiting.set(scopeId, approvalId);
    askWaiting.set(thread, waiting);
  }

  function unmarkAskWaiting(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    approvalId: string,
  ): void {
    const waiting = askWaiting.get(thread);
    if (waiting?.get(scopeId) === approvalId) waiting.delete(scopeId);
  }

  /**
   * 답을 기다린다. 답은 사람이 언제 줄지 모르므로 정산이 기다리는 추적 작업(`core.track`)으로 두지 않는다.
   * 답이 해결되면 Registration을 다시 후보로 올린다. thread가 닫혀 기다림이 끊기거나 승인을 모르면 항목만 지운다.
   * 승인 요청은 닫지 않는다(답은 사용자의 것이다)
   */
  function awaitAnswer(
    thread: ThreadRuntime,
    scopeId: RegistrationId,
    approvals: ApprovalService,
    approvalId: string,
  ): void {
    detach(
      (async () => {
        const waited = await approvals.wait(approvalId, thread.abort.signal);
        unmarkAskWaiting(thread, scopeId, approvalId);
        if (waited.ok && core.threads.get(thread.threadId) === thread) {
          hooks.requestApply(thread.threadId);
        }
      })(),
      (cause) => {
        core.deps.report({
          level: "error",
          code: "handler_failed",
          scopeId,
          message: "loop.ask could not wait for the answer",
          cause,
        });
      },
    );
  }

  function makeLoopHandle(
    thread: ThreadRuntime,
    lease: LeaseRuntime,
    invocation: DriveInvocation,
  ): LoopHandle {
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
      // X-17 loop.ask(X.primitives.spec §4.4.4). 첫 호출은 question 승인을 열고 drive lock을 `waiting`으로 반납한다.
      // 약속은 이행되지 않고 lease_revoked로 거부된다(drive 함수가 그 거부를 받아 unwind한다). 답이 이미 있으면 기록된 결과를 바로 돌려준다.
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
        // 활성 drive 락의 scope는 정의가 있어야 한다. 정의를 지우기 전에 teardown이 drive 락을 반납한다
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
        // 이미 답이 있으면(drive 락 재부여 뒤, 재시작 뒤의 재호출) drive 락을 건드리지 않고 기록된 결과를 돌려준다
        if (resolution !== null) return askOutcomeOf(resolution, lease.scopeId);
        // 답이 아직 없다. drive 락을 `waiting`으로 반납하고, 답이 올 때까지 이 Registration은 후보가 아니다
        markAskWaiting(thread, lease.scopeId, approval.approvalId);
        release(lease, "waiting");
        // 닫히는 중인 thread에는 적용을 예약하지 않는다(requestApply는 열린 thread만 찾는다)
        if (core.threads.get(thread.threadId) === thread) hooks.requestApply(thread.threadId);
        awaitAnswer(thread, lease.scopeId, approvals, approval.approvalId);
        throw leaseError(lease);
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
          lease.used.turns += 1;
          lease.used.tokens += tokensOf(result.usage);
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
          lease.used.spawns += 1;
          lease.used.tokens += tokensOf(result.usage);
          invocation.effects += 1;
        }
        return result.outcome;
      },
      get budget(): DriveLockBudget {
        return budgetOf(lease);
      },
      get signal(): AbortSignal {
        return lease.abort.signal;
      },
    };
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
      // 공급자 재시작으로 세대를 다시 만드는 중이다. 임대는 두고 다음 경계에서 새 drive 함수로 이어 간다
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
    const baseRev = stateService.revOf(thread.threadId, lease.scopeId);
    const invocation: DriveInvocation = {
      leaseId: lease.leaseId,
      lineageId: lease.lineageId,
      baseRev,
      signal: lease.abort.signal,
      i: 0,
      effects: 0,
    };
    lease.lastBaseRev = baseRev;
    const handle = makeLoopHandle(thread, lease, invocation);
    try {
      await withAmbient(
        {
          threadId: thread.threadId,
          scopeId: lease.scopeId,
          point: null,
          dispatchKey: null,
          counter: 0,
          drive: invocation,
          handler: null,
        },
        () => drive.fn(handle, stateService.docOf(thread.threadId, lease.scopeId)),
      );
    } catch (error) {
      lease.running = false;
      if (lease.status !== "active") {
        // 상한 소진·회수로 이미 반납이 정해졌다. 함수가 그 거부를 그대로 던진 것은 오류가 아니다
        if (lease.status === "releasing") hooks.requestApply(thread.threadId);
        return;
      }
      record.driveError = true;
      record.lastError = {
        code: error instanceof PrimitiveError ? error.code : "registration_setup_failed",
        message: error instanceof Error ? error.message : "drive function threw",
      };
      core.deps.report({
        level: "error",
        code: error instanceof PrimitiveError ? error.code : "handler_failed",
        scopeId: lease.scopeId,
        extension: record.extension,
        message: "drive function threw; lease released with error",
        cause: error,
      });
      release(lease, "error");
      hooks.requestApply(thread.threadId);
      return;
    }
    lease.running = false;
    if (lease.status !== "active") {
      if (lease.status === "releasing") hooks.requestApply(thread.threadId);
      return;
    }
    // 같은 상태 판으로 효과 없이 두 번 연속 반환하면 idle 반납(X.primitives.spec §4.4.3)
    if (invocation.effects > 0) {
      lease.idleStreak = 0;
    } else if (lease.idleRev === baseRev) {
      lease.idleStreak += 1;
    } else {
      lease.idleRev = baseRev;
      lease.idleStreak = 1;
    }
    if (lease.idleStreak >= 2) {
      release(lease, "idle");
      hooks.requestApply(thread.threadId);
      return;
    }
    // 실행 중에 호출 조건이 지나갔고 thread가 유휴면 바로 다시 부른다
    if (lease.missed && loopStatusIdle(thread.threadId)) {
      start(thread, lease);
      return;
    }
    // 이 호출이 상태만 커밋하고 반환하면(turn·spawn 경계가 없다) 다음 경계가 오지 않는다. 새 상태 판으로 바로 다시 부른다.
    // 상태를 계속 바꾸는 drive가 무한히 돌지 않게 연속 횟수에 상한을 둔다(X.primitives.spec §4.4.3)
    if (
      stateService.revOf(thread.threadId, lease.scopeId) !== baseRev &&
      loopStatusIdle(thread.threadId)
    ) {
      if (lease.chained >= MAX_CHAINED_REINVOKES) {
        core.deps.report({
          level: "info",
          code: "scope_notice",
          scopeId: lease.scopeId,
          extension: record.extension,
          message: `drive of ${lease.scopeId} committed state ${String(MAX_CHAINED_REINVOKES)} times in a row without a boundary; it is called again at the next boundary`,
        });
        return;
      }
      lease.chained += 1;
      start(thread, lease);
    }
  }

  function start(thread: ThreadRuntime, lease: LeaseRuntime): void {
    lease.running = true;
    lease.wantInvoke = false;
    lease.missed = false;
    core.track(invoke(thread, lease));
  }

  function candidatesFor(thread: ThreadRuntime, txn: BoundaryTxn): RegistrationRecord[] {
    const out: RegistrationRecord[] = [];
    for (const record of core.scopes.values()) {
      if (record.driveError) continue;
      const activeHere = thread.active.has(record.id) || txn.activating.includes(record);
      if (!activeHere) continue;
      const generation = record.generation;
      if (generation === null || generation.stale) continue;
      if (!generation.open && !txn.opening.includes(record)) continue;
      if (generation.drive === null) continue;
      // loop.ask로 답을 기다리는 Registration은 답이 해결될 때까지 후보가 아니다. trackWaiting도 이 목록으로 대기를 세므로
      // 답을 기다리는 동안에는 x.primitives.leaseWaitLimit의 대기 계수에 들지 않는다(X-17)
      if (askWaiting.get(thread)?.has(record.id) === true) continue;
      const cooled = thread.cooldown.get(record.id);
      if (cooled !== undefined && cooled === stateService.revOf(thread.threadId, record.id)) {
        continue;
      }
      out.push(record);
    }
    return out;
  }

  /** 임대가 없을 때 후보를 골라 `lease.acquired` 초안과 `txn.grant`를 만든다 */
  function decide(thread: ThreadRuntime, txn: BoundaryTxn): void {
    if (thread.child) return;
    if (thread.lease !== null || txn.grant !== null || txn.releasing.length > 0) return;
    const loop = core.ports.get(LoopPortKey);
    const records = core.ports.get(RecordCommitPortKey);
    const candidates = candidatesFor(thread, txn);
    if (candidates.length === 0) return;
    if (loop === undefined || records === undefined) {
      warnPortOnce(thread, loop === undefined ? "fresnel.loop" : "fresnel.session");
      return;
    }
    let chosen: RegistrationRecord | undefined;
    const arbiter = core.ports.get(DriveLockArbiterPortKey);
    if (arbiter !== undefined) {
      const picked = arbiter.choose(
        thread.threadId,
        candidates.map((record) => ({
          scopeId: record.id,
          extension: record.extension,
          loadIndex: record.loadIndex,
          defaultEnabled:
            record.def.defaultEnabled ?? pluginDefaultEnabled(record.manifest, record.plugin),
          enabledAtSeq: thread.enabledAtSeq.get(record.id) ?? null,
        })),
      );
      chosen = candidates.find((record) => record.id === picked);
    } else if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const active = core.deps.settings.activeDriver(thread.threadId);
      chosen = candidates.find((record) => record.id === active);
      if (chosen === undefined) {
        core.deps.report({
          level: "warning",
          code: "drive_conflict",
          message: `drive groups ${candidates.map((record) => record.id).join(", ")} are enabled; set x.primitives.activeDriver`,
        });
      }
    }
    const generation = chosen?.generation;
    if (chosen === undefined || generation === null || generation === undefined) return;
    const drive = generation.drive;
    if (drive === null) return;
    const { limits, clamped } = effectiveLimits(
      core.deps.settings.driveDefaultLimits(thread.threadId),
      core.deps.settings.driveLimits(thread.threadId),
      drive.options.limits,
    );
    if (clamped.length > 0) {
      core.deps.report({
        level: "info",
        code: "drive_limits_clamped",
        scopeId: chosen.id,
        extension: chosen.extension,
        message: `drive limits ${clamped.join(", ")} were clamped to the ceiling x.primitives.driveLimits`,
      });
    }
    const leaseEpoch = (thread.leaseEpochs.get(chosen.id) ?? 0) + 1;
    const draft = makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: "lease.acquired",
      payload: { leaseId: "", scopeId: chosen.id, lineageId: "", limits, leaseEpoch },
      turnId: txn.signal.turnId,
      stepId: txn.signal.stepId,
    });
    // 임대 id는 부여 초안의 이벤트 id를 그대로 쓴다(불투명 문자열, 40자 이하)
    const leaseId = draft.id;
    // waiting 반납 바로 뒤 같은 Registration의 부여는 앞 계통을 이어받는다. 그 밖의 부여는 새 계통이다(REQ-X-04)
    const waited = thread.waitingLineage;
    const lineageId = waited !== null && waited.scopeId === chosen.id ? waited.lineageId : leaseId;
    txn.drafts.push({
      ...draft,
      payload: { leaseId, scopeId: chosen.id, lineageId, limits, leaseEpoch },
    });
    txn.grant = {
      leaseId,
      lineageId,
      scopeId: chosen.id,
      threadId: thread.threadId,
      leaseEpoch,
      limits,
      used: { turns: 0, spawns: 0, tokens: 0 },
      status: "active",
      reason: undefined,
      abort: new AbortController(),
      idleStreak: 0,
      idleRev: null,
      lastBaseRev: null,
      running: false,
      wantInvoke: true,
      missed: false,
      chained: 0,
      committed: false,
    };
  }

  /**
   * 임대를 받지 못한 후보의 대기를 센다(M3-REQ-28, D-M3-05 a). 대기는 `turn_settled`·`idle` 경계마다 하나씩 늘고,
   * `x.primitives.leaseWaitLimit`을 넘으면 `lease.rejected` 초안을 경계 기여에 넣는다. 거부된 scope는 다음 반납이 커밋될 때까지 다시 세지 않는다
   */
  function trackWaiting(thread: ThreadRuntime, txn: BoundaryTxn): void {
    if (
      core.ports.get(LoopPortKey) === undefined ||
      core.ports.get(RecordCommitPortKey) === undefined
    )
      return;
    const holder = txn.grant?.scopeId ?? thread.lease?.scopeId ?? null;
    const waiting = candidatesFor(thread, txn).filter(
      (record) => record.id !== holder && !thread.leaseRejected.has(record.id),
    );
    const names = new Set(waiting.map((record) => record.id));
    for (const id of thread.leaseWait.keys()) {
      if (!names.has(id)) thread.leaseWait.delete(id);
    }
    const limit = core.deps.settings.leaseWaitLimit?.(thread.threadId) ?? DEFAULT_LEASE_WAIT_LIMIT;
    for (const record of waiting) {
      let entry = thread.leaseWait.get(record.id);
      if (entry === undefined) {
        entry = { requestSeq: thread.nextRequestSeq, waited: 0 };
        thread.nextRequestSeq += 1;
        thread.leaseWait.set(record.id, entry);
      }
      if (txn.signal.kind === "step_end") continue;
      entry.waited += 1;
      txn.waited.push(record.id);
      if (entry.waited <= limit) continue;
      txn.drafts.push(
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "lease.rejected",
          payload: {
            groupId: record.extension,
            reason: "wait_limit",
            requestSeq: entry.requestSeq,
          },
          turnId: txn.signal.turnId,
          stepId: txn.signal.stepId,
        }),
      );
      txn.rejected.push({
        scopeId: record.id,
        requestSeq: entry.requestSeq,
        holder,
        holderEpoch:
          holder === null
            ? 0
            : ((txn.grant?.scopeId === holder ? txn.grant.leaseEpoch : thread.lease?.leaseEpoch) ??
              0),
      });
    }
  }

  return {
    restore(thread, open) {
      if (open === null) return;
      const record = core.scopes.get(open.scopeId);
      const lease: LeaseRuntime = {
        leaseId: open.leaseId,
        lineageId: open.lineageId,
        scopeId: open.scopeId,
        threadId: thread.threadId,
        leaseEpoch: open.leaseEpoch,
        limits: open.limits,
        used: { ...open.used },
        status: "active",
        reason: undefined,
        abort: new AbortController(),
        idleStreak: 0,
        idleRev: null,
        lastBaseRev: null,
        running: false,
        wantInvoke: true,
        missed: false,
        chained: 0,
        committed: true,
      };
      thread.lease = lease;
      thread.leaseEpochs.set(
        open.scopeId,
        Math.max(open.leaseEpoch, thread.leaseEpochs.get(open.scopeId) ?? 0),
      );
      const alive =
        record !== undefined &&
        thread.active.has(open.scopeId) &&
        record.generation?.open === true &&
        !record.generation.stale;
      if (!alive) release(lease, "restart");
    },
    releaseForRegistration(scopeId, reason) {
      for (const thread of core.threads.values()) {
        if (thread.lease?.scopeId === scopeId) release(thread.lease, reason);
      }
    },
    releaseForRegistrationIn(thread, scopeId, reason) {
      if (thread.lease?.scopeId === scopeId) release(thread.lease, reason);
    },
    release,
    collectReleases(thread, txn) {
      const lease = thread.lease;
      if (lease !== null && lease.status === "active" && lease.committed) {
        // 사용자가 다른 그룹을 구동 그룹으로 골랐고 그 그룹이 후보이면 현재 임대를 회수한다(P-22 revoked)
        const named = core.deps.settings.activeDriver(thread.threadId);
        if (named !== null && named !== lease.scopeId) {
          const target = candidatesFor(thread, txn).find((record) => record.id === named);
          if (target !== undefined) release(lease, "revoked");
        }
      }
      if (lease === null || lease.status !== "releasing" || !lease.committed) return;
      if (lease.reason === undefined) throw new Bug("lease.releasing_without_reason");
      txn.drafts.push(
        makeDraft(core.deps.ids, {
          threadId: thread.threadId,
          kind: "lease.released",
          payload: { leaseId: lease.leaseId, scopeId: lease.scopeId, reason: lease.reason },
          turnId: txn.signal.turnId,
          stepId: txn.signal.stepId,
        }),
      );
      txn.releasing.push(lease);
    },
    grant(thread, txn) {
      decide(thread, txn);
      trackWaiting(thread, txn);
    },
    revertWait(thread, txn) {
      for (const id of txn.waited) {
        const entry = thread.leaseWait.get(id);
        if (entry !== undefined && entry.waited > 0) entry.waited -= 1;
      }
    },
    applyCommitted(thread, txn) {
      for (const lease of txn.releasing) {
        lease.status = "released";
        thread.waitingLineage =
          lease.reason === "waiting"
            ? { scopeId: lease.scopeId, lineageId: lease.lineageId }
            : null;
        if (thread.lease === lease) thread.lease = null;
        // waiting은 쿨다운을 걸지 않는다. 답이 오면 같은 상태 판에서도 바로 다시 후보가 되어야 한다(X-17)
        if (lease.reason === "idle" || lease.reason === "budget") {
          thread.cooldown.set(lease.scopeId, stateService.revOf(thread.threadId, lease.scopeId));
        }
        core.notify({ kind: "lease", scopeId: lease.scopeId, threadId: thread.threadId });
      }
      const grant = txn.grant;
      if (grant !== null) {
        grant.committed = true;
        thread.waitingLineage = null;
        thread.lease = grant;
        thread.leaseEpochs.set(grant.scopeId, grant.leaseEpoch);
        core.notify({ kind: "lease", scopeId: grant.scopeId, threadId: thread.threadId });
      }
      for (const rejection of txn.rejected) {
        thread.leaseWait.delete(rejection.scopeId);
        thread.leaseRejected.add(rejection.scopeId);
        core.notify({ kind: "lease", scopeId: rejection.scopeId, threadId: thread.threadId });
      }
      if (txn.releasing.length > 0) {
        // 새 임대 판단이 시작된다. 거부된 요청도 다시 후보가 된다
        thread.leaseRejected.clear();
        thread.leaseWait.clear();
      }
      // 반납이 커밋되면 같은 경계에서 못 한 다음 후보의 부여를 이어서 판단한다
      if (txn.releasing.length > 0) hooks.requestApply(thread.threadId);
    },
    onDirectCommit(thread, scopeId) {
      // 명령이 돌아온 뒤에 실행하려고 lifecycle 디스패치처럼 한 번 넘긴다
      core.track(
        (async () => {
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          const lease = thread.lease;
          if (lease === null) {
            // 임대가 없으면 유휴 경계에서 후보 판단을 받는다
            if (core.threads.get(thread.threadId) === thread) hooks.requestApply(thread.threadId);
            return;
          }
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
      if (signal.kind === "turn_settled") thread.cooldown.clear();
      const lease = thread.lease;
      if (lease === null || lease.status !== "active" || !lease.committed) return;
      const record = core.scopes.get(lease.scopeId);
      if (record === undefined || record.generation?.open !== true) return;
      if (signal.kind === "step_end") return;
      lease.chained = 0;
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

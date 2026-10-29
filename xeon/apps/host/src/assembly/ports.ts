import {
  assertNever,
  attempt,
  attemptAsync,
  Bug,
  err,
  ok,
  parse,
  type Clock,
  type Scheduler,
  type LogFields,
  type LogValue,
  type Logger,
} from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type {
  LeaseHolder,
  LeaseToken,
  SessionService,
  StoreService,
} from "@xeon/contracts/records";
import type {
  ApprovalService,
  ContextService,
  LoopService,
  ModelService,
  OsService,
  TaskService,
  ToolService,
} from "@xeon/contracts/services";
import {
  StoreIdSchema,
  threadSummaryOf,
  wireError,
  type StoreId,
  type ThreadSummary,
  type TurnStartInput,
  type WireResult,
} from "@xeon/contracts/wire";
import { isAbsolute } from "node:path";
import type { ScheduleService } from "@xeon/cap-schedule";
import { itemPagesOf } from "@xeon/core-persistence";
import { PrimitiveError, type ExtHost } from "@xeon/ext-host";
import type {
  ActivityPort,
  ApprovalPort,
  EventFeedPort,
  EnginePorts,
  HostLogPort,
  HostMode,
  LockOutcome,
  OwnerKind,
  PendingSchedulesPort,
  ProposalPort,
  SessionLockPort,
  SettingsStorePort,
  SubmitOutcome,
  ThreadPort,
  TrustPort,
  TurnPort,
  SecretsPort,
  UserNotifyPort,
} from "../types.ts";
import { wireErrorOfCreate, wireErrorOfLease, wireErrorOfStore } from "../store-error.ts";
import { messageOf, sequentially } from "../util.ts";
import { createApprovalPort } from "./approvals.ts";
import { createCommandPort } from "./commands.ts";
import { createDialogWirePort } from "./dialog-wire.ts";
import { canonicalWorkspace, wireErrorOfWorkspace, workspaceFilterOf } from "./workspace.ts";
import type { CommandRegistryHolder } from "./l2-units.ts";
import { createWebPort, type WebStatusHolder } from "./web-providers.ts";
import type { SettingsEngine } from "./settings-engine.ts";
import { createSettingsStore } from "./settings-store.ts";
import { createThreadGate } from "./thread-gate.ts";
import { readThread } from "./thread-read.ts";
import type { ProjectExtensions } from "./project-extensions.ts";
import type { ProjectTrust, TrustInspection } from "./trust.ts";

// L4.host-service.spec §3.3.2. 아래 층 서비스(F 서비스 인터페이스)를 EnginePorts로 감싸는 어댑터. 어댑터가 이 폴더 한 곳에 모이므로
// L1 서비스 이름이 바뀌어도 고칠 곳이 하나다(L4.host-service.plan §2). 조립 루트 코드(DR-14 예외 2).

export interface PortsDeps {
  /** 엔진 수명 신호. 닫히면 진행 중인 알림 같은 기다리지 않는 호출을 중단한다 */
  readonly signal: AbortSignal;
  readonly mode: HostMode;
  readonly os: OsService;
  readonly clock: Clock;
  /** 관찰 폴링 같은 호스트 자신의 타이머. L0.os의 스케줄러다 */
  readonly scheduler: Scheduler;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly session: SessionService;
  readonly store: StoreService;
  readonly loop: LoopService;
  /** 수동 컴팩션(`thread.compact`)이 부른다 */
  readonly context: Pick<ContextService, "compact">;
  /** 수동 컴팩션이 현재 모델(역할 `main`)의 바인딩과 창 크기를 정할 때 쓴다 */
  readonly models: Pick<ModelService, "resolve" | "list">;
  readonly tasks: TaskService;
  readonly approvals: ApprovalService;
  /** 열 때 복구가 도구의 현재 재실행 정책을 본다(ToolService.meta) */
  readonly tools: Pick<ToolService, "meta">;
  readonly ext: ExtHost;
  readonly holder: LeaseHolder;
  readonly settings: SettingsEngine;
  readonly secrets: SecretsPort;
  /** 명령 등록부 자리. 브리지 확장이 명령 서비스 API를 채운다 */
  readonly commands: CommandRegistryHolder;
  /** 웹 런타임 자리. cap-web 확장이 채운다(`web.providers`) */
  readonly web: WebStatusHolder;
  /** 지식 제안 대기열 둘의 합친 조회·결정(`proposal.*`) */
  readonly proposals: ProposalPort;
  /** 사용자 설정 파일이 없을 때 새로 만들 디렉터리(L0.os의 `dirs.config`) */
  readonly configDir: string;
  readonly trust: ProjectTrust;
  /** 서비스 모드의 프로젝트 확장 적재(M3-REQ-38). 쓰기 소유를 얻은 thread의 작업 폴더와 신뢰 결정 뒤에 부른다 */
  readonly projectExtensions: ProjectExtensions;
  /** thread의 작업 디렉터리(없으면 undefined) */
  readonly workspaceOf: (threadId: ThreadId) => string | undefined;
  /** 예약 서비스(L4.host-service.spec §4.17). 대기 예약·루프 수를 활동 집계에 낸다 */
  readonly schedule: ScheduleService;
  /** 대기 예약 수의 시험 주입. 있으면 예약 서비스의 대기 수 대신 이 값을 쓴다 */
  readonly pendingSchedules?: PendingSchedulesPort;
}

export interface PortsHandle {
  readonly ports: EnginePorts;
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰. 쥐지 않았으면 undefined */
  tokenOf(threadId: ThreadId): LeaseToken | undefined;
  /** 이 엔진이 지금 쓰기 소유를 쥔 thread 전부(쥔 순서) */
  heldThreads(): readonly ThreadId[];
  /** 가장 최근에 쓰기 소유를 쥔 thread(그룹 서비스가 상태를 보여 줄 thread). 쥔 thread가 없으면 null */
  activeThread(): ThreadId | null;
  /** 쥔 세션 임대를 모두 반납한다(엔진을 닫기 전). 각 thread에 session.shutdown("quit")을 발화한다 */
  releaseAll(): Promise<void>;
}

function toLogValue(value: unknown): LogValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : `${value}`;
  if (value === undefined) return null;
  if (typeof value === "object") {
    const json = attempt(() => JSON.stringify(value));
    return json.ok ? json.value : "[unserializable]";
  }
  return `[${typeof value}]`;
}

export function toLogFields(fields: Readonly<Record<string, unknown>>): LogFields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toLogValue(value)]));
}

/** 판정과 선택지를 wire `TrustStatus`로 옮긴다 */
function trustStatusOf(inspection: TrustInspection): WireResult<"trust.get"> {
  const { result, options } = inspection;
  return {
    projectRoot: result.projectRoot,
    required: result.required,
    verdict: result.verdict,
    via: result.via,
    resources: [...result.resources],
    options: options.map((option) => ({
      choice: { kind: option.choice.kind, verdict: option.choice.verdict },
      label: option.label,
      savedPath: option.savedPath,
    })),
  };
}

function storeIdOf(raw: string): StoreId {
  const parsed = parse(StoreIdSchema, raw);
  // xeon-disable-next-line xeon/bug-for-expected -- 엔진 자신의 저장소가 만든 storeId라 형식 검증이 실패하면 코드 결함이다 (eng.typescript.guide TY-24)
  if (!parsed.ok) throw new Bug(`store.invalid_store_id: ${raw}`, { cause: parsed.error });
  return parsed.value;
}

interface HeldLease {
  readonly token: LeaseToken;
  readonly alive: Disposable;
}

/** provider에 등록된 모델 id들. `list`의 ref는 `provider/modelId`다(thinking 수준 접미 없음) */
function modelIdsOf(models: Pick<ModelService, "list">, provider: string): readonly string[] {
  const prefix = `${provider}/`;
  return models
    .list({ provider })
    .flatMap((info) => (info.ref.startsWith(prefix) ? [info.ref.slice(prefix.length)] : []));
}

export function createEnginePorts(deps: PortsDeps): PortsHandle {
  const { session, store, loop, tasks, ext, logger } = deps;
  const storeId = storeIdOf(store.storeId);
  const held = new Map<ThreadId, HeldLease>();
  // 수동 컴팩션과 turn을 여는 일이 같은 thread에서 겹치지 않게 한다(HS-77, §10 미결 31)
  const gate = createThreadGate();

  const log: HostLogPort = {
    error: (message, fields) => {
      logger.error(message, toLogFields(fields));
    },
    info: (message, fields) => {
      logger.info(message, toLogFields(fields));
    },
  };

  const threads: ThreadPort = {
    async create(input) {
      // 작업 폴더는 정규 경로로 저장한다(HS-76). 상대 경로와 없는 폴더는 thread를 만들기 전에 거절한다
      let workspace: string | undefined;
      if (input.workspace !== undefined) {
        const canonical = await canonicalWorkspace(input.workspace);
        if (!canonical.ok) throw wireErrorOfWorkspace(canonical.error);
        workspace = canonical.value;
      }
      const threadId = deps.ids.next("thr");
      const created = session.threads.create({
        threadId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(workspace === undefined ? {} : { workspace }),
      });
      if (!created.ok) throw wireErrorOfCreate(created.error, "threads.create failed");
      const head = session.feed.headSeq();
      if (!head.ok) throw wireErrorOfStore(head.error, "threads.create position");
      return { threadId: created.value.threadId, position: { storeId, seq: head.value } };
    },
    exists(threadId) {
      const found = session.query.thread(threadId);
      return found.ok ? ok(found.value !== undefined) : found;
    },
    async list(params) {
      // 필터는 저장된 값(정규 경로)과 같은 형태로 견준다(HS-76)
      let workspace: string | undefined;
      if (params.workspace !== undefined) {
        const filter = await workspaceFilterOf(params.workspace);
        if (!filter.ok) throw wireErrorOfWorkspace(filter.error);
        workspace = filter.value;
      }
      const page = session.threads.list({
        ...(workspace === undefined ? {} : { workspace }),
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
      const summaries: ThreadSummary[] = [];
      for (const row of page.threads) {
        const summary = threadSummaryOf(row);
        if (!summary.ok) {
          throw wireError("internal", {
            message: `thread.list: ${summary.error.field} of ${row.threadId} is not a valid time`,
          });
        }
        summaries.push(summary.value);
      }
      return { threads: summaries, nextCursor: page.nextCursor };
    },
    async fork(threadId, at) {
      const forked = await session.threads.fork(threadId, at, deps.ids.next("thr"));
      if (!forked.ok) return forked;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ threadId: forked.value.threadId, position: { storeId, seq: head.value } });
    },
    async revert(threadId, to) {
      // 되감기마다 새 키다: 같은 키로 다시 부르면 처음 결과를 돌려주므로 호출 한 번이 한 번의 되감기다
      const reverted = await session.threads.revert(threadId, to, deps.ids.next("evt"));
      if (!reverted.ok) return reverted;
      return ok({ position: { storeId, seq: reverted.value.headSeq } });
    },
    rename(threadId, title) {
      // 제목마다 새 키다: 같은 키로 다른 제목을 쓰면 key_reused라 호출 한 번이 제목 한 번이다
      const renamed = session.threads.setTitle(threadId, title, deps.ids.next("evt"));
      if (!renamed.ok) return renamed;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ position: { storeId, seq: head.value } });
    },
    hasTitle(threadId) {
      const found = session.query.thread(threadId);
      if (!found.ok) return found;
      const title = found.value?.title ?? null;
      return ok(title !== null && title !== "");
    },
    async remove(threadId) {
      const removed = session.threads.remove(threadId);
      if (!removed.ok) return removed;
      await dropHeldThread(threadId);
      return removed;
    },
    read(params) {
      // 쪽 질의는 L1.persistence가 세션 서비스에 딸려 내놓는다. 그 서비스가 아닌 구현이 들어왔다면 조립이 틀린 것이다
      const itemPages = itemPagesOf(session);
      if (itemPages === undefined) {
        throw new Bug("host.item_pages_missing: xeon.session has no item page query");
      }
      return readThread(itemPages, storeId, params);
    },
    position() {
      const head = session.feed.headSeq();
      return head.ok ? ok({ storeId, seq: head.value }) : head;
    },
    // 요약(모델 호출, 수 초)과 커밋이 끝날 때까지 같은 thread의 `turn.start`·`turn.resume`은 기다린다
    compact: (threadId, instructions, signal) =>
      gate.run(threadId, async () => {
        const found = session.query.thread(threadId);
        if (!found.ok) return found;
        if (found.value === undefined) return err({ kind: "thread_not_found", threadId });
        if (found.value.status === "closed") return err({ kind: "thread_closed", threadId });
        // 열린 turn이 있는 동안 컴팩션을 커밋하면 루프가 쥔 가지 끝과 어긋난다. turn 사이에서만 한다(HS-77)
        const running = loop.threadStatus(threadId).runningTurnId;
        if (running !== null) return err({ kind: "turn_running", turnId: running });
        const resolved = deps.models.resolve("main", {});
        if (!resolved.ok) return err({ kind: "model_unavailable", detail: resolved.error.kind });
        const compacted = await deps.context.compact(threadId, {
          reason: "manual",
          binding: resolved.value.binding,
          contextWindow: resolved.value.model.contextWindow,
          ...(instructions === undefined ? {} : { instructions }),
          willRetry: false,
          signal,
        });
        if (!compacted.ok) return err({ kind: "context_failed", error: compacted.error });
        return ok(compacted.value);
      }),
  };

  /** `turns.submit`의 본문. 같은 thread의 컴팩션과 겹치지 않게 부르는 쪽이 gate 안에서 부른다 */
  async function submitInput(
    threadId: ThreadId,
    input: TurnStartInput,
    requestId: string | undefined,
  ): Promise<SubmitOutcome> {
    // 같은 requestId의 재제출은 처음 turnId를 돌려준다(HS-22, F wire turn.start)
    if (requestId !== undefined) {
      const existing = session.query.turnByRequestId(threadId, null, requestId);
      if (!existing.ok) return { ok: false, reason: "rejected", error: existing.error };
      if (existing.value !== undefined) return { ok: true, turnId: existing.value.turnId };
    }
    const running = loop.threadStatus(threadId).runningTurnId;
    if (running !== null) return { ok: false, reason: "busy", turnId: running };
    const admitted = await loop.admit({
      threadId,
      content: input,
      ...(requestId === undefined ? {} : { requestId }),
      via: "interactive",
    });
    // 저장소 부족·소유 상실 같은 실패는 예상 가능하다. 결함(Bug)으로 올리지 않고 처리기가 와이어 오류로 옮기게 돌려준다
    if (!admitted.ok) return { ok: false, reason: "rejected", error: admitted.error };
    const outcome = admitted.value;
    switch (outcome.status) {
      case "started":
        return { ok: true, turnId: outcome.turnId };
      case "duplicate":
        if (outcome.turnId !== null) return { ok: true, turnId: outcome.turnId };
        throw new Bug("loop.admit returned a duplicate without a turn");
      case "queued":
        // 유휴 thread에서 queued가 나오는 것은 input 지점이 입력을 보류했을 때다. 접수된 turn이 없다
        if (outcome.runningTurnId !== null) {
          return { ok: false, reason: "busy", turnId: outcome.runningTurnId };
        }
        throw new Bug("loop.admit queued the input without a running turn");
      case "handled":
        throw new Bug("loop.admit: an extension handled the input without starting a turn");
      default:
        return assertNever(outcome, "AdmitResult");
    }
  }

  const turns: TurnPort = {
    // 같은 thread의 수동 컴팩션이 도는 동안은 기다렸다가 제출한다(HS-77, §10 미결 31)
    submit: (threadId, input, requestId) =>
      gate.run(threadId, () => submitInput(threadId, input, requestId)),
    interrupt: (threadId, turnId) => loop.interrupt(threadId, turnId),
    resume: (threadId) => gate.run(threadId, () => loop.resume(threadId)),
    stopAtSafeBoundary: (deadlineMs) => loop.stopAtSafeBoundary(deadlineMs),
    isLive: (threadId) => loop.threadStatus(threadId).runningTurnId !== null,
  };

  const feed: EventFeedPort = {
    headSeq: () => session.feed.headSeq(),
    oldestReplayableSeq: () => session.feed.oldestReplayableSeq(),
    read: (after, upto, filter, limit, scanLimit) =>
      session.feed.read(after, upto, filter, limit, scanLimit),
    onCommit: (listener) => session.feed.onCommit(listener),
    onVolatile: (listener) => session.feed.onVolatile(listener),
  };

  function onLeaseLost(threadId: ThreadId): void {
    // HS-29: 소유를 잃으면 그 thread의 쓰기를 멈춘다. 의도는 쓰지 않는다(쓸 권한이 없다)
    const lost = held.get(threadId);
    held.delete(threadId);
    lost?.alive[Symbol.dispose]();
    log.error("lease.lost", { threadId });
    const scope = tasks.find("thread", threadId);
    if (scope !== undefined) {
      tasks.abort(scope, { code: "lease_lost", message: null }).catch((caught: unknown) => {
        log.error("lease.lost_abort_failed", { threadId, message: messageOf(caught) });
      });
    }
  }

  /**
   * 지운 thread의 임대를 거둔다. `session.threads.remove`는 호스트가 준 토큰을 반납하지 않는다(호스트가 반납한다, L1.persistence ownership).
   * 이벤트가 없으므로 `session.shutdown`은 발화하지 않고 확장의 thread 상태만 닫는다
   */
  async function dropHeldThread(threadId: ThreadId): Promise<void> {
    const lease = held.get(threadId);
    if (lease === undefined) return;
    held.delete(threadId);
    lease.alive[Symbol.dispose]();
    try {
      await ext.closeThread(threadId);
    } finally {
      const released = store.leases.release(lease.token);
      if (!released.ok) log.error("lease.release_failed", { threadId, kind: released.error.kind });
    }
  }

  /**
   * `acquireFresh`가 세션을 연 뒤 실패했을 때 되돌린다(`openThread` 실패, `restore` 실패). 단계마다 따로 감싸서 하나가 실패해도
   * 나머지(`closeThread`, 임대 반납)가 돈다. 정리 중 오류는 원래 실패를 가리지 않도록 기록만 한다
   */
  async function abandonOpened(
    threadId: ThreadId,
    token: LeaseToken,
    alive: Disposable,
  ): Promise<void> {
    alive[Symbol.dispose]();
    const released = await attemptAsync(() => session.release(threadId, "quit"));
    if (!released.ok) {
      log.error("thread.open_cleanup_failed", {
        threadId,
        step: "session.release",
        message: messageOf(released.error.cause),
      });
    }
    const closed = await attemptAsync(() => ext.closeThread(threadId));
    if (!closed.ok) {
      log.error("thread.open_cleanup_failed", {
        threadId,
        step: "ext.closeThread",
        message: messageOf(closed.error.cause),
      });
    }
    const lease = store.leases.release(token);
    if (!lease.ok) log.error("lease.release_failed", { threadId, kind: lease.error.kind });
  }

  async function releaseThread(threadId: ThreadId): Promise<void> {
    const lease = held.get(threadId);
    if (lease === undefined) return;
    held.delete(threadId);
    lease.alive[Symbol.dispose]();
    try {
      await session.release(threadId, "quit");
      await ext.closeThread(threadId);
    } finally {
      const released = store.leases.release(lease.token);
      if (!released.ok) log.error("lease.release_failed", { threadId, kind: released.error.kind });
    }
  }

  /** 같은 thread의 획득이 진행 중이면 그 결과를 함께 기다린다: 같은 프로세스의 두 연결이 자기 자신과 잠금을 다투지 않게 한다(HS-23) */
  const acquiring = new Map<ThreadId, Promise<LockOutcome>>();

  async function acquireFresh(threadId: ThreadId, kind: OwnerKind): Promise<LockOutcome> {
    const current = held.get(threadId);
    if (current !== undefined) {
      return { ok: true, token: current.token, release: () => releaseThread(threadId) };
    }
    // 신뢰한 작업 폴더의 project·local 설정을 읽어 둔다. 자원(임대)을 쥐기 전에 해서 실패해도 정리할 것이 없다
    await settings.prepare(threadId);
    // 서비스 모드: 이 thread의 작업 폴더가 신뢰되어 있으면 그 프로젝트의 확장을 싣는다(결정이 없으면 클라이언트가 trust.decide로 정한 뒤 싣는다)
    await deps.projectExtensions.ensure(deps.workspaceOf(threadId), deps.signal);
    const acquired = store.leases.acquire(`session:${threadId}`, { ...deps.holder, kind });
    if (!acquired.ok) {
      const error = acquired.error;
      if (error.kind === "lock_busy") return { ok: false, ownerKind: error.owner?.kind ?? null };
      // lock_io·busy·disk_full은 환경 문제다. 결함이 아니므로 store.* 와이어 오류로 알린다
      throw wireErrorOfLease(error, "lease.acquire failed");
    }
    const token = acquired.value;
    const opened = session.openForWrite(threadId, token);
    if (!opened.ok) {
      store.leases.release(token);
      // guard_mismatch는 토큰과 thread가 맞지 않는 호출 결함이다. 나머지는 예상 가능한 실패다
      if (opened.error.kind === "guard_mismatch") {
        throw new Bug("session.openForWrite: lease token does not match the thread", {
          cause: opened.error,
        });
      }
      throw wireErrorOfStore(opened.error, "session.openForWrite failed");
    }
    // 열 때 복구(L4.host-service.spec §4.1 7단계, L1.persistence.spec §4.8.1): 이전 프로세스가 남긴 결과 불명 효과를 합성 결과로 닫는다.
    // 실행은 시작하지 않는다. 재실행 후보와 열린 turn은 그대로 두고 재개·새 입력이 이어받는다
    const recovered = session.recover(threadId, {
      toolReplay: (name) => deps.tools.meta(name)?.replay ?? null,
      cancelledByOwner: () => false,
      hostMode: deps.mode,
    });
    if (!recovered.ok) {
      store.leases.release(token);
      throw wireErrorOfStore(recovered.error, "session.recover failed");
    }
    const alive = store.leases.keepAlive(token, () => {
      onLeaseLost(threadId);
    });
    try {
      await ext.openThread(threadId);
    } catch (caught) {
      await abandonOpened(threadId, token, alive);
      // 확장 상태를 읽지 못한 것(busy, io, 손상 행)은 저장소 오류로 알린다. 빈 상태로 열면 켜짐과 상태 판을 잃는다
      if (caught instanceof PrimitiveError && caught.code === "storage_unavailable") {
        throw wireError("store.io", {
          message: `ext.openThread failed: ${caught.message}`.slice(0, 200),
          details: { code: "ext_state_unreadable" },
        });
      }
      throw caught;
    }
    // 이전 프로세스가 남긴 미해결 승인 요청을 메모리 대기 목록으로 되살린다. approval.respond가 재시작 뒤에도 그 요청을 찾는다(HOST.4)
    const restored = await deps.approvals.restore(threadId);
    if (!restored.ok) {
      // 세션과 확장 상태가 이미 열렸다. 임대만 놓으면 열린 것이 남으므로 닫고 놓는다
      await abandonOpened(threadId, token, alive);
      throw wireErrorOfStore(restored.error, "approvals.restore failed");
    }
    held.set(threadId, { token, alive });
    return { ok: true, token, release: () => releaseThread(threadId) };
  }

  const locks: SessionLockPort = {
    tryAcquire(threadId, kind: OwnerKind): Promise<LockOutcome> {
      const pending = acquiring.get(threadId);
      if (pending !== undefined) return pending;
      const started = acquireFresh(threadId, kind).finally(() => {
        acquiring.delete(threadId);
      });
      acquiring.set(threadId, started);
      return started;
    },
    holds: (threadId) => held.has(threadId),
    release: (threadId) => releaseThread(threadId),
  };

  const settings: SettingsStorePort = createSettingsStore({
    engine: deps.settings,
    session,
    configDir: deps.configDir,
    trust: deps.trust,
    ids: deps.ids,
    logger: logger.child({ component: "settings" }),
    signal: deps.signal,
    holds: (threadId) => held.has(threadId),
  });

  const trust: TrustPort = {
    async get(workspace, signal) {
      if (!isAbsolute(workspace)) return err({ kind: "workspace_not_absolute" });
      return ok(trustStatusOf(await deps.trust.inspect(workspace, signal)));
    },
    async decide(workspace, choice, signal) {
      if (!isAbsolute(workspace)) return err({ kind: "workspace_not_absolute" });
      const decided = await deps.trust.decide(workspace, choice, signal);
      if (!decided.ok) return decided;
      // 신뢰가 바뀌었으므로 작업 폴더의 project·local 층을 다시 판정해 읽는다. 쥔 thread는 지금 바로 다시 읽는다
      deps.settings.clearWorkspaceFiles();
      await sequentially(Array.from(held.keys()), (threadId) => settings.prepare(threadId));
      // 어느 키가 바뀌었는지 모르는 변경이다(keys가 빈 알림, F wire §3.3.2)
      deps.settings.notifyChanged({ keys: [], scopes: ["project", "local"], threadId: null });
      // 서비스 모드: 허용된 작업 폴더의 프로젝트 확장을 지금 싣는다
      await deps.projectExtensions.ensure(workspace, signal);
      return ok(trustStatusOf(decided.value));
    },
  };

  const approvals: ApprovalPort = createApprovalPort({
    approvals: deps.approvals,
    session,
    storeId,
    heldThreads: () => Array.from(held.keys()),
  });

  const activity: ActivityPort = {
    snapshot() {
      const snapshot = tasks.activity();
      return {
        liveTurns: snapshot.liveTurns,
        // 켜진 루프는 백그라운드 작업으로 센다(M3-10)
        liveTasks: snapshot.liveTasks + deps.schedule.liveSchedulerTasks(),
        // 대기 예약은 유휴 종료 판정이 쓴다. 승인 대기는 이 프로세스가 쥔 thread의 미해결 요청이다
        waitingApprovals: Array.from(held.keys()).reduce(
          (sum, threadId) => sum + deps.approvals.pending(threadId).length,
          0,
        ),
        pendingSchedules: deps.pendingSchedules?.count() ?? deps.schedule.pendingSchedules(),
      };
    },
    onChange: (listener) => {
      const offTasks = tasks.onActivity(listener);
      const offSchedules = deps.pendingSchedules?.onChange(listener);
      const offSchedule = deps.schedule.onChange(listener);
      return () => {
        offTasks();
        offSchedules?.();
        offSchedule();
      };
    },
  };

  const notify: UserNotifyPort = {
    async show(input) {
      const result = await deps.os.notify(
        {
          kind: "done",
          title: input.title.slice(0, 80),
          body: input.body.slice(0, 400),
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        },
        deps.signal,
      );
      if (!result.ok && result.error.kind !== "disabled") {
        log.error("notify.failed", { kind: result.error.kind });
      }
    },
  };

  const ports: EnginePorts = {
    threads,
    turns,
    feed,
    locks,
    settings,
    approvals,
    activity,
    notify,
    log,
    secrets: deps.secrets,
    models: { modelIds: (provider) => modelIdsOf(deps.models, provider) },
    commands: createCommandPort({ holder: deps.commands, ids: deps.ids }),
    web: createWebPort({ holder: deps.web, settings: deps.settings }),
    dialog: createDialogWirePort({ holder: deps.commands }),
    proposals: deps.proposals,
    trust,
    schedule: deps.schedule,
    ids: deps.ids,
    clock: deps.clock,
    scheduler: deps.scheduler,
  };

  return {
    ports,
    tokenOf: (threadId) => held.get(threadId)?.token,
    heldThreads: () => Array.from(held.keys()),
    activeThread: () => Array.from(held.keys()).at(-1) ?? null,
    releaseAll() {
      return sequentially(Array.from(held.keys()), async (threadId) => {
        try {
          await releaseThread(threadId);
        } catch (caught) {
          log.error("lease.release_all_failed", { threadId, message: messageOf(caught) });
        }
      });
    },
  };
}

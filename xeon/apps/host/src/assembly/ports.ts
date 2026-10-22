import {
  assertNever,
  attempt,
  Bug,
  parse,
  type Clock,
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
  LoopService,
  OsService,
  TaskService,
  ToolService,
} from "@xeon/contracts/services";
import { StoreIdSchema, type StoreId } from "@xeon/contracts/wire";
import type { ExtHost } from "@xeon/ext-host";
import type {
  ActivityPort,
  ApprovalPort,
  EventFeedPort,
  EnginePorts,
  HostLogPort,
  HostMode,
  LockOutcome,
  OwnerKind,
  SessionLockPort,
  SettingsStorePort,
  SubmitOutcome,
  ThreadPort,
  TurnPort,
  UserNotifyPort,
} from "../types.ts";
import { wireErrorOfCreate, wireErrorOfLease, wireErrorOfStore } from "../store-error.ts";
import { messageOf, sequentially } from "../util.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// L4.host-service.spec §3.3.2. 아래 층 서비스(F 서비스 인터페이스)를 EnginePorts로 감싸는 어댑터. 어댑터가 이 폴더 한 곳에 모이므로
// L1 서비스 이름이 바뀌어도 고칠 곳이 하나다(L4.host-service.plan §2). 조립 루트 코드(DR-14 예외 2).

export interface PortsDeps {
  /** 엔진 수명 신호. 닫히면 진행 중인 알림 같은 기다리지 않는 호출을 중단한다 */
  readonly signal: AbortSignal;
  readonly mode: HostMode;
  readonly os: OsService;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly session: SessionService;
  readonly store: StoreService;
  readonly loop: LoopService;
  readonly tasks: TaskService;
  readonly approvals: ApprovalService;
  /** 열 때 복구가 도구의 현재 재실행 정책을 본다(ToolService.meta) */
  readonly tools: Pick<ToolService, "meta">;
  readonly ext: ExtHost;
  readonly holder: LeaseHolder;
  readonly settings: SettingsEngine;
}

export interface PortsHandle {
  readonly ports: EnginePorts;
  /** 쥔 세션 임대를 모두 반납한다(엔진을 닫기 전). 각 thread에 session_shutdown("quit")을 발화한다 */
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

function toLogFields(fields: Readonly<Record<string, unknown>>): LogFields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toLogValue(value)]));
}

function unsupported(what: string): Promise<never> {
  return Promise.reject(
    new Bug(`${what} is not available before M2 (L4.host-service.plan H9, H16~H18)`),
  );
}

/** 아직 구현되지 않은 하위 층 기능이 던지는 Bug("<영역>.not_implemented: …") */
function isNotImplemented(caught: unknown): boolean {
  return caught instanceof Bug && /^[a-z]+\.not_implemented:/.test(caught.message);
}

function storeIdOf(raw: string): StoreId {
  const parsed = parse(StoreIdSchema, raw);
  if (!parsed.ok) throw new Bug(`store.invalid_store_id: ${raw}`, { cause: parsed.error });
  return parsed.value;
}

interface HeldLease {
  readonly token: LeaseToken;
  readonly alive: Disposable;
}

export function createEnginePorts(deps: PortsDeps): PortsHandle {
  const { session, store, loop, tasks, ext, logger } = deps;
  const storeId = storeIdOf(store.storeId);
  const held = new Map<ThreadId, HeldLease>();

  const log: HostLogPort = {
    error: (message, fields) => {
      logger.error(message, toLogFields(fields));
    },
    info: (message, fields) => {
      logger.info(message, toLogFields(fields));
    },
  };

  const threads: ThreadPort = {
    create(input) {
      const threadId = deps.ids.next("thr");
      const created = session.threads.create({
        threadId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
      });
      if (!created.ok) {
        return Promise.reject(wireErrorOfCreate(created.error, "threads.create failed"));
      }
      return Promise.resolve({
        threadId: created.value.threadId,
        position: { storeId, seq: session.feed.headSeq() },
      });
    },
    exists: (threadId) => session.query.thread(threadId) !== undefined,
    list(params) {
      const page = session.threads.list({
        ...(params.workspace === undefined ? {} : { workspace: params.workspace }),
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
      return Promise.resolve({ threads: [...page.threads], nextCursor: page.nextCursor });
    },
    fork: () => unsupported("thread.fork"),
    revert: () => unsupported("thread.revert"),
    remove: () => unsupported("thread.delete"),
    position: () => ({ storeId, seq: session.feed.headSeq() }),
  };

  const turns: TurnPort = {
    async submit(threadId, input, requestId): Promise<SubmitOutcome> {
      // 같은 requestId의 재제출은 처음 turnId를 돌려준다(HS-22, F wire turn.start)
      if (requestId !== undefined) {
        const existing = session.query.turnByRequestId(threadId, null, requestId);
        if (existing !== undefined) return { ok: true, turnId: existing.turnId };
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
    },
    interrupt: (threadId, turnId) => loop.interrupt(threadId, turnId),
    stopAtSafeBoundary: (deadlineMs) => loop.stopAtSafeBoundary(deadlineMs),
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

  const locks: SessionLockPort = {
    async tryAcquire(threadId, kind: OwnerKind): Promise<LockOutcome> {
      const current = held.get(threadId);
      if (current !== undefined) {
        return { ok: true, token: current.token, release: () => releaseThread(threadId) };
      }
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
        if (isNotImplemented(caught)) {
          // core-persistence의 ext.loadThread(PS-16)는 M2다. 그 전에는 확장의 thread 상태(켜짐, 상태 판, 임대)를 읽어 들이지 못하지만
          // 기본 대화는 돌아간다. 구현되면 이 분기는 저절로 쓰이지 않는다 [미결]
          log.info("thread.extension_state_unavailable", { threadId, message: messageOf(caught) });
        } else {
          alive[Symbol.dispose]();
          store.leases.release(token);
          throw caught;
        }
      }
      held.set(threadId, { token, alive });
      return { ok: true, token, release: () => releaseThread(threadId) };
    },
    holds: (threadId) => held.has(threadId),
  };

  const changeListeners = new Set<() => void>();
  const settings: SettingsStorePort = {
    layers: (threadId) => deps.settings.layers(threadId),
    write: () => unsupported("settings.set"),
    reset: () => unsupported("settings.reset"),
    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
  };

  const approvals: ApprovalPort = {
    respond: () => unsupported("approval.respond"),
  };

  const activity: ActivityPort = {
    snapshot() {
      const snapshot = tasks.activity();
      return {
        liveTurns: snapshot.liveTurns,
        liveTasks: snapshot.liveTasks,
        // 승인 대기와 대기 예약은 host.status·유휴 종료(M2·M3)가 쓴다
        waitingApprovals: 0,
        pendingSchedules: 0,
      };
    },
    onChange: (listener) => tasks.onActivity(listener),
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
    ids: deps.ids,
    clock: deps.clock,
  };

  return {
    ports,
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

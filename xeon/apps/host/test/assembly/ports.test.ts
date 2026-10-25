import { describe, expect, test } from "bun:test";
import { Bug, err, ok, type Logger } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  LeaseError,
  LeaseOwnerInfo,
  LeaseToken,
  OpenReport,
  ResumePlan,
  SessionService,
  StoreService,
  ThreadSummaryRow,
  TurnView,
} from "@xeon/contracts/records";
import type {
  AbortTicket,
  AdmitResult,
  ApprovalService,
  LoopError,
  LoopService,
  OsService,
  TaskService,
  ThreadLoopStatus,
  ToolMeta,
  ToolService,
} from "@xeon/contracts/services";
import { WireError } from "@xeon/contracts/wire";
import type { ExtHost } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createEnginePorts, type PortsDeps } from "../../src/assembly/ports.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { flushMicrotasks } from "../fixtures/clock.ts";
import { createManualScheduler } from "../fixtures/manual-scheduler.ts";
import { partial } from "../fixtures/unsafe.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { sequentially } from "../../src/util.ts";

// 어댑터(EnginePorts)가 F 서비스 인터페이스를 어떻게 감싸는지 가짜 서비스로 본다. 서비스 인터페이스는 크고 어댑터가 쓰는 멤버는
// 일부라, 시험은 쓰는 멤버만 채운 가짜를 서비스 타입으로 다룬다.

const ids = fixedIdFactory(400);
const STORE_ID = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = ids.next("thr");
const TURN = ids.next("trn");

interface Harness {
  readonly deps: PortsDeps;
  readonly calls: string[];
  readonly infos: string[];
  readonly errors: string[];
  state: {
    acquire: ReturnType<StoreService["leases"]["acquire"]>;
    openForWrite: ReturnType<SessionService["openForWrite"]>;
    recover: ReturnType<SessionService["recover"]>;
    openThreadError: Error | undefined;
    admit: Awaited<ReturnType<LoopService["admit"]>>;
    runningTurn: typeof TURN | null;
    existingTurn: { turnId: typeof TURN } | undefined;
    threadsCreate: ReturnType<SessionService["threads"]["create"]>;
    threadExists: boolean;
    release: "ok" | "throw";
    fork: Awaited<ReturnType<SessionService["threads"]["fork"]>>;
    revert: Awaited<ReturnType<SessionService["threads"]["revert"]>>;
    remove: ReturnType<SessionService["threads"]["remove"]>;
  };
  lostCallback: (() => void) | undefined;
}

const TOKEN: LeaseToken = { resource: `session:${THREAD}`, holderId: "h", epoch: 4 };

function owner(kind: LeaseOwnerInfo["kind"]): LeaseOwnerInfo {
  return {
    holderId: "other",
    kind,
    pid: 9,
    startedAt: 1,
    host: "m",
    epoch: 1,
    heartbeatAt: 1,
    expiresAt: 2,
  };
}

function busy(row: LeaseOwnerInfo | null): ReturnType<StoreService["leases"]["acquire"]> {
  return err<LeaseError>({
    kind: "lock_busy",
    resource: TOKEN.resource,
    reason: "os_lock_held",
    owner: row,
  });
}

function harness(): Harness {
  const calls: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const state: Harness["state"] = {
    acquire: ok(TOKEN),
    openForWrite: ok(partial<OpenReport>({})),
    recover: ok(partial<ResumePlan>({})),
    openThreadError: undefined,
    admit: ok({ status: "started", inputId: ids.next("evt"), turnId: TURN }),
    runningTurn: null,
    existingTurn: undefined,
    threadsCreate: ok({ threadId: THREAD, headSeq: 1, replayed: false, token: null }),
    threadExists: true,
    release: "ok",
    fork: err({ kind: "thread_not_found", threadId: THREAD }),
    revert: err({ kind: "thread_not_found", threadId: THREAD }),
    remove: ok(undefined),
  };
  const result: Harness = {
    deps: partial<PortsDeps>({}),
    calls,
    infos,
    errors,
    state,
    lostCallback: undefined,
  };
  const logger: Logger = {
    debug: () => undefined,
    info: (event) => {
      infos.push(event);
    },
    warn: () => undefined,
    error: (event) => {
      errors.push(event);
    },
    child: () => logger,
  };
  const scope = partial<NonNullable<ReturnType<TaskService["find"]>>>({});
  const session = partial<SessionService>({
    threads: partial<SessionService["threads"]>({
      create: (input) => {
        calls.push(`threads.create:${JSON.stringify(input)}`);
        return state.threadsCreate;
      },
      list: () => ({ threads: [], nextCursor: "next" }),
      fork: (threadId, _at, newThreadId) => {
        calls.push(`threads.fork:${threadId}:${newThreadId}`);
        return Promise.resolve(state.fork);
      },
      revert: (_threadId, _to, requestKey) => {
        calls.push(`threads.revert:${requestKey}`);
        return Promise.resolve(state.revert);
      },
      remove: () => {
        calls.push("threads.remove");
        return state.remove;
      },
    }),
    query: partial<SessionService["query"]>({
      thread: () => ok(state.threadExists ? partial<ThreadSummaryRow>({}) : undefined),
      turnByRequestId: () =>
        ok(state.existingTurn === undefined ? undefined : partial<TurnView>(state.existingTurn)),
    }),
    feed: partial<SessionService["feed"]>({
      headSeq: () => ok(5),
      oldestReplayableSeq: () => 0,
    }),
    openForWrite: () => state.openForWrite,
    recover: (threadId, recoverDeps) => {
      calls.push(
        `session.recover:${threadId}:${recoverDeps.hostMode}:${recoverDeps.toolReplay("bash")}`,
      );
      return state.recover;
    },
    release: () => {
      calls.push("session.release");
      if (state.release === "throw") return Promise.reject(new Error("release failed"));
      return Promise.resolve();
    },
  });
  const store = partial<StoreService>({
    storeId: STORE_ID,
    leases: partial<StoreService["leases"]>({
      acquire: (resource, holder) => {
        calls.push(`lease.acquire:${resource}:${holder.kind}`);
        return state.acquire;
      },
      release: () => {
        calls.push("lease.release");
        return ok(undefined);
      },
      keepAlive: (_token, onLost) => {
        result.lostCallback = () => {
          onLost(TOKEN.resource);
        };
        return {
          [Symbol.dispose]: () => {
            calls.push("keepAlive.dispose");
          },
        };
      },
    }),
  });
  const loop = partial<LoopService>({
    threadStatus: () => partial<ThreadLoopStatus>({ runningTurnId: state.runningTurn }),
    admit: () => Promise.resolve(state.admit),
    interrupt: () => Promise.resolve(true),
    stopAtSafeBoundary: () => Promise.resolve(true),
  });
  const tasks = partial<TaskService>({
    find: () => scope,
    abort: (_target, reason) => {
      calls.push(`tasks.abort:${reason.code}`);
      return Promise.resolve(ok(partial<AbortTicket>({})));
    },
    activity: () => ({ liveTurns: 1, liveTasks: 3, queuedInputs: 2 }),
    onActivity: () => () => undefined,
  });
  const ext = partial<ExtHost>({
    openThread: () => {
      calls.push("ext.openThread");
      return state.openThreadError === undefined
        ? Promise.resolve()
        : Promise.reject(state.openThreadError);
    },
    closeThread: () => {
      calls.push("ext.closeThread");
      return Promise.resolve();
    },
  });
  const os = partial<OsService>({
    notify: (notification) => {
      calls.push(`os.notify:${notification.title.length}:${notification.body.length}`);
      return Promise.resolve(ok(undefined));
    },
  });
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return Object.assign(result, {
    deps: {
      mode: "stdio" as const,
      signal: new AbortController().signal,
      os,
      clock: { now: () => 1 },
      scheduler: createManualScheduler(),
      ids,
      logger,
      session,
      store,
      loop,
      tasks,
      approvals: partial<ApprovalService>({
        restore: (threadId) => {
          calls.push(`approvals.restore:${threadId}`);
          return Promise.resolve(ok([]));
        },
        pending: () => [],
      }),
      tools: partial<ToolService>({ meta: () => partial<ToolMeta>({ replay: "unsafe" }) }),
      ext,
      holder: { holderId: "h", kind: "app" as const, pid: 1, startedAt: 1, host: "m" },
      settings: createSettingsEngine(built.catalog),
      configDir: "/nonexistent-config",
      trust: {
        resolve: () => Promise.reject(new Error("trust is not used by these tests")),
        isTrusted: () => Promise.resolve(false),
        explicitVerdict: () => Promise.resolve("none"),
      },
    },
  });
}

describe("threads", () => {
  test("create forwards title and workspace, then reports the position in this store", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const created = await ports.threads.create({ title: "t", workspace: "/w" });
    expect(created.threadId).toBe(THREAD);
    expect(created.position).toEqual({ storeId: STORE_ID, seq: 5 });
    expect(h.calls[0]).toContain('"title":"t"');
    expect(h.calls[0]).toContain('"workspace":"/w"');
  });

  test("a refused create is a store.* wire error, not a Bug", async () => {
    const h = harness();
    h.state.threadsCreate = err({ kind: "busy" });
    const { ports } = createEnginePorts(h.deps);
    const thrown = await rejectionOf(ports.threads.create({}));
    if (!(thrown instanceof WireError)) throw new Error("expected a WireError");
    expect(thrown.data.kind).toBe("store.busy");
  });

  test("a lifecycle error that create cannot produce is a Bug", async () => {
    const h = harness();
    h.state.threadsCreate = err({ kind: "has_forks", forks: [] });
    const { ports } = createEnginePorts(h.deps);
    expect(await rejectionOf(ports.threads.create({}))).toBeInstanceOf(Bug);
  });

  test("exists, position and list read the session projection and feed", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    expect(ports.threads.exists(THREAD)).toEqual({ ok: true, value: true });
    h.state.threadExists = false;
    expect(ports.threads.exists(THREAD)).toEqual({ ok: true, value: false });
    expect(ports.threads.position(THREAD)).toEqual({
      ok: true,
      value: { storeId: STORE_ID, seq: 5 },
    });
    expect(await ports.threads.list({})).toEqual({ threads: [], nextCursor: "next" });
  });

  test("fork makes a new thread id, passes it to the session and reports the new position", async () => {
    const h = harness();
    const newId = ids.next("thr");
    h.state.fork = ok({ threadId: newId, headSeq: 9, replayed: false, token: null });
    const { ports } = createEnginePorts(h.deps);
    const forked = await ports.threads.fork(THREAD, undefined);
    expect(forked).toEqual({
      ok: true,
      value: { threadId: newId, position: { storeId: STORE_ID, seq: 5 } },
    });
    expect(h.calls.some((call) => call.startsWith(`threads.fork:${THREAD}:`))).toBe(true);
  });

  test("a refused fork is a lifecycle error value, not a throw", async () => {
    const h = harness();
    h.state.fork = err({ kind: "invalid_target", reason: "not_on_branch" });
    const { ports } = createEnginePorts(h.deps);
    expect(await ports.threads.fork(THREAD, ids.next("itm"))).toEqual({
      ok: false,
      error: { kind: "invalid_target", reason: "not_on_branch" },
    });
  });

  test("revert uses a fresh request key for every call and reports the head the session committed", async () => {
    const h = harness();
    h.state.revert = ok({ leaf: ids.next("evt"), headSeq: 12 });
    const { ports } = createEnginePorts(h.deps);
    const to = ids.next("itm");
    const first = await ports.threads.revert(THREAD, to);
    await ports.threads.revert(THREAD, to);
    expect(first).toEqual({ ok: true, value: { position: { storeId: STORE_ID, seq: 12 } } });
    const keys = h.calls.filter((call) => call.startsWith("threads.revert:"));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  test("remove hands back the lease the host holds for the deleted thread", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const lock = await ports.locks.tryAcquire(THREAD, "cli");
    expect(lock.ok).toBe(true);
    h.calls.length = 0;
    const removed = await ports.threads.remove(THREAD);
    expect(removed.ok).toBe(true);
    expect(ports.locks.holds(THREAD)).toBe(false);
    expect(h.calls).toEqual([
      "threads.remove",
      "keepAlive.dispose",
      "ext.closeThread",
      "lease.release",
    ]);
  });

  test("a refused remove keeps the lease", async () => {
    const h = harness();
    h.state.remove = err({ kind: "has_forks", forks: [] });
    const { ports } = createEnginePorts(h.deps);
    await ports.locks.tryAcquire(THREAD, "cli");
    const removed = await ports.threads.remove(THREAD);
    expect(removed.ok).toBe(false);
    expect(ports.locks.holds(THREAD)).toBe(true);
  });
});

describe("turns", () => {
  test("a started turn is accepted", async () => {
    const { ports } = createEnginePorts(harness().deps);
    expect(await ports.turns.submit(THREAD, "hi", undefined)).toEqual({ ok: true, turnId: TURN });
  });

  test("a request id that already made a turn returns that turn without asking the loop", async () => {
    const h = harness();
    h.state.existingTurn = { turnId: TURN };
    h.state.admit = err({ kind: "input_invalid", message: "must not be called" });
    const { ports } = createEnginePorts(h.deps);
    expect(await ports.turns.submit(THREAD, "hi", "req")).toEqual({ ok: true, turnId: TURN });
  });

  test("a running turn is busy and nothing is submitted", async () => {
    const h = harness();
    h.state.runningTurn = TURN;
    h.state.admit = err({ kind: "input_invalid", message: "must not be called" });
    const { ports } = createEnginePorts(h.deps);
    expect(await ports.turns.submit(THREAD, "hi", undefined)).toEqual({
      ok: false,
      reason: "busy",
      turnId: TURN,
    });
  });

  test("duplicate and queued answers map to a turn or to busy; impossible answers are Bugs", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const inputId = ids.next("evt");
    h.state.admit = ok({ status: "duplicate", inputId, turnId: TURN });
    expect(await ports.turns.submit(THREAD, "hi", "r")).toEqual({ ok: true, turnId: TURN });
    h.state.admit = ok({ status: "queued", inputId, mode: "followUp", runningTurnId: TURN });
    expect(await ports.turns.submit(THREAD, "hi", "r")).toEqual({
      ok: false,
      reason: "busy",
      turnId: TURN,
    });
    const bad: AdmitResult[] = [
      { status: "duplicate", inputId, turnId: null },
      { status: "queued", inputId, mode: "followUp", runningTurnId: null },
      { status: "handled" },
    ];
    await sequentially(bad, async (status) => {
      h.state.admit = ok(status);
      expect(await rejectionOf(ports.turns.submit(THREAD, "hi", "r"))).toBeInstanceOf(Bug);
    });
  });

  test("a refused admit is an expected rejection carrying the loop error, not a Bug", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const errors: LoopError[] = [
      { kind: "input_invalid", message: "x" },
      { kind: "disk_full" },
      { kind: "read_only", reason: "observer" },
      { kind: "ownership_lost", threadId: THREAD },
    ];
    await sequentially(errors, async (error) => {
      h.state.admit = err(error);
      expect(await ports.turns.submit(THREAD, "hi", "r")).toEqual({
        ok: false,
        reason: "rejected",
        error,
      });
    });
  });

  test("interrupt and stopAtSafeBoundary pass through", async () => {
    const { ports } = createEnginePorts(harness().deps);
    expect(await ports.turns.interrupt(THREAD, undefined)).toBe(true);
    expect(await ports.turns.stopAtSafeBoundary(1000)).toBe(true);
  });
});

describe("locks", () => {
  test("acquiring leases the session, opens it for writing, keeps it alive and opens the thread for extensions", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    expect(ports.locks.holds(THREAD)).toBe(false);
    const outcome = await ports.locks.tryAcquire(THREAD, "app");
    expect(outcome.ok).toBe(true);
    // 열 때 복구는 도구의 현재 재실행 정책을 본다(HS 4.1 7단계)
    expect(h.calls).toEqual([
      `lease.acquire:session:${THREAD}:app`,
      `session.recover:${THREAD}:stdio:unsafe`,
      "ext.openThread",
      `approvals.restore:${THREAD}`,
    ]);
    expect(ports.locks.holds(THREAD)).toBe(true);
    // 쥔 thread를 다시 요청하면 같은 증표를 돌려주고 다시 얻지 않는다
    const again = await ports.locks.tryAcquire(THREAD, "app");
    expect(again.ok && again.token).toEqual(TOKEN);
    expect(h.calls.filter((call) => call.startsWith("lease.acquire"))).toHaveLength(1);
  });

  test("two connections asking for the same thread at once share one acquisition (HS-23)", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const [first, second] = await Promise.all([
      ports.locks.tryAcquire(THREAD, "app"),
      ports.locks.tryAcquire(THREAD, "app"),
    ]);
    expect(first.ok && second.ok).toBe(true);
    expect(h.calls.filter((call) => call.startsWith("lease.acquire"))).toHaveLength(1);
    // 실패한 획득은 기록을 남기지 않아 다음 요청이 다시 시도한다
    const other = ids.next("thr");
    h.state.acquire = busy(null);
    expect(await ports.locks.tryAcquire(other, "app")).toEqual({ ok: false, ownerKind: null });
    h.state.acquire = ok(TOKEN);
    expect((await ports.locks.tryAcquire(other, "app")).ok).toBe(true);
  });

  test("release gives the lock back by thread id, and releasing a thread that is not held does nothing", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    await ports.locks.release(THREAD);
    expect(h.calls).toEqual([]);
    await ports.locks.tryAcquire(THREAD, "app");
    await ports.locks.release(THREAD);
    expect(ports.locks.holds(THREAD)).toBe(false);
    expect(h.calls.at(-1)).toBe("lease.release");
  });

  test("releasing runs session_shutdown, closes the thread for extensions and returns the lease", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    const outcome = await ports.locks.tryAcquire(THREAD, "app");
    if (!outcome.ok) throw new Error("expected the lock");
    h.calls.length = 0;
    await outcome.release();
    expect(h.calls).toEqual([
      "keepAlive.dispose",
      "session.release",
      "ext.closeThread",
      "lease.release",
    ]);
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("a busy lease is a refusal naming the owner kind from the lease row, or null without a row", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    h.state.acquire = busy(owner("service"));
    expect(await ports.locks.tryAcquire(THREAD, "cli")).toEqual({
      ok: false,
      ownerKind: "service",
    });
    h.state.acquire = busy(null);
    expect(await ports.locks.tryAcquire(THREAD, "cli")).toEqual({ ok: false, ownerKind: null });
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("any other lease failure is an environment error naming its kind, not a Bug", async () => {
    const h = harness();
    h.state.acquire = err({ kind: "lock_io", code: "EIO" });
    const { ports } = createEnginePorts(h.deps);
    const thrown = await rejectionOf(ports.locks.tryAcquire(THREAD, "cli"));
    if (!(thrown instanceof WireError)) throw new Error("expected a WireError");
    expect(thrown).not.toBeInstanceOf(Bug);
    expect(thrown.data.kind).toBe("store.io");
    expect(thrown.data.details).toEqual({ code: "EIO" });
  });

  test("a failed recovery on open gives the lease back and is a wire error, not a Bug", async () => {
    const h = harness();
    h.state.recover = err({ kind: "busy" });
    const { ports } = createEnginePorts(h.deps);
    const thrown = await rejectionOf(ports.locks.tryAcquire(THREAD, "cli"));
    if (!(thrown instanceof WireError)) throw new Error("expected a WireError");
    expect(thrown.data.kind).toBe("store.busy");
    expect(thrown.message).toContain("session.recover failed");
    expect(h.calls).toContain("lease.release");
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("a thread that cannot be opened for writing gives the lease back", async () => {
    const h = harness();
    h.state.openForWrite = err({ kind: "guard_mismatch", threadId: THREAD });
    const { ports } = createEnginePorts(h.deps);
    expect(await rejectionOf(ports.locks.tryAcquire(THREAD, "cli"))).toBeInstanceOf(Bug);
    expect(h.calls).toContain("lease.release");
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("a not_implemented Bug from ext.openThread is raised and the lease is given back", async () => {
    const h = harness();
    h.state.openThreadError = new Bug("session.not_implemented: ext.loadThread");
    const { ports } = createEnginePorts(h.deps);
    const thrown = await rejectionOf(ports.locks.tryAcquire(THREAD, "cli"));
    expect(thrown).toBeInstanceOf(Bug);
    expect(String(thrown)).toContain("session.not_implemented");
    expect(h.calls).toContain("lease.release");
    expect(h.infos).not.toContain("thread.extension_state_unavailable");
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("any other failure while opening the thread for extensions gives the lease back and is raised", async () => {
    const h = harness();
    h.state.openThreadError = new Error("boom");
    const { ports } = createEnginePorts(h.deps);
    expect(String(await rejectionOf(ports.locks.tryAcquire(THREAD, "cli")))).toContain("boom");
    expect(h.calls).toContain("lease.release");
    expect(h.calls).toContain("keepAlive.dispose");
    expect(ports.locks.holds(THREAD)).toBe(false);
  });

  test("a lost lease drops the thread and aborts its work with lease_lost", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    await ports.locks.tryAcquire(THREAD, "cli");
    h.lostCallback?.();
    await flushMicrotasks();
    expect(ports.locks.holds(THREAD)).toBe(false);
    expect(h.calls).toContain("tasks.abort:lease_lost");
    expect(h.errors).toContain("lease.lost");
  });

  test("releaseAll returns every lease and logs, rather than throws, a failing release", async () => {
    const h = harness();
    const handle = createEnginePorts(h.deps);
    await handle.ports.locks.tryAcquire(THREAD, "cli");
    h.state.release = "throw";
    await handle.releaseAll();
    expect(h.errors).toContain("lease.release_all_failed");
    expect(handle.ports.locks.holds(THREAD)).toBe(false);
    expect(h.calls).toContain("lease.release");
  });
});

describe("the small ports", () => {
  test("activity maps the task counters and leaves approvals and schedules at zero until M2·M3", () => {
    const { ports } = createEnginePorts(harness().deps);
    expect(ports.activity.snapshot()).toEqual({
      liveTurns: 1,
      liveTasks: 3,
      waitingApprovals: 0,
      pendingSchedules: 0,
    });
    ports.activity.onChange(() => undefined)();
  });

  test("settings reads the engine layers and the change subscription can be dropped", () => {
    const { ports } = createEnginePorts(harness().deps);
    expect(ports.settings.layers(undefined)).toHaveLength(1);
    const off = ports.settings.onChange(() => undefined);
    off();
  });

  test("notify shortens the title and body to what the OS contract accepts", async () => {
    const h = harness();
    const { ports } = createEnginePorts(h.deps);
    await ports.notify.show({ title: "t".repeat(200), body: "b".repeat(900), threadId: THREAD });
    expect(h.calls).toContain("os.notify:80:400");
  });

  test("the log port turns any field into a log value", () => {
    const entries: unknown[] = [];
    const h = harness();
    const deps: PortsDeps = {
      ...h.deps,
      logger: {
        debug: () => undefined,
        info: (_event, fields) => {
          entries.push(fields);
        },
        warn: () => undefined,
        error: () => undefined,
        child: () => h.deps.logger,
      },
    };
    const { ports } = createEnginePorts(deps);
    ports.log.info("x", {
      n: 1,
      big: 10n,
      nested: { a: 1 },
      nothing: undefined,
      inf: Infinity,
      ok: true,
    });
    expect(entries).toEqual([
      { n: 1, big: "[bigint]", nested: '{"a":1}', nothing: null, inf: "Infinity", ok: true },
    ]);
  });
});

export type { ThreadId };

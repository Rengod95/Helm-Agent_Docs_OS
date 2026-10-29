import {
  assertNever,
  attempt,
  attemptAsync,
  Bug,
  detach,
  err,
  ok,
  parse,
  type Result,
} from "@xeon/contracts";
import { ThreadIdSchema, TurnCompletedPayloadSchema } from "@xeon/contracts/conversation";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  StoreIdSchema,
  WireError,
  type EventsBatchParams,
  type EventsSubscribeResult,
  type EventWire,
  type JsonRpcMessage,
  type StreamPosition,
  type TurnResumeResult,
} from "@xeon/contracts/wire";
import { HostClientError } from "../host-client.ts";
import type { ChatTarget } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import type { Failure } from "../errors.ts";
import { failureOfWire } from "../errors.ts";
import { EXIT } from "../exit-codes.ts";
import {
  applyBatch,
  applyChunk,
  initialTranscript,
  type RenderOp,
  type TranscriptState,
} from "../render/model.ts";
import { deliveredOpsOf, handlerFailedOpsOf } from "../render/notices.ts";
import { approvalViewOf } from "../render/transcript.ts";
import type { ApprovalSink } from "../render/approval.ts";
import type { LockOption, LockPrompt } from "../render/lock.ts";
import type { RenderSink } from "../render/text-sink.ts";
import {
  entryFor,
  readCliState,
  withEntry,
  writeCliStateSync,
  type CliState,
  type StateReadOutcome,
} from "../state.ts";
import { sequentially } from "../util.ts";

// L4.cli.spec §4.3, §4.4. 세션 하나를 열고(새 세션, --continue, --resume), 구독하고, 내구·휘발 알림을 트랜스크립트로
// 적용하고, turn 하나를 보내 끝날 때까지 기다린다. print 모드와 대화형이 같은 구동기를 쓴다.

// ── CLI 상태 파일 위치 보관 ───────────────────────────────────────────────

export interface PositionKeeper {
  /** 대상 세션이 정해졌다. 그 위치를 바로 한 번 쓴다 */
  activate(threadId: string, position: StreamPosition): void;
  /**
   * 연결에서 오간 메시지를 본다(EngineConnectOptions.observe와 같은 자리). events.batch를 보면 위치를 올리고 파일에 쓴다.
   * 쓰기는 알림이 그려지거나 JSON 줄로 나가기 전에 같은 JS 턴 안에서 끝나야 한다: 강제 종료 뒤 --continue가 이미 본
   * 이벤트를 다시 받지 않게 하는 조건이다(AC2).
   */
  observe(message: JsonRpcMessage): void;
  /** 쓰기에 실패한 적이 있는가. 상태 파일은 캐시라 실패해도 대화는 계속한다 */
  readonly writeFailed: boolean;
}

export function createPositionKeeper(options: {
  readonly path: string;
  readonly workspace: string;
  readonly initial: CliState;
  readonly now: () => number;
}): PositionKeeper {
  const keep: {
    state: CliState;
    threadId: string | null;
    storeId: StreamPosition["storeId"] | null;
    seq: number;
    failed: boolean;
  } = { state: options.initial, threadId: null, storeId: null, seq: 0, failed: false };

  const write = (): void => {
    if (keep.threadId === null || keep.storeId === null) return;
    keep.state = withEntry(
      keep.state,
      options.workspace,
      keep.threadId,
      { storeId: keep.storeId, seq: keep.seq },
      new Date(options.now()).toISOString(),
    );
    // 쓰기에 실패하면 failed 표시만 남기고 대화는 계속한다. 표시는 종료 때 사용자에게 알린다
    const written = attempt(() => writeCliStateSync(options.path, keep.state));
    if (!written.ok) keep.failed = true;
  };

  return {
    activate(threadId, position) {
      keep.threadId = threadId;
      keep.storeId = position.storeId;
      keep.seq = position.seq;
      write();
    },
    observe(message) {
      if (keep.threadId === null || !("method" in message) || message.method !== "events.batch") {
        return;
      }
      const { from, to } = message.params;
      if (typeof from !== "number" || typeof to !== "number") return;
      // 구멍이 있으면 올리지 않는다: 세션 구동기가 마지막 to부터 다시 구독한다
      if (from > keep.seq || to <= keep.seq) return;
      keep.seq = to;
      write();
    },
    get writeFailed() {
      return keep.failed;
    },
  };
}

// ── 보조 ─────────────────────────────────────────────────────────────────

export interface TurnEnd {
  readonly status: "completed" | "interrupted" | "failed";
  readonly error: string | null;
}

interface SentTurn {
  readonly turnId: string;
  /** turn.completed가 오고 그때까지의 그리기가 끝나면 이행한다 */
  readonly done: Promise<TurnEnd>;
}

/** turn.resume의 결과. 이어 실행을 접수했으면(resumed) 그 turn이 끝날 때 이행하는 done이 있다 */
type ResumedTurn =
  | {
      readonly result: Extract<TurnResumeResult, { status: "resumed" }>;
      readonly done: Promise<TurnEnd>;
    }
  | {
      readonly result: Exclude<TurnResumeResult, { status: "resumed" }>;
      readonly done: null;
    };

export interface ChatSessionOptions {
  readonly handle: EngineHandle;
  readonly workspace: string;
  /** null이면 그리지 않는다(JSON 모드는 RenderSink를 쓰지 않는다) */
  readonly sink: RenderSink | null;
  /** 터미널 폭. 도구 결과 렌더러에 넘긴다 */
  readonly width: number;
  /** 대화형: 저장 위치까지의 이전 기록을 user·assistant 텍스트로 접어 그린다(§4.4) */
  readonly collapseHistory: boolean;
  /**
   * 알림 전달(notify.delivered)을 그린다. 대화형만 켠다. print 모드는 turn 하나를 끝내고 끝나므로 완료 알림을 stderr에 또 쓰지 않는다
   * (성공한 실행의 stderr를 비운다) [결정: 오케스트레이터 기본값]. JSON 모드는 sink가 없어 어느 쪽이든 그리지 않는다
   */
  readonly deliveredNotices: boolean;
  readonly keeper: PositionKeeper;
  /** 승인 요청을 받는 곳. 대화형은 프롬프트, print 모드는 자동 거부다(§4.11 4번). null이면 보이기만 한다 */
  readonly approvals: ApprovalSink | null;
  /** 열 때 아직 답하지 않은 승인(approval.list)을 되살려 묻는다. 재시작 뒤 복원이다(대화형) */
  readonly restoreApprovals: boolean;
  /** 쓰기 소유를 얻지 못했을 때(thread.locked) 대안을 묻는다. null이면 묻지 않고 4로 끝낸다(print 모드) */
  readonly lockPrompt: LockPrompt | null;
  /** 출력이 막혔다(EPIPE 등) */
  readonly onOutputError: (caught: unknown) => void;
}

export interface ChatSession {
  readonly threadId: ThreadId;
  readonly turnActive: boolean;
  /** 관찰로 열렸다. 입력을 보낼 수 없다(§4.11 잠금) */
  readonly readOnly: boolean;
  /** turn.interrupt를 한 번 보낸다. 중단할 turn이 있었으면 참이다 */
  interrupt(): Promise<boolean>;
  /** 구독을 닫고 알림 처리를 멈춘다. 연결은 닫지 않는다(/resume이 다른 세션으로 바꿀 때) */
  close(): Promise<void>;
  sendTurn(input: string): Promise<SentTurn>;
  /** 끊긴 turn을 이어 실행한다(turn.resume, G1-02). 사용자가 확인한 뒤에만 부른다. 호스트는 자동 재개를 하지 않는다 */
  resumeTurn(): Promise<ResumedTurn>;
  /** 지금까지 도착한 알림의 처리가 끝나기를 기다린다 */
  idle(): Promise<void>;
  /** 열 때의 재전송(구독 위치부터 머리까지)을 모두 반영했을 때 이행한다. 대화형이 이전 기록을 다 그린 뒤 입력을 받게 한다 */
  caughtUp(): Promise<void>;
}

/** 구간을 collapseUntil에서 둘로 나눈다. 앞쪽은 접어 그리고 뒤쪽은 전체를 그린다 */
export function splitBatchAt(
  batch: EventsBatchParams,
  collapseUntil: number,
): readonly { readonly batch: EventsBatchParams; readonly collapsed: boolean }[] {
  if (collapseUntil <= batch.from) return [{ batch, collapsed: false }];
  if (batch.to <= collapseUntil) return [{ batch, collapsed: true }];
  return [
    {
      batch: {
        ...batch,
        to: collapseUntil,
        events: batch.events.filter((event) => event.seq <= collapseUntil),
      },
      collapsed: true,
    },
    {
      batch: {
        ...batch,
        from: collapseUntil,
        events: batch.events.filter((event) => event.seq > collapseUntil),
      },
      collapsed: false,
    },
  ];
}

/** 접힌 이전 기록: user·assistant 텍스트만 남긴다 */
export function collapseOps(ops: readonly RenderOp[]): readonly RenderOp[] {
  const kept: RenderOp[] = [];
  for (const op of ops) {
    if (op.kind === "user") kept.push(op);
    else if (op.kind === "assistant" && op.markdown.length > 0) {
      kept.push({ ...op, thinking: null });
    }
  }
  return kept;
}

function turnEndsOf(
  events: readonly EventWire[],
): readonly { readonly turnId: string; readonly end: TurnEnd }[] {
  const ends: { turnId: string; end: TurnEnd }[] = [];
  for (const event of events) {
    if (event.kind !== "turn.completed" || event.turnId === null) continue;
    const parsed = parse(TurnCompletedPayloadSchema, event.payload);
    if (!parsed.ok) continue;
    ends.push({
      turnId: event.turnId,
      end: { status: parsed.value.status, error: parsed.value.error },
    });
  }
  return ends;
}

function fail(message: string, fix: string, code: Failure["code"] = EXIT.error): Failure {
  return { message, fix, code };
}

/**
 * 상태 파일의 위치를 구독 위치로 바꾼다. 저장소가 바뀌었는지는 호스트가 replay.outOfRange(storeMismatch)로 알려 주므로
 * 저장된 storeId를 그대로 보낸다. storeId 형식이 깨졌으면 지금 저장소의 처음부터다
 */
function storedPosition(
  stored: { readonly storeId: string; readonly seq: number },
  fallbackStore: StreamPosition["storeId"],
): StreamPosition {
  const storeId = parse(StoreIdSchema, stored.storeId);
  return storeId.ok
    ? { storeId: storeId.value, seq: stored.seq }
    : { storeId: fallbackStore, seq: 0 };
}

interface Resolved {
  readonly threadId: ThreadId;
  /** 구독을 시작할 위치. 대화형은 이전 기록을 접어 그리려고 저장 위치가 아니라 seq 0이다(§4.4) */
  readonly from: StreamPosition;
  /** 상태 파일에 남아 있는 위치. 구독 위치가 더 이르더라도 파일의 위치는 뒤로 가지 않는다 */
  readonly saved: StreamPosition;
  /** 접기 경계. 이 seq까지가 이전 기록이다. 새 세션이면 0 */
  readonly collapseUntil: number | "head";
  /** 관찰로 열었다(thread.locked에서 observe를 골랐다) */
  readonly readOnly: boolean;
}

/** 호스트가 아직 구현하지 않은 메서드(-32601)면 참이다. M2 처리기가 모두 들어오기 전의 호스트와도 동작하게 한다 */
function isMethodNotFound(caught: unknown): boolean {
  return caught instanceof WireError && caught.data.kind === "jsonrpc.methodNotFound";
}

function isLockOption(value: unknown): value is LockOption {
  return value === "observe" || value === "fork" || value === "delegate";
}

function lockOptionsOf(error: WireError): readonly LockOption[] {
  const raw = error.data.details?.["options"];
  return Array.isArray(raw) ? raw.filter(isLockOption) : [];
}

/** 위임은 서비스 전송일 때만 보인다(adr.0006 §3.6 규칙 3, §4.11) */
function visibleLockOptions(
  options: readonly LockOption[],
  transport: EngineHandle["transport"],
): readonly LockOption[] {
  return options.filter((option) => option !== "delegate" || transport === "socket");
}

/** 상태 파일의 위치. 그 id의 항목이 없으면 지금 저장소의 처음이다 */
function savedPositionOf(
  state: CliState,
  threadId: string,
  fallbackStore: StreamPosition["storeId"],
): { readonly position: StreamPosition; readonly known: boolean } {
  const known = Object.values(state.workspaces).find((entry) => entry.threadId === threadId);
  return known === undefined
    ? { position: { storeId: fallbackStore, seq: 0 }, known: false }
    : { position: storedPosition(known.position, fallbackStore), known: true };
}

/**
 * thread.open으로 쓰기 소유를 얻는다(HS-23). 못 얻으면(thread.locked) 대안을 묻고 고른 대로 연다.
 * 호스트가 thread.open을 아직 구현하지 않았으면 소유는 turn.start가 암묵으로 얻는다(HS-28) [M1 호스트와의 호환].
 */
async function openForWrite(
  options: ChatSessionOptions,
  threadId: ThreadId,
): Promise<
  Result<
    { readonly threadId: ThreadId; readonly readOnly: boolean; readonly forkedAt: number | null },
    Failure
  >
> {
  const { handle } = options;
  const { connection } = handle;
  if (!handle.supports("thread.open")) {
    return ok({ threadId, readOnly: false, forkedAt: null });
  }
  const opened = await attemptAsync(() =>
    connection.request("thread.open", { threadId, mode: "write" }),
  );
  if (opened.ok) return ok({ threadId, readOnly: false, forkedAt: null });
  const caught = opened.error.cause;
  if (isMethodNotFound(caught)) return ok({ threadId, readOnly: false, forkedAt: null });
  if (!(caught instanceof WireError) || caught.data.kind !== "thread.locked") throw caught;
  const failure = failureOfWire(caught);
  const choices = visibleLockOptions(lockOptionsOf(caught), handle.transport);
  if (options.lockPrompt === null || choices.length === 0) return err(failure);
  const ownerKind = caught.data.details?.["ownerKind"];
  const choice = await options.lockPrompt(
    { ownerKind: typeof ownerKind === "string" ? ownerKind : "unknown", options: choices },
    new AbortController().signal,
  );
  switch (choice) {
    case "observe": {
      await connection.request("thread.open", { threadId, mode: "observe" });
      return ok({ threadId, readOnly: true, forkedAt: null });
    }
    case "fork": {
      const forked = await connection.request("thread.fork", { threadId });
      // 분기한 세션은 이 연결이 쓴다. 이미 쥐고 있으면 그대로 소유다
      await connection.request("thread.open", { threadId: forked.threadId, mode: "write" });
      return ok({ threadId: forked.threadId, readOnly: false, forkedAt: forked.position.seq });
    }
    case "delegate":
      // 위임 입력은 서비스 전송(M3)이 생기면 붙는다. 그 전에는 고를 수 없게 visibleLockOptions가 가린다
      return err(failure);
    case "cancel":
      return err(failure);
    default:
      return assertNever(choice, "LockChoice");
  }
}

async function resolveTarget(
  options: ChatSessionOptions,
  target: ChatTarget,
): Promise<Result<Resolved, Failure>> {
  const { handle } = options;
  if (target.kind === "new") {
    const created = await handle.connection.request("thread.create", {
      workspace: options.workspace,
    });
    return ok({
      threadId: created.threadId,
      from: created.position,
      saved: created.position,
      collapseUntil: 0,
      readOnly: false,
    });
  }
  const path = handle.paths.cliStateFile;
  const loaded = await readCliState(path);
  let wanted: ThreadId;
  if (target.kind === "continue") {
    const found = await lastThreadOf(options, loaded);
    if (!found.ok) return found;
    wanted = found.value;
  } else {
    wanted = target.threadId;
  }
  const opened = await openForWrite(options, wanted);
  if (!opened.ok) return opened;
  const { threadId, readOnly, forkedAt } = opened.value;
  const saved = savedPositionOf(loaded.state, threadId, handle.storeId);
  if (forkedAt !== null) {
    // 분기한 세션: 호스트가 정한 머리까지가 이전 기록이다
    const base = { storeId: handle.storeId, seq: 0 };
    return ok({
      threadId,
      from: base,
      saved: { ...base, seq: forkedAt },
      collapseUntil: forkedAt,
      readOnly,
    });
  }
  // print: 저장 위치부터. 대화형: 처음부터 받아 이전 대화를 접어 그린다
  const from = options.collapseHistory ? { ...saved.position, seq: 0 } : saved.position;
  return ok({
    threadId,
    from,
    saved: saved.position,
    collapseUntil: saved.known ? saved.position.seq : "head",
    readOnly,
  });
}

/**
 * --continue: 작업 폴더의 마지막 세션. M2 호스트는 thread.list가 정본이고, 아직 그 처리기가 없는 호스트에서는
 * CLI 상태 파일이 대신한다(§4.4).
 */
async function lastThreadOf(
  options: ChatSessionOptions,
  loaded: StateReadOutcome,
): Promise<Result<ThreadId, Failure>> {
  const { connection } = options.handle;
  const listed = await attemptAsync(() =>
    connection.request("thread.list", { workspace: options.workspace, limit: 1 }),
  );
  if (listed.ok) {
    const first = listed.value.threads[0];
    if (first === undefined) {
      return err(fail("이어 열 세션이 없다", "xeon chat으로 새 세션을 시작한다"));
    }
    return ok(first.threadId);
  }
  if (!isMethodNotFound(listed.error.cause)) throw listed.error.cause;
  const entry = entryFor(loaded.state, options.workspace);
  const threadId = entry === undefined ? undefined : parse(ThreadIdSchema, entry.threadId);
  if (entry === undefined || threadId === undefined || !threadId.ok) {
    return err(
      fail(
        loaded.kind === "discarded"
          ? `CLI 상태 파일을 읽지 못해 버렸다 (${loaded.reason}). 이어 열 세션이 없다`
          : "이어 열 세션이 없다",
        "xeon chat으로 새 세션을 시작한다",
      ),
    );
  }
  return ok(threadId.value);
}

/** 상태 파일을 읽는다. 없으면 빈 상태이고 깨진 파일은 버렸다는 결과로 돌려준다 */
export function loadInitialState(path: string): Promise<StateReadOutcome> {
  return readCliState(path);
}

/**
 * 세션을 연다: 대상 결정(§4.4) → 구독(§4.3 3번). 구독 알림은 열린 뒤 바로 처리를 시작한다.
 * turn.start는 sendTurn이 한다. 구독이 turn.start보다 먼저여야 이벤트를 놓치지 않는다.
 */
export async function openChatSession(
  options: ChatSessionOptions,
  target: ChatTarget,
): Promise<Result<ChatSession, Failure>> {
  const { handle, sink } = options;
  const { connection } = handle;
  const resolved = await resolveTarget(options, target);
  if (!resolved.ok) return resolved;
  const { threadId } = resolved.value;
  const fromStart = resolved.value.from;
  options.keeper.activate(threadId, resolved.value.saved);

  const live: {
    state: TranscriptState;
    activeSub: string | undefined;
    collapseUntil: number;
    inbox: EventsBatchParams[];
    chain: Promise<void>;
    broken: Error | undefined;
    outputBroken: boolean;
    turnActive: boolean;
    /** close()가 불렸다. 그 뒤 도착한 알림은 버린다 */
    closed: boolean;
    /** 열 때 구독 응답의 머리. 이 seq까지 반영하면 재전송이 끝난 것이다 */
    catchUpTo: number;
  } = {
    state: initialTranscript(null),
    activeSub: undefined,
    collapseUntil: 0,
    inbox: [],
    chain: Promise.resolve(),
    broken: undefined,
    outputBroken: false,
    turnActive: false,
    closed: false,
    catchUpTo: 0,
  };
  const replayDone = Promise.withResolvers<void>();
  const settleCaughtUp = (): void => {
    const position = live.state.position;
    if (position !== null && position.seq >= live.catchUpTo) replayDone.resolve();
  };
  const ends = new Map<string, TurnEnd>();
  const waiters = new Map<string, PromiseWithResolvers<TurnEnd>>();
  const collapsing = options.collapseHistory;

  const pipelineFailed = (caught: unknown): void => {
    if (live.broken !== undefined) return;
    const error = caught instanceof Error ? caught : new Bug(`pipeline failed: ${String(caught)}`);
    live.broken = error;
    for (const waiter of waiters.values()) waiter.reject(error);
    replayDone.resolve();
  };
  const enqueue = (work: () => Promise<void>): void => {
    live.chain = live.chain.then(work).catch(pipelineFailed);
  };

  const emit = async (ops: readonly RenderOp[]): Promise<void> => {
    if (sink === null || ops.length === 0 || live.outputBroken) return;
    try {
      await sink.write(ops);
    } catch (caught) {
      live.outputBroken = true;
      options.onOutputError(caught);
    }
  };

  /** 승인 요청은 기다리지 않고 넘긴다: 프롬프트가 열려 있는 동안에도 approval.resolved를 받아 닫아야 한다 */
  const routeApprovals = (ops: readonly RenderOp[]): void => {
    const sinkOfApprovals = options.approvals;
    if (sinkOfApprovals === null) return;
    for (const op of ops) {
      if (op.kind === "approval") sinkOfApprovals.offer(op.view);
      else if (op.kind === "approvalResolved") sinkOfApprovals.resolved(op.approvalId);
    }
  };

  const subscribeFrom = async (
    from: StreamPosition | "head",
  ): Promise<{ readonly result: EventsSubscribeResult; readonly fellBack: boolean }> => {
    try {
      const result = await connection.request("events.subscribe", {
        from,
        filter: { threadIds: [threadId] },
      });
      return { result, fellBack: false };
    } catch (caught) {
      if (caught instanceof WireError && caught.data.kind === "replay.outOfRange") {
        const reason = caught.data.details?.["reason"];
        await emit([
          {
            kind: "notice",
            text:
              reason === "storeMismatch"
                ? "저장소가 바뀌어 이전 기록을 이어 받지 못했다"
                : "저장된 위치부터 이어 받을 수 없어 지금부터 보인다",
          },
        ]);
        const result = await connection.request("events.subscribe", {
          from: "head",
          filter: { threadIds: [threadId] },
        });
        return { result, fellBack: true };
      }
      throw caught;
    }
  };

  /**
   * 구독을 연다. collapse는 접기 경계다: 숫자는 그 seq까지, "head"는 응답의 머리까지, "keep"은 지금 값을 그대로 둔다.
   * 알림 처리는 경계가 정해진 뒤에 시작한다(enqueue는 맨 끝).
   */
  const open = async (
    from: StreamPosition | "head",
    collapse: number | "head" | "keep",
  ): Promise<void> => {
    live.activeSub = undefined;
    const { result, fellBack } = await subscribeFrom(from);
    if (fellBack) live.collapseUntil = 0;
    else if (collapse === "head") live.collapseUntil = result.headSeq;
    else if (collapse !== "keep") live.collapseUntil = collapse;
    live.state = initialTranscript({ storeId: result.storeId, seq: result.start });
    live.activeSub = result.sub;
    live.catchUpTo = Math.max(live.catchUpTo, result.headSeq);
    settleCaughtUp();
    enqueue(drain);
  };

  const processPart = async (batch: EventsBatchParams, collapsed: boolean): Promise<boolean> => {
    const applied = applyBatch(live.state, batch, handle.storeId, { width: options.width });
    if (!applied.ok) return false;
    live.state = applied.value.state;
    await emit(collapsed ? collapseOps(applied.value.ops) : applied.value.ops);
    if (!collapsed) routeApprovals(applied.value.ops);
    for (const { turnId, end } of turnEndsOf(batch.events)) {
      ends.set(turnId, end);
      waiters.get(turnId)?.resolve(end);
    }
    settleCaughtUp();
    return true;
  };

  const processBatch = async (batch: EventsBatchParams): Promise<void> => {
    const parts = collapsing
      ? splitBatchAt(batch, live.collapseUntil)
      : [{ batch, collapsed: false }];
    const results: boolean[] = [];
    await sequentially(parts, async (part) => {
      if (results.some((contiguous) => !contiguous)) return;
      results.push(await processPart(part.batch, part.collapsed));
    });
    if (results.includes(false)) {
      // 구멍: 마지막으로 반영한 to부터 다시 구독한다(F wire §4.5)
      const position = live.state.position;
      await open(position ?? "head", "keep");
    }
  };

  const drain = async (): Promise<void> => {
    const sub = live.activeSub;
    if (sub === undefined) return;
    const index = live.inbox.findIndex((batch) => batch.sub === sub);
    // 지난 구독의 알림은 버린다
    live.inbox = live.inbox.filter((batch) => batch.sub === sub);
    const next = live.inbox.shift();
    if (index < 0 || next === undefined) return;
    await processBatch(next);
    await drain();
  };

  // 엔진 연결이 끊기면 기다리는 turn을 풀어 준다(§5 "서비스 소켓이 사라졌다"). 정상 종료의 닫힘도 지나가지만 기다리는 이가 없다
  connection.closed
    .then((info) => {
      pipelineFailed(new HostClientError("closed", "engine connection closed", info));
      return undefined;
    })
    .catch(pipelineFailed);

  const unsubscribes = [
    connection.onNotification("events.batch", (params) => {
      if (live.closed) return;
      live.inbox.push(params);
      enqueue(drain);
    }),
    connection.onNotification("stream.chunk", (params) => {
      if (live.closed) return;
      enqueue(async () => {
        // 확장 핸들러 실패는 진행 줄이 아니라 알림이다(HS-80). 진행 줄의 접기·순서 규칙과 섞지 않고 도착 순서대로 그린다
        if (params.event.kind === "scope.handler_failed") {
          await emit(handlerFailedOpsOf(params, threadId));
          return;
        }
        const applied = applyChunk(live.state, params);
        live.state = applied.state;
        await emit(applied.ops);
      });
    }),
    // 알림 전달(HS-82). host.hello의 features에 없는 호스트에서도 등록해 둔다: 오지 않으면 그릴 것이 없다
    connection.onNotification("notify.delivered", (params) => {
      if (live.closed || !options.deliveredNotices) return;
      enqueue(() => emit(deliveredOpsOf(params, threadId)));
    }),
  ];

  await open(fromStart, options.collapseHistory ? resolved.value.collapseUntil : 0);

  // 재시작 뒤 복원: 이전 기록을 다 그린 뒤, 아직 답하지 않은 승인을 다시 묻는다(approval.list). 이벤트로 이미 받은 승인은 sink가 걸러 준다
  const pendingSink = options.approvals;
  const restored = Promise.withResolvers<void>();
  if (options.restoreApprovals && pendingSink !== null && handle.supports("approval.list")) {
    const restore = async (): Promise<void> => {
      if (live.closed) return;
      const listed = await attemptAsync(() => connection.request("approval.list", { threadId }));
      if (listed.ok) {
        for (const pending of listed.value.approvals) {
          pendingSink.offer(approvalViewOf(pending.approvalId, pending.request));
        }
        return;
      }
      if (isMethodNotFound(listed.error.cause)) return;
      await emit([{ kind: "notice", text: "대기 중인 승인을 읽지 못했다" }]);
    };
    detach(
      replayDone.promise.then(restore).finally(() => {
        restored.resolve();
      }),
      pipelineFailed,
    );
  } else {
    restored.resolve();
  }
  // 접기 경계가 정해진 뒤 도착한 알림부터 그려진다. 여기서 한 번 비워 열기 직후의 재전송이 끝나기를 기다리지는 않는다
  /** turn 하나가 끝날 때까지 기다리는 약속. 끝난 turn이 이미 도착했으면 바로 이행한다 */
  const awaitTurnEnd = (turnId: string): Promise<TurnEnd> => {
    const known = ends.get(turnId);
    let done: Promise<TurnEnd>;
    if (known !== undefined) {
      done = Promise.resolve(known);
    } else if (live.broken !== undefined) {
      done = Promise.reject(live.broken);
    } else {
      const waiter = waiters.get(turnId) ?? Promise.withResolvers<TurnEnd>();
      waiters.set(turnId, waiter);
      done = waiter.promise;
    }
    return done.finally(() => {
      live.turnActive = false;
    });
  };
  const session: ChatSession = {
    threadId,
    readOnly: resolved.value.readOnly,
    get turnActive() {
      return live.turnActive;
    },
    async interrupt() {
      const result = await connection.request("turn.interrupt", { threadId });
      return result.interrupted;
    },
    async close() {
      if (live.closed) return;
      live.closed = true;
      for (const off of unsubscribes) off();
      const sub = live.activeSub;
      live.activeSub = undefined;
      if (sub === undefined || !handle.supports("events.unsubscribe")) return;
      // 구독 해제 실패는 닫는 쪽에 알릴 일이 아니다: 연결을 닫으면 구독도 끝난다
      await attemptAsync(() => connection.request("events.unsubscribe", { sub }));
    },
    async sendTurn(input) {
      live.turnActive = true;
      try {
        const requestId = handle.newRequestId();
        const started = await connection.request("turn.start", { threadId, input, requestId });
        return { turnId: started.turnId, done: awaitTurnEnd(started.turnId) };
      } catch (caught) {
        live.turnActive = false;
        throw caught;
      }
    },
    async resumeTurn() {
      live.turnActive = true;
      try {
        const result = await connection.request("turn.resume", { threadId });
        if (result.status === "resumed") {
          return { result, done: awaitTurnEnd(result.turnId) };
        }
        live.turnActive = false;
        return { result, done: null };
      } catch (caught) {
        live.turnActive = false;
        throw caught;
      }
    },
    async idle() {
      await live.chain;
      await options.approvals?.idle();
    },
    // 되살린 승인까지 sink에 넘긴 뒤에 이행한다: 입력을 받기 전에 승인을 먼저 묻는다
    caughtUp: () => replayDone.promise.then(() => restored.promise),
  };
  return ok(session);
}

import { Bug, rethrow, type Logger } from "@xeon/contracts";
import {
  isId,
  type EventId,
  type IdByPrefix,
  type IdPrefix,
  type ItemId,
  type ItemRecord,
  type PartId,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import type { ApprovalRequestedPayload } from "@xeon/contracts/records";
import type { StoreId, ThreadSummary } from "@xeon/contracts/wire";
import { createEngineStore, type EngineStore } from "../../src/state/engine/store.ts";
import type { DurableFact, VolatileFact } from "../../src/state/engine/input.ts";
import type { ApplyNote } from "../../src/state/engine/reduce.ts";
import { manualFrameClock } from "../../src/state/shared/frame.ts";
import { createJournal, type Journal } from "../../src/state/shared/journal.ts";

/** 검증을 통과하는 id를 만든다. as 없이 isId 타입 가드를 쓴다 */
function id<P extends IdPrefix>(prefix: P, n: number): IdByPrefix[P] {
  const value = `${prefix}_${"0".repeat(22)}${String(n).padStart(4, "0")}`;
  if (!isId(prefix, value)) throw new Bug(`bad test id ${value}`);
  return value;
}
export const thr = (n: number): ThreadId => id("thr", n);
export const trn = (n: number): TurnId => id("trn", n);
export const itm = (n: number): ItemId => id("itm", n);
export const prt = (n: number): PartId => id("prt", n);
export const evt = (n: number): EventId => id("evt", n);
export const STORE: StoreId = "sto_00000000000000000000000001";
export const SUB = "s1";

export const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

type LogLine = { readonly level: string; readonly msg: string; readonly fields: unknown };
function recordingLogger(): { readonly logger: Logger; readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const make = (): Logger => ({
    debug: (msg, fields) => void lines.push({ level: "debug", msg, fields }),
    info: (msg, fields) => void lines.push({ level: "info", msg, fields }),
    warn: (msg, fields) => void lines.push({ level: "warn", msg, fields }),
    error: (msg, fields) => void lines.push({ level: "error", msg, fields }),
    child: make,
  });
  return { logger: make(), lines };
}

export function userItem(n: number, text: string = "hi"): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content: text, timestamp: 0 },
    requestId: null,
  };
}

export function recorded(seq: number, item: ItemRecord, threadId: ThreadId = thr(1)): DurableFact {
  return {
    type: "item.recorded",
    seq,
    eventId: evt(seq),
    threadId,
    turnId: null,
    at: "2026-10-24T00:00:00.000Z",
    item,
  };
}

export function delta(
  n: number,
  text: string,
  itemN: number = 1,
  threadId: ThreadId = thr(1),
  turnId: TurnId | null = null,
  contentIndex: number = 0,
): VolatileFact {
  return {
    type: "item.updated",
    n,
    threadId,
    turnId,
    payload: {
      itemId: itm(itemN),
      update: {
        kind: "part_delta",
        delta: {
          partId: prt(itemN * 10 + contentIndex),
          itemId: itm(itemN),
          contentIndex,
          kind: "text",
          phase: "delta",
          delta: text,
        },
      },
    },
  };
}

export function summary(threadId: ThreadId, over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    threadId,
    title: null,
    status: "idle",
    workspace: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    headSeq: 0,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...over,
  };
}

export function approvalRequest(threadId: ThreadId): ApprovalRequestedPayload {
  return {
    origin: { threadId, turnId: null, stepId: null, toolCallId: null, caller: "test" },
    requestKey: "k1",
    title: "Run tool",
    remember: ["once"],
    surfaceThreadId: threadId,
    requestedAt: 0,
    body: {
      kind: "question",
      question: {
        questions: [{ id: "q", text: "ok?", options: [], multiSelect: false, allowFreeText: true }],
      },
    },
  };
}

export type Harness = {
  readonly store: EngineStore;
  readonly frames: ReturnType<typeof manualFrameClock>;
  readonly journal: Journal<ApplyNote>;
  readonly failures: unknown[];
  readonly logs: LogLine[];
};

export function harness(
  opts: {
    readonly capacity?: number;
    readonly checks?: boolean;
    readonly propagate?: boolean;
  } = {},
): Harness {
  const frames = manualFrameClock();
  const journal = createJournal<ApplyNote>(opts.capacity ?? 1000);
  const failures: unknown[] = [];
  const { logger, lines } = recordingLogger();
  let t = 0;
  const store = createEngineStore({
    clock: { now: () => (t += 1) },
    frames,
    logger,
    journal,
    checks: opts.checks ?? true,
    monotonic: () => 0,
    onReducerFailure: opts.propagate === true ? rethrow : (cause) => void failures.push(cause),
  });
  return { store, frames, journal, failures, logs: lines };
}

/** live 구독과 열린 thread를 만든 harness. 입력은 한 번에 커밋한다 */
export function openedHarness(start: number = 5, threadId: ThreadId = thr(1)): Harness {
  const h = harness();
  h.store.ingest({ type: "subscribed", sub: SUB, storeId: STORE, start, live: true, from: "head" });
  h.store.ingest({ type: "transcript_opening", threadId });
  h.store.ingest({ type: "transcript", threadId, asOfSeq: start, items: [] });
  h.store.flush();
  return h;
}

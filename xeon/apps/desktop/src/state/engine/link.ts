// src/state/engine/link.ts
import {
  attemptAsync,
  detach,
  eachAsync,
  repeatAsync,
  type Logger,
  type Result,
} from "@xeon/contracts";
import type { ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import {
  WireError,
  type EventsBatchParams,
  type HostConnection,
  type StreamPosition,
  type SubId,
  type ThreadSummary,
} from "@xeon/contracts/wire";
import { watch } from "../shared/watch.ts";
import { MAX_SYNC_ATTEMPTS } from "./reduce.ts";
import { decodeDurable, decodeVolatile } from "./decode.ts";
import type { EngineStore } from "./store.ts";

/** 열린 thread 스냅샷이 반영한 위치와 item 목록 */
export type TranscriptSnapshot = {
  readonly asOfSeq: number;
  readonly items: readonly ItemRecord[];
};

export type SnapshotError = { readonly kind: "unavailable" | "failed" | "timeout" };

/** 열린 thread를 읽는 포트. 메서드는 F가 정한다(L4.desktop.design 14절 1번, F 요청 thread.read) */
export interface TranscriptPort {
  load(threadId: ThreadId): Promise<Result<TranscriptSnapshot, SnapshotError>>;
}

export type LinkDeps = {
  readonly connection: HostConnection;
  readonly store: EngineStore;
  readonly transcripts: TranscriptPort;
  readonly logger: Logger;
  /** UI 스토어의 선택 thread. 재설정 뒤 다시 열 thread를 알려 준다 */
  readonly openThreadId: () => ThreadId | null;
};

/** thread.list 페이지 상한(200개씩). 넘으면 앞쪽 페이지만 보인다 */
const MAX_LIST_PAGES = 10;

export interface EngineLink {
  /** thread를 연다. 거울은 loading 동안의 item.recorded를 모았다가 스냅샷 뒤에 적용한다 */
  openThread(threadId: ThreadId): void;
  /** 열린 thread를 닫는다. 이전 thread의 item 캐시를 버린다(L4.desktop.spec 4.10 수단 6) */
  closeThread(): void;
  /** thread.list를 다시 읽는다. 목록 읽기에 실패했을 때 사용자가 고른다 */
  reloadThreads(): void;
  stop(): void;
}

/** 알림을 거울 입력으로 바꾸고, link 상태 변화에 따라 재구독과 다시 읽기를 실행한다 */
export function startLink(deps: LinkDeps): EngineLink {
  const report = (cause: unknown): void => {
    deps.logger.error("desktop.link.callback_failed", {
      error: cause instanceof Error ? cause.name : "unknown",
    });
  };
  // 구독 응답보다 먼저 처리된 그 구독의 batch. 응답의 continuation은 마이크로태스크라 알림 처리기보다 늦을 수 있다
  let inFlight = false;
  let held: EventsBatchParams[] = [];
  // 엔진은 연결당 구독 수를 제한한다(F.wire-settings.spec §3.4.3, 기본 16). 새 구독이 서면 이전 구독을 닫는다
  let current: SubId | null = null;
  let generation = 0;

  const unsubscribe = async (sub: SubId): Promise<void> => {
    const closed = await attemptAsync(() => deps.connection.request("events.unsubscribe", { sub }));
    if (!closed.ok) {
      deps.logger.warn("desktop.link.unsubscribe_failed", {
        error: closed.error.cause instanceof Error ? closed.error.cause.name : "unknown",
      });
    }
  };

  const ingestBatch = (p: EventsBatchParams): void => {
    deps.store.ingest({
      type: "batch",
      sub: p.sub,
      from: p.from,
      to: p.to,
      caughtUp: p.caughtUp,
      facts: p.events.map(decodeDurable),
    });
  };

  const subscribe = async (from: "cursor" | "head"): Promise<void> => {
    const cursor = deps.store.read.getState().cursor;
    const position: StreamPosition | "head" =
      from === "cursor" && cursor !== null ? cursor : "head";
    generation += 1;
    const mine = generation;
    inFlight = true;
    const result = await attemptAsync(() =>
      deps.connection.request("events.subscribe", { from: position }),
    );
    if (mine !== generation) {
      // 더 새 요청이 이미 나갔다. 이 응답의 구독은 쓰지 않고 닫는다
      if (result.ok) await unsubscribe(result.value.sub);
      return;
    }
    inFlight = false;
    const waiting = held;
    held = [];
    if (!result.ok) {
      const cause = result.error.cause;
      if (cause instanceof WireError && cause.data.kind === "replay.outOfRange") {
        deps.store.ingest({ type: "out_of_range" });
        return;
      }
      deps.logger.warn("desktop.link.subscribe_failed", {
        error: cause instanceof Error ? cause.name : "unknown",
      });
      deps.store.ingest({ type: "subscribe_failed" });
      return;
    }
    const r = result.value;
    const previous = current;
    current = r.sub;
    if (previous !== null) detach(unsubscribe(previous), report);
    deps.store.ingest({
      type: "subscribed",
      sub: r.sub,
      storeId: r.storeId,
      start: r.start,
      live: r.mode === "live",
      from: position === "head" ? "head" : "cursor",
    });
    for (const p of waiting) if (p.sub === r.sub) ingestBatch(p);
    if (position === "head") await reload(r.sub);
  };

  const loadTranscript = async (threadId: ThreadId): Promise<void> => {
    deps.store.ingest({ type: "transcript_opening", threadId });
    let round = 0;
    await repeatAsync<undefined>(async () => {
      round += 1;
      const loaded = await deps.transcripts.load(threadId);
      if (!loaded.ok) {
        deps.logger.warn("desktop.link.snapshot_failed", { reason: loaded.error.kind });
        deps.store.ingest({ type: "transcript_failed", threadId });
        return { value: undefined };
      }
      const snapshot = loaded.value;
      deps.store.ingest({ type: "transcript", threadId, ...snapshot });
      deps.store.flush();
      const t = deps.store.read.getState().transcript;
      // 거울이 stale로 거절하면 같은 thread가 loading으로 남는다. 다른 thread로 옮겼거나 ready면 끝낸다
      if (
        t === null ||
        t.threadId !== threadId ||
        t.status === "ready" ||
        round >= MAX_SYNC_ATTEMPTS
      ) {
        return { value: undefined };
      }
      deps.logger.warn("desktop.link.snapshot_stale", { round });
      return undefined;
    });
    // 오래된 스냅샷만 세 번 받았으면 loading이 남는다. 오류로 바꿔 사용자가 다시 읽게 한다
    deps.store.flush();
    const left = deps.store.read.getState().transcript;
    if (left !== null && left.status === "loading" && left.threadId === threadId) {
      deps.store.ingest({ type: "transcript_failed", threadId });
    }
  };

  /** thread.list의 모든 페이지를 읽은 뒤에 ready로 만든다(F.wire-settings.spec 3.4.6 6번) */
  const loadThreads = async (): Promise<void> => {
    const all: ThreadSummary[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const failed = await repeatAsync<boolean>(async () => {
      pages += 1;
      const listed = await attemptAsync(() =>
        deps.connection.request(
          "thread.list",
          cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        ),
      );
      if (!listed.ok) {
        deps.logger.warn("desktop.link.thread_list_failed", {
          error: listed.error.cause instanceof Error ? listed.error.cause.name : "unknown",
        });
        return { value: true };
      }
      all.push(...listed.value.threads);
      cursor = listed.value.nextCursor ?? undefined;
      return cursor === undefined || pages >= MAX_LIST_PAGES ? { value: false } : undefined;
    });
    deps.store.ingest(failed ? { type: "threads_failed" } : { type: "threads", threads: all });
  };

  /** 재설정 뒤 대기 승인 복원. 대기가 있는 thread에만 요청한다(3.4.6 5번). 실패하면 화면이 "목록을 불러오지 못함"을 보인다 */
  const loadApprovals = async (): Promise<void> => {
    // 목록 입력이 아직 큐에 있다. 커밋해야 거울에서 대기 수를 읽을 수 있다
    deps.store.flush();
    const state = deps.store.read.getState();
    const storeId = state.cursor?.storeId;
    const waiting = state.threads.ids.filter(
      (id) => (state.threads.byId[id]?.pendingApprovals ?? 0) > 0,
    );
    await eachAsync<ThreadId, undefined>(waiting, async (id) => {
      const listed = await attemptAsync(() =>
        deps.connection.request("approval.list", { threadId: id }),
      );
      if (!listed.ok || listed.value.position.storeId !== storeId) {
        deps.logger.warn("desktop.link.approval_list_failed", { thread: id });
        return undefined;
      }
      deps.store.ingest({ type: "approvals", approvals: listed.value.approvals });
      return undefined;
    });
  };

  const reload = async (sub: SubId): Promise<void> => {
    await loadThreads();
    await loadApprovals();
    const open = deps.openThreadId();
    deps.logger.debug("desktop.link.reloaded", { sub, transcript: open !== null });
    if (open !== null) await loadTranscript(open);
  };

  const offs = [
    deps.connection.onNotification("events.batch", (p) => {
      if (inFlight) held.push(p);
      else ingestBatch(p);
    }),
    deps.connection.onNotification("stream.chunk", (p) => {
      deps.store.ingest({ type: "chunk", fact: decodeVolatile(p.event) });
    }),
    deps.connection.onNotification("events.ended", (p) => {
      deps.store.ingest({ type: "ended", sub: p.sub });
    }),
    watch(
      deps.store.read,
      (s) => s.link,
      (link) => {
        if (link.phase === "resync") detach(subscribe("cursor"), report);
        else if (link.phase === "reset") detach(subscribe("head"), report);
      },
      report,
    ),
  ];
  // 같은 페이지에서 엔진만 다시 뜬 경우 거울의 cursor부터 잇는다. 새 페이지는 cursor가 없어 head부터 읽는다
  deps.store.ingest({ type: "connecting" });
  detach(subscribe("cursor"), report);
  return {
    openThread: (threadId) => detach(loadTranscript(threadId), report),
    closeThread: () => deps.store.ingest({ type: "transcript_closed" }),
    reloadThreads: () => detach(loadThreads(), report),
    stop: () => {
      for (const off of offs) off();
      if (current !== null) detach(unsubscribe(current), report);
      current = null;
    },
  };
}

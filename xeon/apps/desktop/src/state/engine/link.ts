// src/state/engine/link.ts
import {
  attemptAsync,
  detach,
  eachAsync,
  repeatAsync,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import type { ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import {
  WireError,
  type EventsBatchParams,
  type HostConnection,
  type StoreId,
  type StreamPosition,
  type SubId,
  type ThreadSummary,
} from "@fresnel/contracts/wire";
import { watch } from "../shared/watch.ts";
import { MAX_SYNC_ATTEMPTS } from "./reduce.ts";
import { decodeDurable, decodePendingApprovals, decodeVolatile } from "./decode.ts";
import type { DurableFact } from "./input.ts";
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

/** 연결 전 사건을 채우는 보조 구독이 거르는 종류: 계획(`work.plan_submitted`·`work.plan_withdrawn`)과 대기 입력(`input.queued`·`placed`·`withdrawn`) */
const BACKFILL_PREFIXES: string[] = ["work.plan_", "input."];

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
  // 연결 전에 생긴 계획과 대기 입력을 처음부터 다시 받는 보조 구독(`backfill`). 끝나면 닫는다. 같은 때에 하나만 있다
  let backfilling: { sub: SubId | null; facts: DurableFact[]; early: EventsBatchParams[] } | null =
    null;

  const unsubscribe = async (sub: SubId): Promise<void> => {
    const closed = await attemptAsync(() => deps.connection.request("events.unsubscribe", { sub }));
    if (!closed.ok) {
      deps.logger.warn("desktop.link.unsubscribe_failed", {
        error: closed.error.cause instanceof Error ? closed.error.cause.name : "unknown",
      });
    }
  };

  const ingestBatch = (p: EventsBatchParams): void => {
    const facts = p.events.map(decodeDurable);
    deps.store.ingest({
      type: "batch",
      sub: p.sub,
      from: p.from,
      to: p.to,
      caughtUp: p.caughtUp,
      facts,
    });
    // 대화 시작 사실에는 위임으로 만든 자식인지가 없다. 새 대화가 생기면 첫 쪽 목록에서 표지만 가져온다(rtE R-3)
    if (facts.some((fact) => fact.type === "thread.started")) detach(loadSpawnedMarks(), report);
  };

  /** 첫 쪽(최근 활동 먼저) 목록의 `spawnedBy`만 거울에 붙인다. 읽지 못하면 표지 없이 둔다 */
  const loadSpawnedMarks = async (): Promise<void> => {
    const listed = await attemptAsync(() => deps.connection.request("thread.list", { limit: 50 }));
    if (!listed.ok) {
      deps.logger.warn("desktop.link.spawned_marks_failed", {
        error: listed.error.cause instanceof Error ? listed.error.cause.name : "unknown",
      });
      return;
    }
    const marks = listed.value.threads.flatMap((thread) =>
      thread.spawnedBy === undefined
        ? []
        : [{ threadId: thread.threadId, spawnedBy: thread.spawnedBy }],
    );
    if (marks.length > 0) deps.store.ingest({ type: "spawned", marks });
  };

  const finishBackfill = (sub: SubId, storeId: StoreId, facts: readonly DurableFact[]): void => {
    backfilling = null;
    deps.store.ingest({ type: "backfill", storeId, facts });
    detach(unsubscribe(sub), report);
  };

  /**
   * head부터 맞춘 뒤에 연결 전의 계획과 대기 입력을 채운다. 거울은 head 뒤의 사건만 받으므로 앞선 `work.plan_*`와 `input.*`는 처음부터 다시
   * 읽어야 한다. 이 두 종류만 거른 구독을 0부터 열어 따라잡히면 거울에 넣고 닫는다. 재생 한도를 넘으면(`replay.outOfRange`) 채우지 않는다.
   * 기다리지 않는다: 끝나지 않아도 화면은 head부터의 사건으로 계속 맞는다
   */
  const backfill = async (storeId: StoreId): Promise<void> => {
    const mine: { sub: SubId | null; facts: DurableFact[]; early: EventsBatchParams[] } = {
      sub: null,
      facts: [],
      early: [],
    };
    backfilling = mine;
    const result = await attemptAsync(() =>
      deps.connection.request("events.subscribe", {
        from: { storeId, seq: 0 },
        filter: { kindPrefixes: BACKFILL_PREFIXES },
      }),
    );
    if (backfilling !== mine) {
      if (result.ok) await unsubscribe(result.value.sub);
      return;
    }
    if (!result.ok) {
      backfilling = null;
      deps.logger.warn("desktop.link.backfill_failed", {
        error: result.error.cause instanceof Error ? result.error.cause.name : "unknown",
      });
      return;
    }
    mine.sub = result.value.sub;
    let done = false;
    for (const p of mine.early) {
      if (p.sub !== mine.sub) continue;
      mine.facts.push(...p.events.map(decodeDurable));
      if (p.caughtUp) done = true;
    }
    mine.early = [];
    if (done) finishBackfill(result.value.sub, storeId, mine.facts);
  };

  const subscribe = async (from: "cursor" | "head"): Promise<void> => {
    const cursor = deps.store.read.getState().cursor;
    const position: StreamPosition | "head" =
      from === "cursor" && cursor !== null ? cursor : "head";
    generation += 1;
    const mine = generation;
    // 보조 구독은 새 구독이 서면 버린다(위치가 바뀌었다)
    if (backfilling !== null) {
      const stale = backfilling;
      backfilling = null;
      if (stale.sub !== null) detach(unsubscribe(stale.sub), report);
    }
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
    if (position === "head") {
      detach(backfill(r.storeId), report);
      await reload(r.sub);
    }
  };

  /**
   * 상태줄 칸 스냅숏(B-09). 열 때와 처음부터 다시 맞춘 뒤에 읽는다. 요청하는 동안 `dialog.status` 이벤트가 왔으면 그쪽이 더 새 것이라
   * 스냅숏은 버린다. 실패하면 칸이 없는 채로 둔다(상태줄은 나머지 칸으로 돌아간다)
   */
  const statusEvents = new Map<ThreadId, number>();
  const loadStatus = async (threadId: ThreadId): Promise<void> => {
    const before = statusEvents.get(threadId) ?? 0;
    const listed = await attemptAsync(() => deps.connection.request("status.list", { threadId }));
    if (!listed.ok) {
      deps.logger.warn("desktop.link.status_list_failed", { thread: threadId });
      return;
    }
    if ((statusEvents.get(threadId) ?? 0) !== before) return;
    deps.store.ingest({ type: "status", threadId, items: listed.value.items });
  };

  /**
   * 가장 나중에 시작한 읽기만 결과를 거울에 넣는다. 같은 thread를 두 번 열면(재설정 뒤 다시 읽기와 화면이 여는 읽기) 앞 읽기가
   * 뒤 읽기의 `loading`을 오류로 바꾸거나 낡은 스냅샷으로 되돌리지 못하게 한다.
   */
  let transcriptRun = 0;
  const loadTranscript = async (threadId: ThreadId): Promise<void> => {
    transcriptRun += 1;
    const mine = transcriptRun;
    deps.store.ingest({ type: "transcript_opening", threadId });
    let round = 0;
    const failures: SnapshotError["kind"][] = [];
    await repeatAsync<undefined>(async () => {
      round += 1;
      const loaded = await deps.transcripts.load(threadId);
      if (mine !== transcriptRun) return { value: undefined };
      if (!loaded.ok) {
        failures.push(loaded.error.kind);
        deps.logger.warn("desktop.link.snapshot_failed", { reason: loaded.error.kind, round });
        // 엔진이 막 떴거나 저장소가 바뀐 중(unavailable)이나 시간 초과는 일시적일 수 있어 한도 안에서 다시 읽는다. 요청 자체의 실패(failed)는 이유를 보인다
        if (loaded.error.kind !== "failed" && round < MAX_SYNC_ATTEMPTS) return undefined;
        deps.store.ingest({ type: "transcript_failed", threadId, reason: loaded.error.kind });
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
        t.status !== "loading" ||
        round >= MAX_SYNC_ATTEMPTS
      ) {
        return { value: undefined };
      }
      deps.logger.warn("desktop.link.snapshot_stale", {
        round,
        asOfSeq: snapshot.asOfSeq,
        sinceSeq: t.sinceSeq,
        cursorSeq: deps.store.read.getState().cursor?.seq ?? -1,
      });
      return undefined;
    });
    if (mine !== transcriptRun) return;
    // 오래된 스냅샷만 세 번 받았으면 loading이 남는다. 오류로 바꿔 사용자가 다시 읽게 한다
    deps.store.flush();
    const left = deps.store.read.getState().transcript;
    if (left !== null && left.status === "loading" && left.threadId === threadId) {
      deps.store.ingest({
        type: "transcript_failed",
        threadId,
        reason: failures.at(-1) ?? "stale",
      });
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
      deps.store.ingest({ type: "approvals", approvals: decodePendingApprovals(listed.value) });
      return undefined;
    });
  };

  const reload = async (sub: SubId): Promise<void> => {
    await loadThreads();
    await loadApprovals();
    const open = deps.openThreadId();
    deps.logger.debug("desktop.link.reloaded", { sub, transcript: open !== null });
    if (open !== null) {
      await loadTranscript(open);
      await loadStatus(open);
    }
  };

  const offs = [
    deps.connection.onNotification("events.batch", (p) => {
      const pending = backfilling;
      if (pending !== null && p.sub !== current) {
        // 보조 구독의 사건이다(응답보다 먼저 올 수도 있다). 거울의 위치와 이어지지 않으므로 따로 모은다
        if (pending.sub === null) {
          pending.early.push(p);
          return;
        }
        if (p.sub === pending.sub) {
          pending.facts.push(...p.events.map(decodeDurable));
          const cursor = deps.store.read.getState().cursor;
          if (p.caughtUp && cursor !== null)
            finishBackfill(pending.sub, cursor.storeId, pending.facts);
          return;
        }
      }
      if (inFlight) held.push(p);
      else ingestBatch(p);
    }),
    deps.connection.onNotification("stream.chunk", (p) => {
      const fact = decodeVolatile(p.event);
      if (fact.type === "dialog.status") {
        statusEvents.set(fact.payload.threadId, (statusEvents.get(fact.payload.threadId) ?? 0) + 1);
      }
      deps.store.ingest({ type: "chunk", fact });
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
    openThread: (threadId) => {
      detach(loadTranscript(threadId), report);
      detach(loadStatus(threadId), report);
    },
    closeThread: () => deps.store.ingest({ type: "transcript_closed" }),
    reloadThreads: () => detach(loadThreads(), report),
    stop: () => {
      for (const off of offs) off();
      if (current !== null) detach(unsubscribe(current), report);
      current = null;
    },
  };
}

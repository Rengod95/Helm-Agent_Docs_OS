import { detach, err, ok, type Result } from "@xeon/contracts";
import {
  toEventWire,
  toVolatileEventWire,
  wireError,
  type EventFilter,
  type WireHandler,
} from "@xeon/contracts/wire";
import type { DurableEventEnvelope, ReadFailure } from "@xeon/contracts/records";
import type { ConnectionHub, ConnectionState, Subscription } from "../connection-types.ts";
import { wireErrorOfStore } from "../store-error.ts";
import type { CommitBatch, Engine } from "../types.ts";
import { createObservePoller } from "./observe.ts";
import { messageOf, toRecord } from "../util.ts";

// L4.host-service.spec §4.4~§4.5, F.wire-settings.spec §3.4.3. 구독과 재전송, 실시간 전달, 휘발 스트림.
// 한 구독의 상태: starting(응답 전) → replaying(재전송 중) → live. 앞의 둘은 커밋을 pending에 쌓았다가
// 재전송이 끝나는 같은 JS 턴에서 커밋 순서대로 비운다(HS-11). 그래서 이벤트가 정확히 한 번 간다.

/** F.wire §3.4.3 필터와 L1.persistence의 피드 필터가 같은 규칙이다(빈 kindPrefixes는 아무것도 통과시키지 않는다) */
export function matchesFilter(
  event: Pick<DurableEventEnvelope, "kind" | "threadId">,
  filter: EventFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.threadIds !== undefined && !filter.threadIds.includes(event.threadId)) return false;
  const { kindPrefixes, excludeKindPrefixes } = filter;
  if (kindPrefixes !== undefined && !kindPrefixes.some((prefix) => event.kind.startsWith(prefix))) {
    return false;
  }
  if (excludeKindPrefixes?.some((prefix) => event.kind.startsWith(prefix)) === true) return false;
  return true;
}

/**
 * 스키마가 잡지 못하는 모순만 본다(events.filterInvalid): 포함과 제외에 같은 접두가 있으면 아무 이벤트도 통과하지 못한다.
 * 이 의미 검사는 F가 정하지 않아 가장 좁게 해석했다.
 */
function filterIssue(filter: EventFilter | undefined): unknown {
  const include = filter?.kindPrefixes;
  const exclude = filter?.excludeKindPrefixes;
  if (include === undefined || exclude === undefined) return undefined;
  const clash = include.find((prefix) => exclude.includes(prefix));
  if (clash === undefined) return undefined;
  return {
    path: "/filter/excludeKindPrefixes",
    message: `prefix "${clash}" is both included and excluded`,
  };
}

function sendBatch(
  conn: ConnectionState,
  sub: Subscription,
  from: number,
  to: number,
  events: readonly DurableEventEnvelope[],
  caughtUp: boolean,
): void {
  conn.sender.push({
    jsonrpc: "2.0",
    method: "events.batch",
    params: toRecord({
      sub: sub.id,
      from,
      to,
      events: events.map((event) => toEventWire(event)),
      caughtUp,
    }),
  });
}

/** 읽은 한 쪽이 책임지는 마지막 seq. 쪽이 가득 찼으면 마지막 이벤트까지, 아니면 훑은 곳까지다. 읽기가 앞으로 가지 않는 비정상은 upto로 막는다 */
function pageEnd(
  read: { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number },
  limit: number,
  after: number,
  upto: number,
): number {
  const lastEvent = read.events[read.events.length - 1];
  const to =
    read.events.length >= limit && lastEvent !== undefined ? lastEvent.seq : read.scannedTo;
  return to <= after || to > upto ? upto : to;
}

/**
 * 다른 프로세스가 커밋한 구간을 메운다. 이 프로세스의 커밋 알림은 자기 커밋만 싣고 batch의 (firstSeq - 1)까지 사이에
 * 다른 프로세스의 이벤트가 끼어 있을 수 있다. 구독이 책임진 위치에서 upto까지 읽어 먼저 보낸다(HS-16).
 * 읽기가 실패하면 구독을 닫고 거짓을 돌려준다. 동기로 끝난다.
 */
function fillGap(engine: Engine, conn: ConnectionState, sub: Subscription, upto: number): boolean {
  while (sub.pos < upto) {
    const limit = conn.limits.replayBatchMaxEvents;
    const page = engine.ports.feed.read(sub.pos, upto, sub.filter, limit, conn.limits.scanLimit);
    if (!page.ok) {
      endReplayFailed(engine, conn, sub, `gap read failed: ${page.error.kind}`);
      return false;
    }
    const to = pageEnd(page.value, limit, sub.pos, upto);
    sendBatch(
      conn,
      sub,
      sub.pos,
      to,
      page.value.events.filter((event) => event.seq <= to),
      false,
    );
    sub.pos = to;
  }
  return true;
}

/** pending 커밋을 커밋 순서대로 내보낸다. 마지막 알림만 caughtUp이다. 같은 JS 턴 안에서 끝난다 */
function flushPending(
  engine: Engine,
  conn: ConnectionState,
  sub: Subscription,
  batches: readonly CommitBatch[],
): void {
  const effective = batches.filter((batch) => batch.lastSeq > sub.pos);
  for (const [index, batch] of effective.entries()) {
    if (batch.firstSeq > sub.pos + 1 && !fillGap(engine, conn, sub, batch.firstSeq - 1)) return;
    const matching = batch.events.filter(
      (event) => event.seq > sub.pos && matchesFilter(event, sub.filter),
    );
    sendBatch(conn, sub, sub.pos, batch.lastSeq, matching, index === effective.length - 1);
    sub.pos = batch.lastSeq;
  }
}

/** 구독이 아직 열려 있는가. 대기(await)를 건너면 바뀔 수 있어 속성 접근을 함수로 감싼다 */
function isOpen(sub: Subscription): boolean {
  return sub.open;
}

/**
 * 재전송을 한 묶음씩 진행한다(HS-12). 묶음 사이에 송신 큐가 비기를 기다리고, 그동안의 커밋은 pending으로 간다.
 * 약속 사슬 길이는 묶음 수(최대 maxReplayEvents / 500)로 제한된다.
 */
async function replayStep(
  engine: Engine,
  conn: ConnectionState,
  sub: Subscription,
  upto: number,
): Promise<Result<void, ReadFailure>> {
  if (!isOpen(sub)) return ok(undefined);
  if (sub.pos >= upto) {
    // 재전송할 것이 없다(또는 끝났다). 응답 전에 쌓인 커밋을 비우고 실시간으로 넘어간다
    flushPending(engine, conn, sub, sub.pending.splice(0));
    sub.state = "live";
    return ok(undefined);
  }
  const waited = await conn.sender.waitBelowLowWater();
  if (waited !== "ready" || !isOpen(sub)) return ok(undefined);
  const limit = conn.limits.replayBatchMaxEvents;
  const page = engine.ports.feed.read(sub.pos, upto, sub.filter, limit, conn.limits.scanLimit);
  if (!page.ok) return err(page.error);
  const read = page.value;
  // 읽기가 앞으로 가지 않는 비정상을 막는다: 진행이 보장되어야 재전송이 끝난다
  const to = pageEnd(read, limit, sub.pos, upto);
  const events = read.events.filter((event) => event.seq <= to);
  if (to >= upto) {
    // 마지막 묶음과 pending 비우기를 한 번에 한다: 여기까지 await가 없으므로 중간 커밋이 끼지 않는다
    const rest = sub.pending.splice(0);
    sendBatch(conn, sub, sub.pos, to, events, rest.length === 0);
    sub.pos = to;
    flushPending(engine, conn, sub, rest);
    sub.state = "live";
    return ok(undefined);
  }
  sendBatch(conn, sub, sub.pos, to, events, false);
  sub.pos = to;
  return await replayStep(engine, conn, sub, upto);
}

function driveReplay(
  engine: Engine,
  conn: ConnectionState,
  sub: Subscription,
  upto: number,
): Promise<Result<void, ReadFailure>> {
  sub.state = "replaying";
  return replayStep(engine, conn, sub, upto);
}

/** 재전송이 끝까지 가지 못했다. 구독을 닫고 클라이언트가 끝없이 기다리지 않도록 끝났음을 알린다 */
function endReplayFailed(
  engine: Engine,
  conn: ConnectionState,
  sub: Subscription,
  message: string,
): void {
  engine.ports.log.error("events.replay_failed", { connectionId: conn.id, sub: sub.id, message });
  conn.subs.delete(sub.id);
  sub.open = false;
  conn.sender.push({
    jsonrpc: "2.0",
    method: "events.ended",
    params: toRecord({ sub: sub.id, reason: "replayFailed" }),
  });
}

export function createEventsSubscribeHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"events.subscribe"> {
  const { feed } = engine.ports;
  return async (params, context) => {
    const conn = hub().state(context.connectionId);
    if (conn === undefined) throw wireError("request.cancelled");
    const issue = filterIssue(params.filter);
    if (issue !== undefined) throw wireError("events.filterInvalid", { details: { issue } });
    const max = conn.limits.maxSubscriptionsPerConnection;
    if (conn.subs.size >= max) {
      throw wireError("events.subscriptionLimit", { details: { max } });
    }

    // F wire §3.4.3 3단계: head 읽기와 구독 등록은 같은 JS 턴에서, awaits 없이 한다(HS-10)
    const headRead = feed.headSeq();
    if (!headRead.ok) throw wireErrorOfStore(headRead.error, "events.subscribe head");
    const head = headRead.value;
    const from = params.from;
    let start = head;
    if (from !== "head") {
      const oldest = feed.oldestReplayableSeq();
      const outOfRange = (reason: "storeMismatch" | "aheadOfHead" | "beforeOldest" | "tooFar") =>
        wireError("replay.outOfRange", {
          details: {
            reason,
            storeId: engine.storeId,
            headSeq: head,
            oldestReplayableSeq: oldest,
          },
        });
      if (from.storeId !== engine.storeId) throw outOfRange("storeMismatch");
      if (from.seq > head) throw outOfRange("aheadOfHead");
      if (from.seq < oldest) throw outOfRange("beforeOldest");
      if (head - from.seq > conn.limits.maxReplayEvents) throw outOfRange("tooFar");
      start = from.seq;
    }
    const sub: Subscription = {
      id: conn.nextSubId(),
      filter: params.filter,
      pos: start,
      state: "starting",
      pending: [],
      emptyTickScheduled: false,
      seenTo: start,
      open: true,
    };
    conn.subs.set(sub.id, sub);
    conn.afterResponse(context.rpcId, () => {
      detach(
        driveReplay(engine, conn, sub, head).then((replayed) => {
          if (!replayed.ok) {
            endReplayFailed(engine, conn, sub, `read failed: ${replayed.error.kind}`);
          }
          return replayed;
        }),
        (caught) => {
          endReplayFailed(engine, conn, sub, messageOf(caught));
        },
      );
    });

    // 응답이 나가기 전의 취소 창: 송신 큐가 가득 차 있으면 거기서 기다리고, 그동안 $/cancelRequest가 오면 구독을 되돌린다
    const waited = await conn.sender.waitBelowLowWater(context.signal);
    if (waited !== "ready") {
      sub.open = false;
      conn.subs.delete(sub.id);
      throw wireError("request.cancelled");
    }
    return {
      sub: sub.id,
      start,
      headSeq: head,
      storeId: engine.storeId,
      mode: start < head ? "replaying" : "live",
    };
  };
}

/**
 * 커밋 하나를 구독 하나에 전한다. 이 프로세스의 커밋 알림과 관찰 폴링(observe.ts)이 같은 경로를 쓴다.
 * batch가 구독이 책임진 위치보다 앞서 시작하면 사이의 구간은 다른 프로세스의 커밋이므로 먼저 메운다(HS-16).
 */
export function deliverCommit(
  engine: Engine,
  conn: ConnectionState,
  sub: Subscription,
  batch: CommitBatch,
): void {
  if (!sub.open) return;
  if (sub.state !== "live") {
    sub.pending.push(batch);
    return;
  }
  if (batch.lastSeq <= sub.pos) return;
  if (batch.firstSeq > Math.max(sub.pos, sub.seenTo) + 1) {
    if (!fillGap(engine, conn, sub, batch.firstSeq - 1)) return;
  }
  const matching = batch.events.filter(
    (event) => event.seq > sub.pos && matchesFilter(event, sub.filter),
  );
  if (matching.length > 0) {
    sendBatch(conn, sub, sub.pos, batch.lastSeq, matching, true);
    sub.pos = batch.lastSeq;
    sub.seenTo = Math.max(sub.seenTo, batch.lastSeq);
    return;
  }
  // HS-14: 맞는 이벤트가 없는 커밋은 같은 JS 턴에 보내지 않고 모아 빈 알림 하나로 위치를 넘긴다
  sub.seenTo = Math.max(sub.seenTo, batch.lastSeq);
  if (sub.emptyTickScheduled) return;
  sub.emptyTickScheduled = true;
  queueMicrotask(() => {
    sub.emptyTickScheduled = false;
    if (!sub.open || sub.state !== "live" || sub.seenTo <= sub.pos) return;
    sendBatch(conn, sub, sub.pos, sub.seenTo, [], true);
    sub.pos = sub.seenTo;
  });
}

/**
 * 엔진의 커밋 알림과 휘발 이벤트를 연결에 나눈다. 커밋 알림은 커밋 직후 같은 JS 턴에서 동기로 오므로(TX-09)
 * 여기서는 쓰기를 하지 않고 송신 큐에 넣기만 한다. 휘발 이벤트는 그 thread를 연 연결에만 보내고,
 * 송신 큐가 저수위를 넘으면 버린다(HS-17, HS-19). n과 afterSeq는 발신자(core-loop)가 채운 값을 그대로 쓴다.
 * 다른 프로세스가 쥔 thread를 관찰하는 연결이 있으면 폴링이 그 프로세스의 커밋을 같은 경로로 전한다(HS-16).
 */
export interface EventFanout {
  /** 관찰 중인 thread가 생겼으면 폴링을 시작한다(HS-16) */
  watchObserved(): void;
  stop(): void;
}

export function startEventFanout(engine: Engine, hub: ConnectionHub): EventFanout {
  const { feed } = engine.ports;
  const deliver = (batch: CommitBatch): void => {
    for (const conn of hub.connections()) {
      for (const sub of Array.from(conn.subs.values())) deliverCommit(engine, conn, sub, batch);
    }
  };
  const poller = createObservePoller(engine, hub, deliver);
  const offCommit = feed.onCommit((batch) => {
    poller.committed(batch.lastSeq);
    deliver(batch);
  });
  const offVolatile = feed.onVolatile((event) => {
    for (const conn of hub.connections()) {
      if (!conn.openThreads.has(event.threadId)) continue;
      if (conn.sender.bytes >= conn.limits.sendLowWaterBytes) continue;
      conn.sender.push({
        jsonrpc: "2.0",
        method: "stream.chunk",
        params: { event: toVolatileEventWire(event) },
      });
    }
  });
  return {
    watchObserved: () => {
      poller.refresh();
    },
    stop() {
      offCommit();
      offVolatile();
      poller.dispose();
    },
  };
}

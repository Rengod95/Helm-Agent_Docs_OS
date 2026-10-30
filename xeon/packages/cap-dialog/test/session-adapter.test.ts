import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@xeon/contracts";
import {
  DIALOG_EVENT_CATALOG,
  VolatileEventEnvelopeSchema,
  type CommitRequest,
  type CommitResult,
  type DurableEventEnvelope,
  type ProducerHandle,
  type SessionService,
  type VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { sessionFeed, sessionNoticePort, sessionStatusPublisher } from "../src/session-adapter.ts";
import { newThread, recordingLogger, type LogLine } from "./support/harness.ts";

// dialog.status는 SessionService.emitVolatile로만 나간다: commit 경로를 지나지 않으므로 events 행이 늘지 않는다(L2.dialog.spec §9-4).

function fakeSession(head: number | "fail") {
  const emitted: VolatileEventEnvelope[] = [];
  let commits = 0;
  const session: Pick<SessionService, "feed" | "emitVolatile" | "subscribe" | "commit"> = {
    feed: {
      headSeq: () => (head === "fail" ? err({ kind: "busy" }) : ok(head)),
      oldestReplayableSeq: () => 0,
      read: () => ok({ events: [], scannedTo: 0 }),
      onCommit: () => () => undefined,
      onVolatile: () => () => undefined,
    },
    emitVolatile: (event) => {
      emitted.push(event);
    },
    subscribe: () => ok(() => undefined),
    commit: () => {
      commits += 1;
      return err({ kind: "busy" });
    },
  };
  return { session, emitted, commits: () => commits };
}

describe("상태 이벤트 휘발성", () => {
  test("휘발 봉투로 나가고 커밋 경로를 지나지 않는다", () => {
    const { session, emitted, commits } = fakeSession(41);
    const lines: LogLine[] = [];
    const publisher = sessionStatusPublisher(
      session,
      fixedIdFactory(),
      { clock: { now: () => 1234 } },
      recordingLogger(lines),
    );
    const thread = newThread();
    publisher.publish(thread, [{ id: "core.turn", text: "대기" }]);
    publisher.publish(thread, []);
    expect(commits()).toBe(0);
    expect(emitted).toHaveLength(2);
    for (const envelope of emitted)
      expect(parse(VolatileEventEnvelopeSchema, envelope).ok).toBe(true);
    expect(emitted[0]).toMatchObject({
      kind: "dialog.status",
      durable: false,
      threadId: thread,
      afterSeq: 41,
      n: 0,
      recordedAt: 1234,
      payload: { threadId: thread, items: [{ id: "core.turn", text: "대기" }] },
    });
    expect(emitted[1]?.n).toBe(1);
    const entry = DIALOG_EVENT_CATALOG.find((candidate) => candidate.kind === "dialog.status");
    expect(entry?.durable).toBe(false);
  });

  test("머리 seq를 읽지 못하면 이 이벤트는 건너뛰고 로그를 남긴다", () => {
    const { session, emitted } = fakeSession("fail");
    const lines: LogLine[] = [];
    const publisher = sessionStatusPublisher(
      session,
      fixedIdFactory(),
      { clock: { now: () => 1 } },
      recordingLogger(lines),
    );
    publisher.publish(newThread(), []);
    expect(emitted).toHaveLength(0);
    expect(lines.map((line) => line.event)).toEqual(["dialog.status_dropped"]);
  });
});

describe("내구 이벤트 피드", () => {
  test("구독은 turn.과 approval. 접두만 걸고 현재 머리부터 받는다", () => {
    const calls: { afterSeq: number; kindPrefixes: readonly string[] | undefined }[] = [];
    const session: Pick<SessionService, "feed" | "subscribe"> = {
      feed: fakeSession(7).session.feed,
      subscribe: (afterSeq, _listener, filter) => {
        calls.push({ afterSeq, kindPrefixes: filter?.kindPrefixes });
        return ok(() => undefined);
      },
    };
    const feed = sessionFeed(session, recordingLogger([]));
    feed.subscribe(() => undefined);
    expect(calls).toEqual([
      {
        afterSeq: 7,
        kindPrefixes: ["turn.", "approval.", "work.", "agent.", "schedule.", "dialog."],
      },
    ]);
  });

  test("머리를 읽지 못하면 구독하지 않고 로그를 남긴다", () => {
    const lines: LogLine[] = [];
    const session: Pick<SessionService, "feed" | "subscribe"> = {
      feed: fakeSession("fail").session.feed,
      subscribe: () => ok(() => undefined),
    };
    const unsubscribe = sessionFeed(session, recordingLogger(lines)).subscribe(() => undefined);
    unsubscribe();
    expect(lines.map((line) => line.event)).toEqual(["dialog.feed_unavailable"]);
  });
});

describe("알림 저장소 어댑터", () => {
  const notified: DurableEventEnvelope = {
    id: fixedIdFactory(300).next("evt"),
    kind: "dialog.notified",
    version: 1,
    threadId: newThread(),
    turnId: null,
    stepId: null,
    recordedAt: 1,
    causationId: null,
    correlationId: null,
    payload: { notice: { kind: "completed", title: "작업이 끝났다", body: null, origin: "g" } },
    durable: true,
    seq: 4,
    parentId: null,
  };

  /** 커밋 결과와 피드 읽기를 정해 둔 세션 대역. 요청과 읽기 인자를 기록한다 */
  function fakeNoticeSession(result: CommitResult) {
    const requests: CommitRequest[] = [];
    const reads: {
      after: number;
      upto: number;
      threadIds: readonly string[] | undefined;
      kindPrefixes: readonly string[] | undefined;
    }[] = [];
    const session: Pick<SessionService, "commit" | "feed"> = {
      commit: (request) => {
        requests.push(request);
        return ok(result);
      },
      feed: {
        headSeq: () => ok(3),
        oldestReplayableSeq: () => 0,
        read: (after, upto, filter, _limit, _scanLimit) => {
          reads.push({
            after,
            upto,
            threadIds: filter?.threadIds,
            kindPrefixes: filter?.kindPrefixes,
          });
          return ok({ events: [notified], scannedTo: notified.seq });
        },
        onCommit: () => () => undefined,
        onVolatile: () => () => undefined,
      },
    };
    return { session, requests, reads };
  }

  const producer: ProducerHandle = {
    producer: "cap.dialog",
    draft: () => {
      throw new Error("not used: the fake commit does not build");
    },
  };

  const committed: CommitResult = {
    status: "committed",
    firstSeq: 4,
    lastSeq: 4,
    leaf: null,
    eventIds: [notified.id],
    replayed: false,
  };

  test("emit은 dialog:notify:<requestId> 키로 커밋하고 기록된 이벤트를 피드에서 다시 읽는다", () => {
    const { session, requests, reads } = fakeNoticeSession(committed);
    const lines: LogLine[] = [];
    const port = sessionNoticePort(session, producer, fixedIdFactory(), recordingLogger(lines));
    const result = port.emit(
      notified.threadId,
      { kind: "completed", title: "작업이 끝났다", body: null, origin: "g" },
      "req-1",
    );
    expect(result).toEqual(ok(notified));
    expect(requests.map((request) => request.requestId)).toEqual(["dialog:notify:req-1"]);
    expect(reads).toEqual([
      {
        after: 3,
        upto: 4,
        threadIds: [notified.threadId],
        kindPrefixes: ["dialog."],
      },
    ]);
  });

  test("같은 requestId의 키 재사용은 key_reused이고 로그를 남긴다", () => {
    const { session } = fakeNoticeSession({
      status: "key_reused",
      requestId: "dialog:notify:req-1",
    });
    const lines: LogLine[] = [];
    const port = sessionNoticePort(session, producer, fixedIdFactory(), recordingLogger(lines));
    const result = port.emit(
      notified.threadId,
      { kind: "completed", title: "작업이 끝났다", body: null, origin: "g" },
      "req-1",
    );
    expect(result).toEqual(err({ kind: "key_reused", requestId: "req-1" }));
    expect(lines.map((line) => line.event)).toEqual(["dialog.notify_key_reused"]);
  });

  test("requestId가 없으면 키가 매번 달라 멱등을 걸지 않는다", () => {
    const { session, requests } = fakeNoticeSession(committed);
    const port = sessionNoticePort(session, producer, fixedIdFactory(), recordingLogger([]));
    const record = { kind: "completed", title: "작업이 끝났다", body: null, origin: "g" } as const;
    port.emit(notified.threadId, record, undefined);
    port.emit(notified.threadId, record, undefined);
    const keys = requests.map((request) => request.requestId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((key) => key.startsWith("dialog:notify:"))).toBe(true);
  });

  test("read는 머리 seq 뒤를 dialog 접두와 스레드로 거른 피드 읽기로 바꾼다", () => {
    const { session, reads } = fakeNoticeSession(committed);
    const port = sessionNoticePort(session, producer, fixedIdFactory(), recordingLogger([]));
    expect(port.read(3, { limit: 5, scanLimit: 5 })).toEqual(ok({ events: [], scannedTo: 3 }));
    expect(reads).toEqual([]);
    const page = port.read(0, { threadId: notified.threadId, limit: 5, scanLimit: 5 });
    expect(page).toEqual(ok({ events: [notified], scannedTo: 4 }));
    expect(reads.at(-1)).toEqual({
      after: 0,
      upto: 3,
      threadIds: [notified.threadId],
      kindPrefixes: ["turn.", "approval.", "work.", "agent.", "schedule.", "dialog."],
    });
  });
});

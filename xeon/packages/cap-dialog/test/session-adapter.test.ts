import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@xeon/contracts";
import {
  DIALOG_EVENT_CATALOG,
  VolatileEventEnvelopeSchema,
  type SessionService,
  type VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { sessionFeed, sessionStatusPublisher } from "../src/session-adapter.ts";
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
    expect(calls).toEqual([{ afterSeq: 7, kindPrefixes: ["turn.", "approval."] }]);
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

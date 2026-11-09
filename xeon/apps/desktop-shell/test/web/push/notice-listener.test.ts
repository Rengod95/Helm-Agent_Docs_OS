import { describe, expect, test } from "bun:test";
import {
  PUSHED_NOTICE_KINDS,
  startNoticePush,
  type NoticeSource,
  type PushableNotice,
} from "../../../src/web/push/notice-listener.ts";
import type { PushPayload, PushSender, SendReport } from "../../../src/web/push/sender.ts";
import { recordingLogger, type LogEntry } from "../support/logger.ts";

const EMPTY_REPORT: SendReport = { delivered: 0, removed: 0, failed: 0, attempts: [] };

/** 알림을 손으로 흘려 보내는 원천 */
function fakeSource(): NoticeSource & {
  emit(notice: PushableNotice): void;
  readonly listeners: number;
} {
  const callbacks = new Set<(notice: PushableNotice) => void>();
  return {
    onNotice(callback) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    emit(notice) {
      for (const callback of Array.from(callbacks)) callback(notice);
    },
    get listeners() {
      return callbacks.size;
    },
  };
}

function recordingSender(answer: () => Promise<SendReport> = () => Promise.resolve(EMPTY_REPORT)): {
  readonly sender: PushSender;
  readonly payloads: PushPayload[];
} {
  const payloads: PushPayload[] = [];
  const sender: PushSender = {
    send(payload) {
      payloads.push(payload);
      return answer();
    },
  };
  return { sender, payloads };
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("notice push", () => {
  test("approval, question, completed and error notices are pushed as title and thread", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    const logs: LogEntry[] = [];
    startNoticePush({ source, sender, logger: recordingLogger(logs) });

    source.emit({ kind: "approval_waiting", title: "Approve: run tests", threadId: "t1" });
    source.emit({ kind: "question_waiting", title: "Which branch?", threadId: "t2" });
    source.emit({ kind: "completed", title: "Turn finished", threadId: "t3" });
    source.emit({ kind: "error", title: "Turn failed", threadId: "t4" });
    await flush();

    expect(payloads).toEqual([
      { title: "Approve: run tests", threadId: "t1" },
      { title: "Which branch?", threadId: "t2" },
      { title: "Turn finished", threadId: "t3" },
      { title: "Turn failed", threadId: "t4" },
    ]);
    expect(logs).toEqual([]);
  });

  test("background completions and other kinds are not pushed", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    startNoticePush({ source, sender, logger: recordingLogger() });

    source.emit({ kind: "background_completed", title: "Sub-agent done", threadId: "t1" });
    source.emit({ kind: "something_new", title: "?", threadId: "t1" });
    await flush();

    expect(payloads).toEqual([]);
    expect(PUSHED_NOTICE_KINDS).toEqual([
      "approval_waiting",
      "question_waiting",
      "completed",
      "error",
    ]);
  });

  test("a notice outside any thread is pushed with a null thread id", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    startNoticePush({ source, sender, logger: recordingLogger() });
    source.emit({ kind: "error", title: "Schedule failed", threadId: null });
    await flush();
    expect(payloads).toEqual([{ title: "Schedule failed", threadId: null }]);
  });

  test("the payload has only the title and the thread id, never the notice body", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    startNoticePush({ source, sender, logger: recordingLogger() });
    const withBody: PushableNotice & { readonly body: string } = {
      kind: "completed",
      title: "Done",
      threadId: "t9",
      body: "SECRET BODY TEXT that must not be pushed",
    };
    source.emit(withBody);
    await flush();
    expect(payloads).toHaveLength(1);
    expect(Object.keys(payloads[0] ?? {}).toSorted()).toEqual(["threadId", "title"]);
    expect(JSON.stringify(payloads)).not.toContain("SECRET BODY");
  });

  test("a blank title becomes the app name", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    startNoticePush({ source, sender, logger: recordingLogger() });
    source.emit({ kind: "completed", title: "   ", threadId: "t1" });
    await flush();
    expect(payloads).toEqual([{ title: "Fresnel", threadId: "t1" }]);
  });

  test("unsubscribing stops the pushes", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    const stop = startNoticePush({ source, sender, logger: recordingLogger() });
    source.emit({ kind: "completed", title: "one", threadId: "t1" });
    stop();
    expect(source.listeners).toBe(0);
    source.emit({ kind: "completed", title: "two", threadId: "t1" });
    await flush();
    expect(payloads.map((payload) => payload.title)).toEqual(["one"]);
  });

  test("a custom kinds list replaces the default", async () => {
    const source = fakeSource();
    const { sender, payloads } = recordingSender();
    startNoticePush({
      source,
      sender,
      logger: recordingLogger(),
      kinds: ["background_completed"],
    });
    source.emit({ kind: "completed", title: "no", threadId: "t1" });
    source.emit({ kind: "background_completed", title: "yes", threadId: "t1" });
    await flush();
    expect(payloads.map((payload) => payload.title)).toEqual(["yes"]);
  });

  test("a failing send is logged by kind and does not stop the listener", async () => {
    const source = fakeSource();
    const logs: LogEntry[] = [];
    let calls = 0;
    const sender: PushSender = {
      send() {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("boom with the endpoint https://secret.example.test/x"))
          : Promise.resolve(EMPTY_REPORT);
      },
    };
    startNoticePush({ source, sender, logger: recordingLogger(logs) });
    source.emit({ kind: "error", title: "first", threadId: "t1" });
    await flush();
    source.emit({ kind: "error", title: "second", threadId: "t1" });
    await flush();
    expect(calls).toBe(2);
    expect(logs).toEqual([
      { level: "error", event: "push.notice_send_failed", fields: { kind: "error" } },
    ]);
    expect(JSON.stringify(logs)).not.toContain("secret.example.test");
  });
});

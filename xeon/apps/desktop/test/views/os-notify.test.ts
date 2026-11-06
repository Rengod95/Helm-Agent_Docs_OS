import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { Bug } from "@fresnel/contracts";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { NotifyDeliveredParams, ThreadSummary } from "@fresnel/contracts/wire";
import {
  createOsNotifier,
  type NotifyOutcome,
  type OsNotifyCommand,
  type OsNotifyPort,
} from "../../src/views/os-notify.ts";
import type { NotifyPrefs } from "../../src/views/os-notify-model.ts";

// 알림 전달기(B-10). 가짜 invoke는 부른 명령과 인자를 기록하고 답을 준다. 가짜 구독은 받은 청취자를 잡아 두었다가 시험이 알림을 보낸다.
// 시각은 시험이 조종한다. 알림이 도는 것은 비동기이므로 시험은 한 번 양보한 뒤에 값을 본다.

type Call = { readonly command: OsNotifyCommand; readonly args: unknown };
type Reply = (command: OsNotifyCommand, args: unknown) => Promise<unknown>;

function thread(raw: string): ThreadId {
  if (!isId("thr", raw)) throw new Bug(`test fixture thread id is malformed: ${raw}`);
  return raw;
}

const T1 = thread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const T2 = thread("thr_01BX5ZZKBKACTAV9WEVGEMMVRZ");
const ON: NotifyPrefs = { turnDone: true, approval: true, scheduleFailed: true };
const SHOWN: Reply = () => Promise.resolve({ kind: "shown" });

/** 비동기 전달이 끝나도록 한 번 양보한다 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function deliveredOf(threadId: ThreadId | null, kind: NotifyDeliveredParams["notice"]["kind"]) {
  return {
    threadId,
    notice: { kind, title: "원래 제목", body: "원래 본문", seq: 1, sourceType: "dialog.notified" },
    deliveredAt: "2026-11-06T10:00:00Z",
  } satisfies NotifyDeliveredParams;
}

function harnessOf(options: {
  readonly reply?: Reply;
  readonly focused?: boolean;
  readonly prefs?: NotifyPrefs;
  readonly threads?: Readonly<Record<string, Pick<ThreadSummary, "origin" | "title">>>;
}) {
  const calls: Call[] = [];
  const results: NotifyOutcome[] = [];
  let listener: ((delivered: NotifyDeliveredParams) => void) | null = null;
  let unsubscribed = 0;
  let clock = 0;
  const reply: Reply = options.reply ?? SHOWN;
  const port: OsNotifyPort = {
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
        unsubscribed += 1;
      };
    },
    invoke: (command, args) => {
      calls.push({ command, args });
      return reply(command, args);
    },
    isFocused: () => options.focused ?? false,
    prefs: () => options.prefs ?? ON,
    threadOf: (id) => options.threads?.[id],
    now: () => clock,
    onResult: (outcome) => {
      results.push(outcome);
    },
  };
  const notifier = createOsNotifier(port);
  return {
    notifier,
    calls,
    results,
    deliver: (delivered: NotifyDeliveredParams): void => {
      listener?.(delivered);
    },
    at: (ms: number): void => {
      clock = ms;
    },
    unsubscribed: () => unsubscribed,
    listening: () => listener !== null,
  };
}

/** `notify_permission`이 `answer`를 주고, `notify_request_permission`이 `requested`를 주는 답 */
function permissionReply(answer: string, requested = "granted"): Reply {
  return (command) => {
    if (command === "notify_permission") return Promise.resolve(answer);
    if (command === "notify_request_permission") return Promise.resolve(requested);
    return Promise.resolve({ kind: "shown" });
  };
}

const BUILD = { origin: { kind: "user" as const }, title: "빌드 실패 분석" };

describe("the notifier sends the plan", () => {
  test("a finished turn is shown with its title, body, and thread after one permission read", async () => {
    const h = harnessOf({ reply: permissionReply("granted"), threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.calls).toEqual([
      { command: "notify_permission", args: undefined },
      {
        command: "notify_os",
        args: {
          title: t("desktop.osNotice.title", {
            what: t("desktop.osNotice.what.done"),
            thread: "빌드 실패 분석",
          }),
          body: t("desktop.osNotice.body.done"),
          threadId: T1,
        },
      },
    ]);
    expect(h.results).toEqual(["shown"]);
    expect(h.notifier.status.get()).toEqual({ permission: "granted", lastDeliveryFailed: false });
  });

  test("a prompt is requested once, and later notifications do not read or request again", async () => {
    const h = harnessOf({ reply: permissionReply("prompt", "granted") });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    h.deliver(deliveredOf(T2, "completed"));
    await settle();
    const commands = h.calls.map((call) => call.command);
    expect(commands).toEqual([
      "notify_permission",
      "notify_request_permission",
      "notify_os",
      "notify_os",
    ]);
  });

  test("the notification body from the source never reaches the OS call", async () => {
    const h = harnessOf({ threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.deliver({
      ...deliveredOf(T1, "approval_waiting"),
      notice: {
        kind: "approval_waiting",
        title: "secret-title-1",
        body: "rm -rf secret-body-2",
        seq: 2,
        sourceType: "dialog.notified",
      },
    });
    await settle();
    const sent = h.calls.find((call) => call.command === "notify_os");
    expect(JSON.stringify(sent?.args)).not.toContain("secret-");
  });

  test("a notice without a conversation goes out with no thread id", async () => {
    const h = harnessOf({});
    h.notifier.listen();
    h.deliver(deliveredOf(null, "completed"));
    await settle();
    const sent = h.calls.find((call) => call.command === "notify_os");
    expect(sent?.args).toMatchObject({ threadId: null });
  });
});

describe("the notifier skips what it should not send", () => {
  test("nothing is read or sent while the window is in front", async () => {
    const h = harnessOf({ focused: true, threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.calls).toEqual([]);
    expect(h.results).toEqual([]);
  });

  test("a switched-off category is not sent", async () => {
    const h = harnessOf({ prefs: { ...ON, approval: false }, threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "question_waiting"));
    await settle();
    expect(h.calls).toEqual([]);
  });

  test("an error outside a schedule is not sent", async () => {
    const h = harnessOf({ threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "error"));
    await settle();
    expect(h.calls).toEqual([]);
  });

  test("the same category and conversation within three seconds is sent once", async () => {
    const h = harnessOf({ reply: permissionReply("granted"), threads: { [T1]: BUILD } });
    h.notifier.listen();
    h.at(0);
    h.deliver(deliveredOf(T1, "approval_waiting"));
    h.at(2000);
    h.deliver(deliveredOf(T1, "approval_waiting"));
    await settle();
    expect(h.calls.filter((call) => call.command === "notify_os")).toHaveLength(1);
    h.at(3000);
    h.deliver(deliveredOf(T1, "approval_waiting"));
    await settle();
    expect(h.calls.filter((call) => call.command === "notify_os")).toHaveLength(2);
  });
});

describe("delivery results and the failure record", () => {
  test("a denied or failed reply is recorded as the last delivery failure", async () => {
    const replies: unknown[] = [{ kind: "denied" }, { kind: "failed" }, { kind: "shown" }];
    const h = harnessOf({
      reply: (command) => {
        if (command === "notify_permission") return Promise.resolve("granted");
        return Promise.resolve(replies.shift());
      },
      threads: { [T1]: BUILD, [T2]: BUILD },
    });
    const seen: boolean[] = [];
    h.notifier.status.subscribe(() => {
      seen.push(h.notifier.status.get().lastDeliveryFailed);
    });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.notifier.status.get().lastDeliveryFailed).toBe(true);
    h.deliver(deliveredOf(T2, "completed"));
    await settle();
    expect(h.notifier.status.get().lastDeliveryFailed).toBe(true);
    h.at(10_000);
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.notifier.status.get().lastDeliveryFailed).toBe(false);
    expect(h.results).toEqual(["denied", "failed", "shown"]);
    // 첫 줄은 권한을 읽으며 바뀐 값이고, 그다음은 거부, 마지막은 전달 성공이다
    expect(seen).toEqual([false, true, false]);
  });

  test("a rejected notify_os call is a failure, and the notifier keeps working", async () => {
    let fail = true;
    const h = harnessOf({
      reply: (command) => {
        if (command === "notify_permission") return Promise.resolve("granted");
        if (fail) return Promise.reject(new Error("bridge is gone"));
        return Promise.resolve({ kind: "shown" });
      },
      threads: { [T1]: BUILD, [T2]: BUILD },
    });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.notifier.status.get().lastDeliveryFailed).toBe(true);
    fail = false;
    h.deliver(deliveredOf(T2, "completed"));
    await settle();
    expect(h.results).toEqual(["failed", "shown"]);
    expect(h.notifier.status.get().lastDeliveryFailed).toBe(false);
  });

  test("a reply of the wrong shape is a failure", async () => {
    const h = harnessOf({
      reply: (command) => {
        if (command === "notify_permission") return Promise.resolve("granted");
        return Promise.resolve({ kind: "maybe" });
      },
      threads: { [T1]: BUILD },
    });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.results).toEqual(["failed"]);
  });

  test("a rejected permission read leaves the permission unknown and still tries to show", async () => {
    const h = harnessOf({
      reply: (command) => {
        if (command === "notify_permission") return Promise.reject(new Error("no plugin"));
        return Promise.resolve({ kind: "shown" });
      },
      threads: { [T1]: BUILD },
    });
    h.notifier.listen();
    h.deliver(deliveredOf(T1, "completed"));
    await settle();
    expect(h.notifier.status.get().permission).toBe("unknown");
    expect(h.calls.map((call) => call.command)).toEqual(["notify_permission", "notify_os"]);
    expect(h.results).toEqual(["shown"]);
  });
});

describe("listening", () => {
  test("the listener is kept while listening and removed when the stop function is called", () => {
    const h = harnessOf({});
    const stop = h.notifier.listen();
    expect(h.listening()).toBe(true);
    stop();
    expect(h.listening()).toBe(false);
    expect(h.unsubscribed()).toBe(1);
  });
});

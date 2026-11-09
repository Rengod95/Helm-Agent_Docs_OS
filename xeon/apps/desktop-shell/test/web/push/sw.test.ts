// 서비스 워커(`src/web/static/sw.ts`) 시험: 파일 글을 `node:vm`에서 가짜 `self`, `clients`, `registration`으로 돌려 호출을 기록한다.
import { describe, expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { buildServiceWorkerSource } from "../../../src/web/static/sw-build.ts";

const SW_SOURCE = await buildServiceWorkerSource();

interface Shown {
  readonly title: string;
  readonly options: { readonly tag: string; readonly data: unknown; readonly renotify: boolean };
}

interface FakeWindow {
  readonly focused: boolean;
  readonly focus: () => Promise<void>;
  readonly postMessage: (message: unknown) => void;
  readonly log: unknown[];
  readonly focusCalls: number[];
}

function fakeWindow(focused: boolean, log: unknown[] = [], focusCalls: number[] = []): FakeWindow {
  return {
    focused,
    focus: () => {
      focusCalls.push(1);
      return Promise.resolve();
    },
    postMessage: (message) => {
      log.push(structuredClone(message));
    },
    log,
    focusCalls,
  };
}

interface Harness {
  /** 이벤트를 보내고 `waitUntil`로 받은 약속이 모두 끝날 때까지 기다린다 */
  dispatch(type: string, event: object): Promise<void>;
  readonly shown: Shown[];
  readonly matchAllCalls: unknown[];
  readonly opened: string[];
}

function harness(windows: FakeWindow[] = []): Harness {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const shown: Shown[] = [];
  const matchAllCalls: unknown[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    registration: {
      showNotification(title: string, options: Shown["options"]) {
        shown.push({ title, options: structuredClone(options) });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll(options: unknown) {
        matchAllCalls.push(structuredClone(options));
        return Promise.resolve(windows);
      },
      openWindow(url: string) {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  const context = createContext({ self });
  runInContext(SW_SOURCE, context, { filename: "sw.js" });

  async function dispatch(type: string, event: object): Promise<void> {
    const pending: Promise<unknown>[] = [];
    const wrapped = {
      ...event,
      waitUntil: (work: Promise<unknown>) => {
        pending.push(work);
      },
    };
    for (const handler of listeners.get(type) ?? []) handler(wrapped);
    await Promise.all(pending);
  }

  return { dispatch, shown, matchAllCalls, opened };
}

function pushEvent(text: string): { data: { text: () => Promise<string> } } {
  return { data: { text: () => Promise.resolve(text) } };
}

/** 본문을 읽는 데 실패하는 푸시 */
function unreadablePushEvent(): { data: { text: () => Promise<string> } } {
  return { data: { text: () => Promise.reject(new Error("unreadable")) } };
}

describe("service worker: push", () => {
  test("a title and thread become a notification tagged by thread, with renotify", async () => {
    const h = harness();
    await h.dispatch(
      "push",
      pushEvent(JSON.stringify({ title: "Approve: run tests", threadId: "t1" })),
    );
    expect(h.shown).toEqual([
      {
        title: "Approve: run tests",
        options: { tag: "t1", data: { threadId: "t1" }, renotify: true },
      },
    ]);
  });

  test("without a thread the tag is fresnel and the data carries a null thread", async () => {
    const h = harness();
    await h.dispatch("push", pushEvent(JSON.stringify({ title: "Turn finished", threadId: null })));
    expect(h.shown).toEqual([
      {
        title: "Turn finished",
        options: { tag: "fresnel", data: { threadId: null }, renotify: true },
      },
    ]);
  });

  test("invalid JSON falls back to the generic title", async () => {
    const h = harness();
    await h.dispatch("push", pushEvent("{not json"));
    expect(h.shown).toEqual([
      { title: "Fresnel", options: { tag: "fresnel", data: { threadId: null }, renotify: true } },
    ]);
  });

  test("a missing body, an unreadable body, or a non-object gives the generic title", async () => {
    const h = harness();
    await h.dispatch("push", {});
    await h.dispatch("push", unreadablePushEvent());
    await h.dispatch("push", pushEvent("[1, 2]"));
    await h.dispatch("push", pushEvent("42"));
    expect(h.shown.map((item) => item.title)).toEqual(["Fresnel", "Fresnel", "Fresnel", "Fresnel"]);
    expect(h.shown.every((item) => item.options.tag === "fresnel")).toBe(true);
  });

  test("a non-string title is replaced, a valid thread is kept", async () => {
    const h = harness();
    await h.dispatch("push", pushEvent(JSON.stringify({ title: 5, threadId: "t2" })));
    expect(h.shown).toEqual([
      { title: "Fresnel", options: { tag: "t2", data: { threadId: "t2" }, renotify: true } },
    ]);
  });

  test("a title longer than 120 characters is cut by characters", async () => {
    const h = harness();
    await h.dispatch(
      "push",
      pushEvent(JSON.stringify({ title: "😀".repeat(130), threadId: null })),
    );
    expect(h.shown[0]?.title).toBe("😀".repeat(120));
  });

  test("the handler waits for the notification to be shown", async () => {
    let resolveShow: (() => void) | undefined;
    const pendingShow = new Promise<void>((resolve) => {
      resolveShow = resolve;
    });
    const seen: string[] = [];
    const self = {
      addEventListener(type: string, handler: (event: unknown) => void) {
        if (type === "push") {
          handler({
            data: { text: () => Promise.resolve(JSON.stringify({ title: "x", threadId: "t" })) },
            waitUntil: (work: Promise<unknown>) => {
              seen.push("waited");
              void work.then(() => seen.push("done"));
            },
          });
        }
      },
      registration: {
        showNotification() {
          return pendingShow;
        },
      },
      clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(null) },
    };
    runInContext(SW_SOURCE, createContext({ self }), { filename: "sw.js" });
    await Promise.resolve();
    expect(seen).toEqual(["waited"]);
    resolveShow?.();
    await pendingShow;
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(seen).toEqual(["waited", "done"]);
  });
});

describe("service worker: notification click", () => {
  test("closes the notification, focuses a window and tells it which thread to open", async () => {
    const log: unknown[] = [];
    const focusCalls: number[] = [];
    const h = harness([fakeWindow(false, log, focusCalls)]);
    let closed = 0;
    await h.dispatch("notificationclick", {
      notification: {
        data: { threadId: "t1" },
        close: () => {
          closed += 1;
        },
      },
    });
    expect(closed).toBe(1);
    expect(h.matchAllCalls).toEqual([{ type: "window", includeUncontrolled: true }]);
    expect(focusCalls).toEqual([1]);
    expect(log).toEqual([{ type: "openThread", threadId: "t1" }]);
    expect(h.opened).toEqual([]);
  });

  test("the focused window is preferred over the first one", async () => {
    const firstLog: unknown[] = [];
    const secondLog: unknown[] = [];
    const h = harness([fakeWindow(false, firstLog), fakeWindow(true, secondLog)]);
    await h.dispatch("notificationclick", {
      notification: { data: { threadId: "t7" }, close: () => undefined },
    });
    expect(firstLog).toEqual([]);
    expect(secondLog).toEqual([{ type: "openThread", threadId: "t7" }]);
  });

  test("with no window open it opens the root page and sends no message", async () => {
    const h = harness([]);
    await h.dispatch("notificationclick", {
      notification: { data: { threadId: "t1" }, close: () => undefined },
    });
    expect(h.opened).toEqual(["/"]);
  });

  test("a notification without a thread sends a null thread id", async () => {
    const log: unknown[] = [];
    const h = harness([fakeWindow(true, log)]);
    await h.dispatch("notificationclick", {
      notification: { data: undefined, close: () => undefined },
    });
    expect(log).toEqual([{ type: "openThread", threadId: null }]);
  });
});

describe("service worker: source", () => {
  test("it is one classic script with no imports, no eval and no dynamic code", () => {
    expect(SW_SOURCE).not.toMatch(/\bimport\b/u);
    expect(SW_SOURCE).not.toMatch(/\beval\s*\(|new\s+Function|importScripts/u);
    expect(SW_SOURCE).not.toMatch(/\bexport\b/u);
  });
});

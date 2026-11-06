import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import {
  drainShellIntents,
  intentsOf,
  startShellIntents,
  takeNotifyTarget,
  type ShellIntentPort,
  type ShellInvoke,
} from "../../src/views/shell-intents.ts";

// 셸 의도 처리(B-10). 가짜 invoke는 명령마다 답을 주고, 가짜 듣기는 깨우기 청취자를 잡아 둔다.
// 창 사건은 실제 EventTarget에 보내 본다. 등록과 해제는 기록으로 본다.

function thread(raw: string): ThreadId {
  if (!isId("thr", raw)) throw new Bug(`test fixture thread id is malformed: ${raw}`);
  return raw;
}

const T1 = thread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");

/** 한 번 양보한다. 기다리는 비동기 호출이 모두 끝나도록 한다 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function harnessOf(answers: Readonly<Record<string, unknown>> = {}) {
  const commands: string[] = [];
  const opened: string[] = [];
  let newThreads = 0;
  let wake: (() => void) | null = null;
  let unlistened = 0;
  let visible = true;
  const focusTargets = { window: new EventTarget(), document: new EventTarget() };
  const invoke: ShellInvoke = (command) => {
    commands.push(command);
    return Promise.resolve(answers[command]);
  };
  const port: ShellIntentPort = {
    invoke,
    listen: (onWake) => {
      wake = onWake;
      return Promise.resolve(() => {
        unlistened += 1;
        wake = null;
      });
    },
    focusTargets,
    visible: () => visible,
    newThread: () => {
      newThreads += 1;
    },
    openThread: (threadId) => {
      opened.push(threadId);
    },
  };
  return {
    port,
    commands,
    opened,
    newThreads: () => newThreads,
    unlistened: () => unlistened,
    wake: () => wake?.(),
    setVisible: (next: boolean) => {
      visible = next;
    },
    focus: () => {
      focusTargets.window.dispatchEvent(new Event("focus"));
    },
    visibilityChange: () => {
      focusTargets.document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

describe("intentsOf", () => {
  test("a new-chat and an open request are read, and unknown or malformed entries are dropped", () => {
    expect(
      intentsOf([
        { kind: "newThread" },
        { kind: "openThread", threadId: T1 },
        { kind: "openThread", threadId: "not-a-thread" },
        { kind: "openThread" },
        { kind: "somethingElse" },
        "text",
        null,
      ]),
    ).toEqual([{ kind: "newThread" }, { kind: "openThread", threadId: T1 }]);
  });

  test("a reply that is not a list is no intents", () => {
    expect(intentsOf(undefined)).toEqual([]);
    expect(intentsOf({ kind: "newThread" })).toEqual([]);
  });
});

describe("drainShellIntents", () => {
  test("the queue is taken once and the intents run in order", async () => {
    const h = harnessOf({
      shell_take_intents: [{ kind: "newThread" }, { kind: "openThread", threadId: T1 }],
    });
    await drainShellIntents(h.port);
    expect(h.commands).toEqual(["shell_take_intents"]);
    expect(h.newThreads()).toBe(1);
    expect(h.opened).toEqual([T1]);
  });

  test("a rejected take dispatches nothing and does not throw", async () => {
    const h = harnessOf();
    const rejecting: ShellIntentPort = {
      ...h.port,
      invoke: () => Promise.reject(new Error("bridge gone")),
    };
    await drainShellIntents(rejecting);
    expect(h.newThreads()).toBe(0);
    expect(h.opened).toEqual([]);
  });
});

describe("takeNotifyTarget", () => {
  test("a thread id from the last notification opens that conversation", async () => {
    const h = harnessOf({ notify_take_target: T1 });
    await takeNotifyTarget(h.port);
    expect(h.commands).toEqual(["notify_take_target"]);
    expect(h.opened).toEqual([T1]);
  });

  test("no target, an empty value, or a value that is not a thread id opens nothing", async () => {
    const answers = [null, "", 5, "not-a-thread"];
    const opened = await Promise.all(
      answers.map(async (answer) => {
        const h = harnessOf({ notify_take_target: answer });
        await takeNotifyTarget(h.port);
        return h.opened;
      }),
    );
    expect(opened).toEqual(answers.map(() => []));
  });
});

describe("startShellIntents", () => {
  test("it drains the queue at start, on the wake event, and when the window comes to the front", async () => {
    const h = harnessOf({
      shell_take_intents: [],
      notify_take_target: T1,
    });
    const stop = startShellIntents(h.port);
    await settle();
    expect(h.commands).toEqual(["shell_take_intents"]);

    h.wake();
    await settle();
    expect(h.commands).toEqual(["shell_take_intents", "shell_take_intents"]);

    h.focus();
    await settle();
    expect(h.commands).toEqual([
      "shell_take_intents",
      "shell_take_intents",
      "shell_take_intents",
      "notify_take_target",
    ]);
    expect(h.opened).toEqual([T1]);
    stop();
  });

  test("a visibility change to hidden does nothing, and to visible does the front work", async () => {
    const h = harnessOf({ shell_take_intents: [], notify_take_target: null });
    const stop = startShellIntents(h.port);
    await settle();
    const before = h.commands.length;
    h.setVisible(false);
    h.visibilityChange();
    await settle();
    expect(h.commands).toHaveLength(before);

    h.setVisible(true);
    h.visibilityChange();
    await settle();
    expect(h.commands.slice(before)).toEqual(["shell_take_intents", "notify_take_target"]);
    stop();
  });

  test("stopping removes the window listeners and the wake subscription", async () => {
    const h = harnessOf({ shell_take_intents: [], notify_take_target: null });
    const stop = startShellIntents(h.port);
    await settle();
    stop();
    await settle();
    expect(h.unlistened()).toBe(1);
    const before = h.commands.length;
    h.focus();
    h.wake();
    await settle();
    expect(h.commands).toHaveLength(before);
  });

  test("stopping before the wake subscription is ready releases it as soon as it is", async () => {
    const h = harnessOf({ shell_take_intents: [] });
    const stop = startShellIntents(h.port);
    stop();
    await settle();
    expect(h.unlistened()).toBe(1);
  });
});

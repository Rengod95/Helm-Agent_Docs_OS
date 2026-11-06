import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCommandRegistry, type ShellReply } from "../src/main/commands.ts";
import type { CommandHandler, IpcCaller, ShellContext } from "../src/main/context.ts";
import { sharedIntents } from "../src/main/intents.ts";
import {
  clean,
  createNotifyOsModule,
  permissionWordOf,
  SHOW_FAILED_LOG,
  validThreadId,
  type NotifyOsPorts,
  type NotifyPermission,
  type ShownNotice,
} from "../src/main/notify-os.ts";

// sharedIntents는 앱 전체가 쓰는 전역 큐다. 시험마다 비워 앞 시험의 의도가 새지 않게 한다
beforeEach(() => {
  sharedIntents.take(Date.now());
});
afterEach(() => {
  sharedIntents.take(Date.now());
});

const caller: IpcCaller = { sender: Object.create(null) };

interface FakeShell {
  readonly ctx: ShellContext;
  readonly handlers: Map<string, CommandHandler>;
  readonly emitted: string[];
  /** 메인 창을 앞으로 가져온 횟수 */
  readonly window: { shows: number };
}

function fakeShell(): FakeShell {
  const handlers = new Map<string, CommandHandler>();
  const emitted: string[] = [];
  const window = { shows: 0 };
  const ctx: ShellContext = {
    env: {},
    platform: "darwin",
    paths: { userData: "/data", configDir: "/cfg", logs: "/logs", resources: "/res", ui: "/ui" },
    dialogs: {
      openFolder: () => Promise.resolve(null),
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
    },
    openExternal: () => Promise.resolve(),
    handle: (command, handler) => {
      handlers.set(command, handler);
    },
    channel: () => null,
    emit: (name) => {
      emitted.push(name);
    },
    showMainWindow: () => {
      window.shows += 1;
    },
    onQuit: () => undefined,
    handleScheme: () => undefined,
    windows: () => [],
    windowOptions: () => undefined,
    onWindow: () => undefined,
  };
  return { ctx, handlers, emitted, window };
}

type ShowMode = "shows" | "false" | "throws";

interface FakeState {
  permission: NotifyPermission;
  permissionThrows: boolean;
  showMode: ShowMode;
}

interface FakePorts {
  readonly ports: NotifyOsPorts;
  readonly state: FakeState;
  /** 띄운 알림과 그 클릭 콜백 */
  readonly shown: { notice: ShownNotice; click: () => void }[];
  readonly logs: string[];
}

function fakePorts(): FakePorts {
  const state: FakeState = { permission: "granted", permissionThrows: false, showMode: "shows" };
  const shown: { notice: ShownNotice; click: () => void }[] = [];
  const logs: string[] = [];
  const ports: NotifyOsPorts = {
    permission: () => {
      if (state.permissionThrows) throw new Error("permission read failed");
      return state.permission;
    },
    show: (notice, onClick) => {
      if (state.showMode === "throws") throw new Error(`cannot show ${notice.title}`);
      if (state.showMode === "false") return false;
      shown.push({ notice, click: onClick });
      return true;
    },
    log: (line) => {
      logs.push(line);
    },
  };
  return { ports, state, shown, logs };
}

/** 모듈을 가짜 ctx에 엮은 한 벌 */
function setup(): { shell: FakeShell; fake: FakePorts } {
  const shell = fakeShell();
  const fake = fakePorts();
  createNotifyOsModule(fake.ports).register(shell.ctx);
  return { shell, fake };
}

/** 등록된 명령을 실제 dispatch로 부른다. 답과 거절 값을 값 그대로 비교하게 한다 */
function dispatch(shell: FakeShell, command: string, args: unknown): Promise<ShellReply> {
  const registry = createCommandRegistry();
  for (const [name, handler] of shell.handlers) registry.handle(name, handler);
  return registry.dispatch(caller, command, args);
}

/** 띄운 알림 하나의 클릭. 없으면 시험을 실패시킨다 */
function clickOf(fake: FakePorts, index: number): () => void {
  const shown = fake.shown[index];
  if (shown === undefined) throw new Error(`no notice at ${index}`);
  return shown.click;
}

describe("clean", () => {
  test("turns line breaks and tabs into spaces and drops other control characters", () => {
    expect(clean("  안녕\u0007하세요\n\t끝  ", 80)).toBe("안녕하세요  끝");
    expect(clean("\u001b[31mred", 80)).toBe("[31mred");
    expect(clean(" \n\t\r ", 80)).toBe("");
  });

  test("keeps at most max code points, not bytes or UTF-16 units", () => {
    expect(clean("가".repeat(100), 80)).toBe("가".repeat(80));
    expect(clean("a".repeat(81), 80)).toBe("a".repeat(80));
    expect(clean("a".repeat(400), 400)).toBe("a".repeat(400));
    expect(clean("a".repeat(401), 400)).toBe("a".repeat(400));
    expect(clean("😀😀😀", 2)).toBe("😀😀");
  });

  test("drops control characters before counting, and trims after cutting", () => {
    expect(clean("a\u0007bc", 3)).toBe("abc");
    expect(clean("abc   def", 4)).toBe("abc");
  });
});

describe("thread id", () => {
  test("is valid only when non-empty, at most 128 code points, and free of control characters", () => {
    expect(validThreadId("")).toBe(false);
    expect(validThreadId("t-1")).toBe(true);
    expect(validThreadId("a b")).toBe(true);
    expect(validThreadId("가".repeat(128))).toBe(true);
    expect(validThreadId("가".repeat(129))).toBe(false);
    expect(validThreadId("😀".repeat(128))).toBe(true);
    expect(validThreadId("😀".repeat(129))).toBe(false);
    expect(validThreadId("a\nb")).toBe(false);
    expect(validThreadId("a\u0000")).toBe(false);
    expect(validThreadId("a\u007f")).toBe(false);
    expect(validThreadId("a\u009fb")).toBe(false);
  });
});

describe("permission", () => {
  test("a support check answers granted or denied", () => {
    expect(permissionWordOf(true)).toBe("granted");
    expect(permissionWordOf(false)).toBe("denied");
  });

  const words: NotifyPermission[] = ["granted", "denied", "prompt"];
  test.each(words)("both permission commands answer %s", async (word) => {
    const { shell, fake } = setup();
    fake.state.permission = word;
    expect(await dispatch(shell, "notify_permission", null)).toEqual({ ok: true, value: word });
    expect(await dispatch(shell, "notify_request_permission", null)).toEqual({
      ok: true,
      value: word,
    });
  });

  test("a permission read that throws answers prompt", async () => {
    const { shell, fake } = setup();
    fake.state.permissionThrows = true;
    expect(await dispatch(shell, "notify_permission", null)).toEqual({ ok: true, value: "prompt" });
    expect(await dispatch(shell, "notify_request_permission", null)).toEqual({
      ok: true,
      value: "prompt",
    });
  });

  test("registers exactly the three notification commands", () => {
    const { shell } = setup();
    expect([...shell.handlers.keys()]).toEqual([
      "notify_permission",
      "notify_request_permission",
      "notify_os",
    ]);
  });
});

describe("notify_os replies", () => {
  test("replies shown with a kind tag and passes the cleaned notice to show", async () => {
    const { shell, fake } = setup();
    expect(await dispatch(shell, "notify_os", { title: "완료" })).toEqual({
      ok: true,
      value: { kind: "shown" },
    });
    expect(fake.shown.map((item) => item.notice)).toEqual([{ title: "완료", body: null }]);
  });

  test("replies denied and does not show when the permission is denied", async () => {
    const { shell, fake } = setup();
    fake.state.permission = "denied";
    expect(await dispatch(shell, "notify_os", { title: "완료", body: "본문" })).toEqual({
      ok: true,
      value: { kind: "denied" },
    });
    expect(fake.shown).toEqual([]);
    expect(fake.logs).toEqual([]);
    expect(shell.window.shows).toBe(0);
  });

  test("a permission read that throws still shows, as prompt does", async () => {
    const { shell, fake } = setup();
    fake.state.permissionThrows = true;
    expect(await dispatch(shell, "notify_os", { title: "완료" })).toEqual({
      ok: true,
      value: { kind: "shown" },
    });
    expect(fake.shown.length).toBe(1);
  });

  test("replies failed and logs only the fixed line when show throws", async () => {
    const { shell, fake } = setup();
    fake.state.showMode = "throws";
    expect(await dispatch(shell, "notify_os", { title: "비밀 제목" })).toEqual({
      ok: true,
      value: { kind: "failed" },
    });
    expect(fake.logs).toEqual(["notify: not shown (reason: show_failed)"]);
    expect(SHOW_FAILED_LOG).toBe("notify: not shown (reason: show_failed)");
  });

  test("replies failed and logs the fixed line when show reports false", async () => {
    const { shell, fake } = setup();
    fake.state.showMode = "false";
    expect(await dispatch(shell, "notify_os", { title: "완료" })).toEqual({
      ok: true,
      value: { kind: "failed" },
    });
    expect(fake.logs).toEqual(["notify: not shown (reason: show_failed)"]);
  });
});

describe("click", () => {
  test("a click on a valid thread queues openThread, shows the window once, and emits shell-intent", async () => {
    const { shell, fake } = setup();
    await dispatch(shell, "notify_os", { title: "완료", body: "본문", threadId: "thread-a" });
    expect(fake.shown.length).toBe(1);
    expect(shell.window.shows).toBe(0);
    expect(shell.emitted).toEqual([]);
    expect(sharedIntents.take(Date.now())).toEqual([]);

    clickOf(fake, 0)();
    expect(shell.window.shows).toBe(1);
    expect(shell.emitted).toEqual(["shell-intent"]);
    expect(sharedIntents.take(Date.now())).toEqual([{ kind: "openThread", threadId: "thread-a" }]);
  });

  test("a click without a thread id only shows the window", async () => {
    const { shell, fake } = setup();
    await dispatch(shell, "notify_os", { title: "완료" });
    clickOf(fake, 0)();
    expect(shell.window.shows).toBe(1);
    expect(shell.emitted).toEqual([]);
    expect(sharedIntents.take(Date.now())).toEqual([]);
  });

  const badIds: [string, string][] = [
    ["an empty id", ""],
    ["an id with a line break", "a\nb"],
    ["an id longer than 128 characters", "가".repeat(129)],
  ];
  test.each(badIds)(
    "does not queue %s, and the notice is still shown",
    async (_label, threadId) => {
      const { shell, fake } = setup();
      expect(await dispatch(shell, "notify_os", { title: "완료", threadId })).toEqual({
        ok: true,
        value: { kind: "shown" },
      });
      clickOf(fake, 0)();
      expect(shell.window.shows).toBe(1);
      expect(shell.emitted).toEqual([]);
      expect(sharedIntents.take(Date.now())).toEqual([]);
    },
  );
});

describe("notice text", () => {
  test("the title is cleaned and kept to 80 characters", async () => {
    const { shell, fake } = setup();
    await dispatch(shell, "notify_os", { title: "  안녕\n세상\u0007  " });
    await dispatch(shell, "notify_os", { title: "가".repeat(100) });
    expect(fake.shown.map((item) => item.notice.title)).toEqual(["안녕 세상", "가".repeat(80)]);
    expect(shell.window.shows).toBe(0);
  });

  test("the body is cleaned and kept to 400 characters, and an empty body is null", async () => {
    const { shell, fake } = setup();
    await dispatch(shell, "notify_os", { title: "완료", body: "a".repeat(401) });
    await dispatch(shell, "notify_os", { title: "완료", body: "\n\t " });
    await dispatch(shell, "notify_os", { title: "완료", body: null });
    expect(fake.shown.map((item) => item.notice.body)).toEqual(["a".repeat(400), null, null]);
  });
});

describe("bad arguments", () => {
  const badRequest: ShellReply = { ok: false, error: "bad-request" };
  test("rejects a non-object, a missing or non-text title, or an empty title with bad-request", async () => {
    const { shell, fake } = setup();
    const cases: unknown[] = [
      null,
      "text",
      {},
      { body: "본문" },
      { title: 5 },
      { title: "  \n\t " },
    ];
    const replies = await Promise.all(cases.map((args) => dispatch(shell, "notify_os", args)));
    expect(replies).toEqual(cases.map(() => badRequest));
    expect(fake.shown).toEqual([]);
    expect(fake.logs).toEqual([]);
  });

  test("rejects a non-text body or thread id with bad-request", async () => {
    const { shell, fake } = setup();
    const cases: unknown[] = [
      { title: "완료", body: 5 },
      { title: "완료", body: {} },
      { title: "완료", threadId: 7 },
      { title: "완료", threadId: ["x"] },
    ];
    const replies = await Promise.all(cases.map((args) => dispatch(shell, "notify_os", args)));
    expect(replies).toEqual(cases.map(() => badRequest));
    expect(fake.shown).toEqual([]);
  });
});

// 탭 컨텍스트 시험. 탭 둘이 릴레이, 의도 큐, 채널, 명령 표를 나누어 가지는지, 닫힌 탭이 아무것도 못 하는지 본다.
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import type { IpcCaller } from "../../../src/main/context.ts";
import { relayOf } from "../../../src/main/engine.ts";
import { CHANNEL_KEY } from "../../../src/shared/channels.ts";
import type { ServerFrame } from "../../../src/web/session/protocol.ts";
import { createWebContext, type WebContext } from "../../../src/web/session/web-context.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordedLog, sessionOptions } from "./support.ts";

afterEach(cleanupTempDirs);

/** 발신자 객체. 채널과 핸들 표가 이 값을 키로 본다. 시험 발신자는 `fake-context.ts`와 같다 */
const caller: IpcCaller = { sender: Object.create(null) };

interface Tab {
  readonly web: WebContext;
  readonly sent: ServerFrame[];
}

function tabOf(): Tab {
  const sent: ServerFrame[] = [];
  const socketPath = path.join(tempDir(), "absent.sock");
  const web = createWebContext({
    ...sessionOptions(socketPath, recordedLog()),
    send: (frame) => {
      sent.push(frame);
    },
  });
  return { web, sent };
}

describe("tab contexts are separate", () => {
  test("each tab has its own relay, intent queue and channel table", async () => {
    const a = tabOf();
    const b = tabOf();
    try {
      expect(relayOf(a.web.ctx) === relayOf(b.web.ctx)).toBe(false);

      a.web.intents.push({ kind: "newThread" }, 1);
      a.web.intents.push({ kind: "openThread", threadId: "t-1" }, 2);
      expect(a.web.intents.take(3)).toEqual([
        { kind: "newThread" },
        { kind: "openThread", threadId: "t-1" },
      ]);
      expect(b.web.intents.take(3)).toEqual([]);

      const channelA = a.web.ctx.channel(caller, { [CHANNEL_KEY]: 5 });
      const channelB = b.web.ctx.channel(caller, { [CHANNEL_KEY]: 5 });
      channelA?.send("only-a");
      channelB?.send("only-b");
      expect(a.sent).toEqual([{ t: "channel", id: 5, message: "only-a" }]);
      expect(b.sent).toEqual([{ t: "channel", id: 5, message: "only-b" }]);
    } finally {
      await a.web.close();
      await b.web.close();
    }
  });

  test("a closed channel drops later messages", async () => {
    const tab = tabOf();
    try {
      const channel = tab.web.ctx.channel(caller, { [CHANNEL_KEY]: 7 });
      channel?.send("before");
      tab.web.closeChannel(7);
      channel?.send("after");
      expect(tab.sent).toEqual([{ t: "channel", id: 7, message: "before" }]);
    } finally {
      await tab.web.close();
    }
  });

  test("a channel value without a numeric id is not a channel", async () => {
    const tab = tabOf();
    try {
      expect(tab.web.ctx.channel(caller, { [CHANNEL_KEY]: "7" })).toBeNull();
      expect(tab.web.ctx.channel(caller, { other: 7 })).toBeNull();
      expect(tab.web.ctx.channel(caller, undefined)).toBeNull();
    } finally {
      await tab.web.close();
    }
  });

  test("the gateway answers shell_capabilities with the web value", async () => {
    const tab = tabOf();
    try {
      expect(await tab.web.dispatch("shell_capabilities", undefined)).toEqual({
        ok: true,
        value: { kind: "web" },
      });
    } finally {
      await tab.web.close();
    }
  });

  test("a command the table keeps off the gateway is unknown even though a module asks for it", async () => {
    const tab = tabOf();
    try {
      expect(tab.web.requested).toContain("pick_folder_open");
      expect(tab.web.served).not.toContain("pick_folder_open");
      expect(await tab.web.dispatch("pick_folder_open", { scope: "s" })).toEqual({
        ok: false,
        error: "unknown-command",
      });
    } finally {
      await tab.web.close();
    }
  });
});

describe("a closed tab", () => {
  test("dispatches nothing and runs its cleanups once, in reverse registration order", async () => {
    const tab = tabOf();
    const order: string[] = [];
    tab.web.ctx.onQuit(() => {
      order.push("first");
    });
    tab.web.ctx.onQuit(() => {
      order.push("second");
    });
    await tab.web.close();
    await tab.web.close();
    expect(order).toEqual(["second", "first"]);
    expect(await tab.web.dispatch("shell_capabilities", undefined)).toEqual({
      ok: false,
      error: "unknown-command",
    });
  });

  test("drops channel messages after close", async () => {
    const tab = tabOf();
    const channel = tab.web.ctx.channel(caller, { [CHANNEL_KEY]: 3 });
    await tab.web.close();
    channel?.send("late");
    expect(tab.sent).toEqual([]);
  });
});

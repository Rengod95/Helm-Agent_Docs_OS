import { describe, expect, test } from "bun:test";
import { attemptAsync, err, ok } from "@fresnel/contracts";
import type { HostConnection, ThreadSummary } from "@fresnel/contracts/wire";
import { createTestChatCommands, type TestChatDeps } from "../../src/app/test-chat-commands.ts";
import type { CommandError } from "../../src/views/commands.ts";
import { fakeConnection, type Table } from "../state/fake-connection.ts";
import { summary, thr } from "../state/helpers.ts";

// 테스트 챗 명령(createTestChatCommands)을 가짜 연결 위에서 돌린다. 앱의 `withConnection`처럼 callback을 연결에 돌리고,
// 연결이 던지면 `offline`으로 답한다. 호출 목록(`calls`)으로 어떤 메서드가 나갔는지 본다.

type Run = TestChatDeps["withRead"];

const OFFLINE: CommandError = { kind: "offline" };

/** 연결에 callback을 돌리는 withRead/withWrite 대역. 던지면 `offline`으로 답한다 */
function runOn(connection: HostConnection): Run {
  return async (run) => {
    const result = await attemptAsync(() => run(connection));
    return result.ok ? ok(result.value) : err(OFFLINE);
  };
}

const LISTED: ThreadSummary = summary(thr(7), { title: "테스트 대화" });

/** 열기 응답은 새 플러그인 이름(`fresh-plugin`)을 돌려준다. 목록은 그 이름으로 읽혀야 한다 */
function openedTable(): Table {
  return {
    "craftChat.open": () =>
      Promise.resolve({ threadId: thr(7), plugin: "fresh-plugin", reused: false }),
    "craftChat.list": () => Promise.resolve({ threads: [LISTED] }),
  };
}

describe("createTestChatCommands: open", () => {
  test("open creates the chat, lists the returned plugin's test chats, and passes them to known", async () => {
    const fake = fakeConnection(openedTable());
    const seen: ThreadSummary[][] = [];
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: (threads) => {
        seen.push([...threads]);
      },
      leave: () => {},
    });

    const result = await commands.open({ plugin: null, reuse: "new", intent: "check the flow" });

    expect(result).toEqual(ok({ threadId: thr(7), plugin: "fresh-plugin", reused: false }));
    expect(fake.calls).toEqual([
      {
        method: "craftChat.open",
        params: { plugin: null, reuse: "new", intent: "check the flow" },
      },
      { method: "craftChat.list", params: { plugin: "fresh-plugin" } },
    ]);
    expect(seen).toEqual([[LISTED]]);
  });

  test("when open fails, list is not called, known is not called, and the error is returned", async () => {
    const fake = fakeConnection({
      "craftChat.open": () => Promise.reject(new Error("host refused")),
      "craftChat.list": () => Promise.resolve({ threads: [LISTED] }),
    });
    const seen: ThreadSummary[][] = [];
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: (threads) => {
        seen.push([...threads]);
      },
      leave: () => {},
    });

    const result = await commands.open({ plugin: "notes", reuse: "last" });

    expect(result).toEqual(err(OFFLINE));
    expect(fake.calls).toEqual([
      { method: "craftChat.open", params: { plugin: "notes", reuse: "last" } },
    ]);
    expect(seen).toEqual([]);
  });

  test("when list fails, open still returns ok and known is not called", async () => {
    const fake = fakeConnection({
      "craftChat.open": () => Promise.resolve({ threadId: thr(7), plugin: "notes", reused: true }),
      "craftChat.list": () => Promise.reject(new Error("list timed out")),
    });
    const seen: ThreadSummary[][] = [];
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: (threads) => {
        seen.push([...threads]);
      },
      leave: () => {},
    });

    const result = await commands.open({ plugin: "notes", reuse: "last" });

    expect(result).toEqual(ok({ threadId: thr(7), plugin: "notes", reused: true }));
    expect(fake.calls.map((call) => call.method)).toEqual(["craftChat.open", "craftChat.list"]);
    expect(seen).toEqual([]);
  });
});

describe("createTestChatCommands: submitDraft", () => {
  test("submitDraft sends the draft id and maps the result to { itemId }", async () => {
    const fake = fakeConnection({
      "pluginReview.submitDraft": () => Promise.resolve({ itemId: "rv_0001" }),
    });
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: () => {},
      leave: () => {},
    });

    const result = await commands.submitDraft("dr_0007");

    expect(result).toEqual(ok({ itemId: "rv_0001" }));
    expect(fake.calls).toEqual([
      { method: "pluginReview.submitDraft", params: { draftId: "dr_0007" } },
    ]);
  });

  test("a failed submit returns the same error", async () => {
    const fake = fakeConnection({
      "pluginReview.submitDraft": () => Promise.reject(new Error("connection dropped")),
    });
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: () => {},
      leave: () => {},
    });

    const result = await commands.submitDraft("dr_0007");

    expect(result).toEqual(err(OFFLINE));
  });
});

describe("createTestChatCommands: leave", () => {
  test("leave calls the function passed in the deps once and sends nothing to the host", () => {
    let left = 0;
    const fake = fakeConnection({});
    const commands = createTestChatCommands({
      withRead: runOn(fake.connection),
      withWrite: runOn(fake.connection),
      known: () => {},
      leave: () => {
        left += 1;
      },
    });

    commands.leave();

    expect(left).toBe(1);
    expect(fake.calls).toEqual([]);
  });
});

import { expect, test } from "bun:test";
import { err, ok, type Logger } from "@fresnel/contracts";
import type { CraftChatSummary, ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  createCraftChatPort,
  refsOfEvents,
  type CraftChatStore,
} from "../../src/assembly/m4/craft-chat.ts";

// M5c §4.8.2, §4.9.1: 초안을 만들면 테스트 대화를 그 플러그인에 한 번 묶는다. 묶인 뒤, 일반 대화, 없는 대화는 쓰지 않는다.

const ids = fixedIdFactory();
const UNBOUND: ThreadId = ids.next("thr");
const BOUND: ThreadId = ids.next("thr");
const ORDINARY: ThreadId = ids.next("thr");

interface Recorded {
  readonly warnings: string[];
  readonly binds: { threadId: string; plugin: string; requestKey: string }[];
}

function fakeLogger(recorded: Recorded): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      recorded.warnings.push(event);
    },
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

function storeOf(
  rows: Readonly<Record<string, { craftChat?: CraftChatSummary } | undefined>>,
  fail = false,
): { store: CraftChatStore; recorded: Recorded } {
  const recorded: Recorded = { warnings: [], binds: [] };
  const store: CraftChatStore = {
    thread: (threadId) => ok(rows[threadId]),
    setCraftPlugin: (threadId, plugin, requestKey) => {
      recorded.binds.push({ threadId, plugin, requestKey });
      return fail ? err({ kind: "not_craft_chat", threadId }) : ok(undefined);
    },
    recordCraftContext: () => ok(undefined),
    readContextEvents: () => Promise.resolve(ok([])),
  };
  return { store, recorded };
}

function portOver(store: CraftChatStore, recorded: Recorded) {
  let key = 0;
  return createCraftChatPort({
    configDir: "/config",
    store,
    nextKey: () => {
      key += 1;
      return `evt_${key}`;
    },
    logger: fakeLogger(recorded),
  });
}

test("a draft from an unbound test conversation binds that conversation to the draft's plugin once", () => {
  const { store, recorded } = storeOf({ [UNBOUND]: { craftChat: { plugin: null } } });
  portOver(store, recorded).bindDraft(UNBOUND, "notes");
  expect(recorded.binds).toEqual([{ threadId: UNBOUND, plugin: "notes", requestKey: "evt_1" }]);
  expect(recorded.warnings).toEqual([]);
});

test("a bound test conversation, an ordinary one, a missing one and a non-id origin are left alone", () => {
  const { store, recorded } = storeOf({
    [BOUND]: { craftChat: { plugin: "tasks" } },
    [ORDINARY]: undefined,
  });
  const port = portOver(store, recorded);
  port.bindDraft(BOUND, "notes");
  port.bindDraft(ORDINARY, "notes");
  port.bindDraft(ids.next("thr"), "notes");
  port.bindDraft("not-a-thread-id", "notes");
  expect(recorded.binds).toEqual([]);
  expect(recorded.warnings).toEqual([]);
});

test("a failed bind is only recorded: the draft is not undone and nothing is thrown", () => {
  const { store, recorded } = storeOf({ [UNBOUND]: { craftChat: { plugin: null } } }, true);
  expect(() => portOver(store, recorded).bindDraft(UNBOUND, "notes")).not.toThrow();
  expect(recorded.binds.length).toBe(1);
  expect(recorded.warnings).toEqual(["craft.bind_failed"]);
});

test("the plugin folder is <config>/plugins/<name>, the same place a user plugin is read from", () => {
  const { store, recorded } = storeOf({});
  expect(portOver(store, recorded).folderOf("notes")).toBe("/config/plugins/notes");
});

const event = (payload: unknown) => ({ payload });

test("craft context: the refs of the events read in order, once each, and an unreadable event is a failure value", () => {
  const ok1 = refsOfEvents([
    event({ refs: [{ kind: "plugin", name: "demo" }], intent: "고치기" }),
    event({
      refs: [
        { kind: "plugin", name: "demo" },
        { kind: "review", itemId: "rvw_1" },
      ],
      intent: null,
    }),
  ]);
  expect(ok1).toEqual({
    ok: true,
    value: [
      { kind: "plugin", name: "demo" },
      { kind: "review", itemId: "rvw_1" },
    ],
  });
  expect(refsOfEvents([event({ refs: [{ kind: "thread" }], intent: null })])).toEqual({
    ok: false,
    error: { kind: "store", code: "craft_context_unreadable" },
  });
});

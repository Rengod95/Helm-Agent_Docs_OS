import { expect, test } from "bun:test";
import {
  CapabilityError,
  type AttachmentAddOutputValue,
  type CallOptions,
  type Notice,
  type StatusItem,
  type StatusListOutputValue,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { WireParams } from "@xeon/contracts/wire";
import { createDialogWirePort } from "../../src/assembly/dialog-wire.ts";
import type {
  AttachmentsApi,
  CommandRegistryHolder,
  NotifyApi,
  StatusApi,
} from "../../src/assembly/l2-units.ts";

// M3-REQ-16: 호스트는 상태줄 스냅숏과 첨부 추가를 호출자 `host`로, thread가 있으면 그 문맥을 달아 능력에 넘긴다. 능력 오류는 실패 값이고
// 결함은 그대로 던진다. 처리기 쪽 오류 옮김은 test/handlers/dialog.test.ts다.

const ids = fixedIdFactory(640);
const THREAD = ids.next("thr");
const SIGNAL = new AbortController().signal;

const ITEM: StatusItem = { id: "core.turn", text: "대기", tone: "normal", order: 100 };
const ADDED: AttachmentAddOutputValue = {
  attachment: {
    kind: "text",
    name: "note.txt",
    mime: "text/plain",
    size: 5,
    blob: null,
    path: "/work/note.txt",
    url: null,
    image: null,
  },
  parts: [{ type: "text", text: "<attachment>hello</attachment>" }],
};

interface Seen {
  readonly input: unknown;
  readonly options: CallOptions | undefined;
}

function holderWith(options: {
  readonly status?: (seen: Seen) => Promise<StatusListOutputValue>;
  readonly attachments?: (seen: Seen) => Promise<AttachmentAddOutputValue>;
  readonly seen: Seen[];
}): CommandRegistryHolder {
  const status: StatusApi = {
    setItem: () => Promise.reject(new Error("setItem is not part of the fake")),
    clearItem: () => Promise.reject(new Error("clearItem is not part of the fake")),
    list: (input, callOptions) => {
      const seen: Seen = { input, options: callOptions };
      options.seen.push(seen);
      return options.status === undefined
        ? Promise.resolve({ items: [ITEM] })
        : options.status(seen);
    },
  };
  const attachments: AttachmentsApi = {
    add: (input, callOptions) => {
      const seen: Seen = { input, options: callOptions };
      options.seen.push(seen);
      return options.attachments === undefined ? Promise.resolve(ADDED) : options.attachments(seen);
    },
  };
  return {
    current: undefined,
    api: undefined,
    status,
    attachments,
    notify: undefined,
    notifyListeners: new Set(),
  };
}

function capabilityError(
  capability: `${string}.${string}`,
  method: string,
  code: string,
  message: string,
): CapabilityError {
  return new CapabilityError({ capability, method, code, message, retryable: false });
}

test("without a status or attachment service both calls are unavailable", async () => {
  const port = createDialogWirePort({
    holder: {
      current: undefined,
      api: undefined,
      status: undefined,
      attachments: undefined,
      notify: undefined,
      notifyListeners: new Set(),
    },
  });
  expect(await port.statusList(THREAD, SIGNAL)).toEqual({
    ok: false,
    error: { kind: "unavailable" },
  });
  expect(
    await port.attachmentsAdd({ source: { kind: "url", url: "https://example.com/a" } }, SIGNAL),
  ).toEqual({
    ok: false,
    error: { kind: "unavailable" },
  });
});

test("statusList asks the service with the thread as the host's context and returns the items", async () => {
  const seen: Seen[] = [];
  const port = createDialogWirePort({ holder: holderWith({ seen }) });
  expect(await port.statusList(THREAD, SIGNAL)).toEqual({ ok: true, value: { items: [ITEM] } });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.input).toEqual({});
  expect(seen[0]?.options?.signal).toBe(SIGNAL);
  expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
});

test("attachmentsAdd passes the source alone, with the thread as context when one is given", async () => {
  const seen: Seen[] = [];
  const port = createDialogWirePort({ holder: holderWith({ seen }) });
  const source: WireParams<"attachments.add">["source"] = { kind: "path", path: "/work/note.txt" };
  expect(await port.attachmentsAdd({ threadId: THREAD, source, _meta: {} }, SIGNAL)).toEqual({
    ok: true,
    value: ADDED,
  });
  expect(await port.attachmentsAdd({ source }, SIGNAL)).toEqual({ ok: true, value: ADDED });
  expect(seen.map((call) => call.input)).toEqual([{ source }, { source }]);
  expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  expect(seen[1]?.options?.context).toEqual({ caller: { kind: "host" } });
  expect(seen[1]?.options?.signal).toBe(SIGNAL);
});

test("a capability error becomes a rejection with its code and message, cut to 200 characters", async () => {
  const long = "x".repeat(300);
  const port = createDialogWirePort({
    holder: holderWith({
      seen: [],
      attachments: () =>
        Promise.reject(capabilityError("dialog.attachments", "add", "attachment_too_large", long)),
      status: () =>
        Promise.reject(capabilityError("dialog.status", "list", "invalid_input", "no thread")),
    }),
  });
  const attached = await port.attachmentsAdd({ source: { kind: "path", path: "/w/big" } }, SIGNAL);
  expect(attached).toEqual({
    ok: false,
    error: { kind: "rejected", code: "attachment_too_large", message: "x".repeat(200) },
  });
  expect(await port.statusList(THREAD, SIGNAL)).toEqual({
    ok: false,
    error: { kind: "rejected", code: "invalid_input", message: "no thread" },
  });
});

test("a failure that is not a capability error is a defect and is thrown again", async () => {
  const port = createDialogWirePort({
    holder: holderWith({
      seen: [],
      status: () => Promise.reject(new TypeError("broken service")),
    }),
  });
  const caught = await port.statusList(THREAD, SIGNAL).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(TypeError);
});

// M3-REQ-16: 알림 목록은 `notify.list`로 부르고, 알림 전달 구독은 서비스가 나타날 때 붙는다(늦은 채움). 서비스가 사라지면 뗀다.

const NOTICE: Notice = {
  kind: "completed",
  title: "작업이 끝났다",
  body: null,
  seq: 7,
  sourceType: "turn.completed",
};

type Listener = (threadId: ThreadId, notice: Notice) => void;

function emptyHolder(): CommandRegistryHolder {
  return {
    current: undefined,
    api: undefined,
    status: undefined,
    attachments: undefined,
    notify: undefined,
    notifyListeners: new Set(),
  };
}

/** 알림 서비스 대역. `list`는 호출을 기록하고 NOTICE 하나를 돌려주며, `subscribe`는 구독자를 `subscribers`에 모은다 */
function notifyService(seen: Seen[], subscribers: Set<Listener>): NotifyApi {
  return {
    emit: () => Promise.reject(new Error("emit is not part of the fake")),
    list: (input, callOptions) => {
      seen.push({ input, options: callOptions });
      return Promise.resolve({ notices: [NOTICE], nextSeq: 7 });
    },
    subscribe: (_filter, listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
}

/** 홀더의 알림 자리를 바꾸고 등록된 리스너를 부른다(브리지 확장이 `publishNotify`로 하는 일) */
function setNotify(holder: CommandRegistryHolder, api: NotifyApi | undefined): void {
  holder.notify = api;
  for (const sync of Array.from(holder.notifyListeners)) sync();
}

test("without a notify service notify.list is unavailable", async () => {
  const port = createDialogWirePort({ holder: emptyHolder() });
  expect(await port.notifyList({ afterSeq: 0 }, SIGNAL)).toEqual({
    ok: false,
    error: { kind: "unavailable" },
  });
});

test("notifyList passes afterSeq, kinds and limit to the service, the thread as context, and not _meta", async () => {
  const seen: Seen[] = [];
  const holder = emptyHolder();
  holder.notify = notifyService(seen, new Set());
  const port = createDialogWirePort({ holder });
  expect(await port.notifyList({ afterSeq: 3, kinds: ["completed"], limit: 5 }, SIGNAL)).toEqual({
    ok: true,
    value: { notices: [NOTICE], nextSeq: 7 },
  });
  expect(await port.notifyList({ threadId: THREAD, afterSeq: 0, _meta: {} }, SIGNAL)).toEqual({
    ok: true,
    value: { notices: [NOTICE], nextSeq: 7 },
  });
  expect(seen.map((call) => call.input)).toEqual([
    { afterSeq: 3, kinds: ["completed"], limit: 5 },
    { afterSeq: 0 },
  ]);
  expect(seen[0]?.options?.context).toEqual({ caller: { kind: "host" } });
  expect(seen[0]?.options?.signal).toBe(SIGNAL);
  expect(seen[1]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
});

test("a notify.list capability error becomes a rejection with its code", async () => {
  const holder = emptyHolder();
  holder.notify = {
    ...notifyService([], new Set()),
    list: () =>
      Promise.reject(capabilityError("dialog.notify", "list", "invalid_input", "bad list")),
  };
  const port = createDialogWirePort({ holder });
  expect(await port.notifyList({ afterSeq: 0 }, SIGNAL)).toEqual({
    ok: false,
    error: { kind: "rejected", code: "invalid_input", message: "bad list" },
  });
});

test("subscribeNotices attaches when the service appears later and detaches when it goes away", async () => {
  const holder = emptyHolder();
  const port = createDialogWirePort({ holder });
  const heard: { threadId: ThreadId; notice: Notice }[] = [];
  const subscribers = new Set<Listener>();
  const off = port.subscribeNotices((threadId, notice) => {
    heard.push({ threadId, notice });
  });
  // 서비스가 아직 없다: 구독자는 아무도 붙지 않는다
  expect(subscribers.size).toBe(0);

  // 서비스가 나타나면 구독이 붙는다
  setNotify(holder, notifyService([], subscribers));
  expect(subscribers.size).toBe(1);
  for (const listener of Array.from(subscribers)) listener(THREAD, NOTICE);
  expect(heard).toEqual([{ threadId: THREAD, notice: NOTICE }]);

  // 서비스가 사라지면 붙은 구독을 뗀다
  setNotify(holder, undefined);
  expect(subscribers.size).toBe(0);

  // 다시 나타나면 다시 붙고, 구독을 풀면 뗀다
  setNotify(holder, notifyService([], subscribers));
  expect(subscribers.size).toBe(1);
  off();
  expect(subscribers.size).toBe(0);
});

test("subscribeNotices with the service already present delivers each notice once, and two subscribers share one service subscription", async () => {
  const holder = emptyHolder();
  const subscribers = new Set<Listener>();
  holder.notify = notifyService([], subscribers);
  const port = createDialogWirePort({ holder });
  const first: Notice[] = [];
  const second: Notice[] = [];
  const offFirst = port.subscribeNotices((_threadId, notice) => {
    first.push(notice);
  });
  const offSecond = port.subscribeNotices((_threadId, notice) => {
    second.push(notice);
  });
  expect(subscribers.size).toBe(1);
  for (const listener of Array.from(subscribers)) listener(THREAD, NOTICE);
  expect(first).toEqual([NOTICE]);
  expect(second).toEqual([NOTICE]);
  offFirst();
  expect(subscribers.size).toBe(1);
  offSecond();
  expect(subscribers.size).toBe(0);
});

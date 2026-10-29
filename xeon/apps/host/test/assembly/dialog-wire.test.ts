import { expect, test } from "bun:test";
import {
  CapabilityError,
  type AttachmentAddOutputValue,
  type CallOptions,
  type StatusItem,
  type StatusListOutputValue,
} from "@xeon/contracts/capabilities";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { WireParams } from "@xeon/contracts/wire";
import { createDialogWirePort } from "../../src/assembly/dialog-wire.ts";
import type {
  AttachmentsApi,
  CommandRegistryHolder,
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

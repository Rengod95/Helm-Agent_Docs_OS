import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  WIRE_ERRORS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
} from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";
import { userText } from "../conversation/fixtures/pi-messages.ts";

// M3-REQ-16, M3-REQ-19. 값을 왕복해 견주고, 거부 값을 확인한다.
const THREAD = rawId("thr", 1);
const STORE = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
function parsed(schema: Parameters<typeof parse>[0], value: unknown): unknown {
  const result = parse(schema, roundTrip(value));
  return result.ok ? result.value : undefined;
}

const notice = {
  kind: "approval_waiting",
  title: "승인 대기",
  body: null,
  seq: 12,
  sourceType: "approval.requested",
};

describe("status.list, attachments.add, notify.list", () => {
  test("status.list returns the status items of a thread", () => {
    const method = WIRE_METHODS["status.list"];
    expect(parsed(method.params, { threadId: THREAD })).toEqual({ threadId: THREAD });
    const result = { items: [{ id: "core.turn", text: "작업 중", tone: "busy", order: 10 }] };
    expect(parsed(method.result, result)).toEqual(result);
    expect(parse(method.params, {}).ok).toBe(false);
    expect(parse(method.result, { items: [{ id: "bad", text: "x" }] }).ok).toBe(false);
  });

  test("attachments.add takes a source and returns parts for turn.start", () => {
    const method = WIRE_METHODS["attachments.add"];
    for (const source of [
      { kind: "path", path: "a.png" },
      { kind: "data", data: "aGk=", mime: "image/png", name: "p.png" },
      { kind: "url", url: "https://example.com/a" },
    ]) {
      const params = { threadId: THREAD, source };
      expect(parsed(method.params, params)).toEqual(params);
    }
    expect(parse(method.params, { source: { kind: "url", url: "ftp://x" } }).ok).toBe(false);
    const result = {
      attachment: {
        kind: "file",
        name: "a.txt",
        mime: "text/plain",
        size: 3,
        blob: null,
        path: "/w/a.txt",
        url: null,
        image: null,
      },
      parts: [{ type: "text", text: "abc" }],
    };
    expect(parsed(method.result, result)).toEqual(result);
    expect(parse(method.result, { ...result, parts: [] }).ok).toBe(false);
  });

  test("notify.list pages notices after a seq", () => {
    const method = WIRE_METHODS["notify.list"];
    const params = { threadId: THREAD, afterSeq: 0, kinds: ["completed", "error"], limit: 50 };
    expect(parsed(method.params, params)).toEqual(params);
    expect(parse(method.params, { afterSeq: 0, kinds: ["other"] }).ok).toBe(false);
    expect(parse(method.params, { afterSeq: 0, kinds: [] }).ok).toBe(false);
    const result = { notices: [notice], nextSeq: 12 };
    expect(parsed(method.result, result)).toEqual(result);
    expect(parse(method.result, { notices: [{ ...notice, seq: 0 }], nextSeq: 1 }).ok).toBe(false);
  });

  test("notify.delivered is a server notification carrying the notice", () => {
    const { params, stage } = WIRE_NOTIFICATIONS["notify.delivered"];
    expect(stage).toBe("M3");
    const valid = { threadId: THREAD, notice, deliveredAt: "2026-10-28T12:00:00Z" };
    expect(parsed(params, valid)).toEqual(valid);
    expect(parsed(params, { ...valid, threadId: null })).toEqual({ ...valid, threadId: null });
    expect(parse(params, { ...valid, deliveredAt: "yesterday" }).ok).toBe(false);
  });
});

describe("reconnect and service additions (M3-REQ-19)", () => {
  test("thread.open can return the item list with asOfSeq", () => {
    const method = WIRE_METHODS["thread.open"];
    const params = { threadId: THREAD, mode: "observe", includeItems: true, limit: 100 };
    expect(parsed(method.params, params)).toEqual(params);
    expect(parse(method.params, { ...params, limit: 501 }).ok).toBe(false);
    const position = { storeId: STORE, seq: 7 };
    const plain = { threadId: THREAD, role: "observer", position };
    expect(parsed(method.result, plain)).toEqual(plain);
    const item = {
      itemId: rawId("itm", 1),
      status: "completed",
      kind: "user",
      message: userText,
      requestId: null,
    };
    const withItems = { ...plain, items: [item], hasMore: false, asOfSeq: 7 };
    expect(parsed(method.result, withItems)).toEqual(withItems);
    expect(parse(method.result, { ...withItems, asOfSeq: -1 }).ok).toBe(false);
  });

  test("host.status shows safe mode and host.authFailed names a reason without the token", () => {
    const status = {
      mode: "service",
      pid: 10,
      startedAt: "2026-10-28T12:00:00Z",
      connections: 1,
      liveTurns: 0,
      idleShutdownAt: null,
      safeMode: true,
    };
    expect(parsed(WIRE_METHODS["host.status"].result, status)).toEqual(status);
    const { safeMode: _safeMode, ...without } = status;
    expect(parse(WIRE_METHODS["host.status"].result, without).ok).toBe(true);
    const details = WIRE_ERRORS["host.authFailed"].details;
    if (details === undefined) throw new Error("details expected");
    expect(parse(details, { reason: "missing" }).ok).toBe(true);
    expect(parse(details, { reason: "invalid" }).ok).toBe(true);
    expect(parse(details, { reason: "invalid", token: "x" }).ok).toBe(false);
  });
});

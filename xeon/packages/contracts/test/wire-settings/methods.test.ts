import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  WIRE_PROTOCOL_VERSION,
} from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";
import { userText } from "../conversation/fixtures/pi-messages.ts";
import { PAYLOAD_FIXTURES } from "../records/fixtures/payloads.ts";

const STORE = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = rawId("thr", 1);

const names = Object.keys(WIRE_METHODS);

describe("WIRE_METHODS", () => {
  test("has the 27 methods of the spec table with their stages", () => {
    expect(names).toHaveLength(27);
    const stageOf = Object.fromEntries(Object.entries(WIRE_METHODS).map(([n, s]) => [n, s.stage]));
    const m1 = Object.keys(stageOf).filter((n) => stageOf[n] === "M1");
    expect(m1.toSorted()).toEqual(
      ["events.subscribe", "host.hello", "settings.get", "thread.create", "turn.start"].toSorted(),
    );
    expect(names.filter((n) => stageOf[n] === "M2")).toHaveLength(22);
  });

  test("every row carries both schemas, since and status", () => {
    for (const spec of Object.values(WIRE_METHODS)) {
      expect(spec.params).toBeDefined();
      expect(spec.result).toBeDefined();
      expect(spec.since).toBe("0.1.0");
      expect(spec.status).toBe("active");
    }
  });

  test("notification tables", () => {
    expect(Object.keys(WIRE_NOTIFICATIONS)).toEqual([
      "events.batch",
      "events.ended",
      "stream.chunk",
    ]);
    expect(Object.keys(WIRE_CLIENT_NOTIFICATIONS)).toEqual([
      "$/cancelRequest",
      "$/connectionReset",
    ]);
    expect(WIRE_CLIENT_NOTIFICATIONS["$/cancelRequest"].stage).toBe("M1");
  });
});

describe("M1 method schemas", () => {
  test("host.hello", () => {
    const { params, result } = WIRE_METHODS["host.hello"];
    const hello = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "xeon-cli", version: "0.0.0", kind: "cli" },
    };
    expect(parse(params, hello).ok).toBe(true);
    expect(
      parse(params, { ...hello, experimental: ["thread.fork"], auth: { token: "t" } }).ok,
    ).toBe(true);
    expect(parse(params, { ...hello, client: { ...hello.client, kind: "tv" } }).ok).toBe(false);
    expect(parse(params, { ...hello, protocolVersion: "1" }).ok).toBe(false);
    const answer = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      server: { name: "xeon-host", version: "0.0.0" },
      storeId: STORE,
      transport: "in-process",
      features: [{ name: "turn.start", status: "active", since: "0.1.0" }],
      experimental: [],
    };
    expect(parse(result, answer).ok).toBe(true);
    expect(parse(result, { ...answer, transport: "pigeon" }).ok).toBe(false);
  });

  test("thread.create", () => {
    const { params, result } = WIRE_METHODS["thread.create"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { workspace: "/work", title: "t" }).ok).toBe(true);
    expect(parse(params, { title: "" }).ok).toBe(false);
    expect(parse(result, { threadId: THREAD, position: { storeId: STORE, seq: 1 } }).ok).toBe(true);
  });

  test("turn.start", () => {
    const { params, result } = WIRE_METHODS["turn.start"];
    expect(parse(params, { threadId: THREAD, input: "hi" }).ok).toBe(true);
    expect(
      parse(params, {
        threadId: THREAD,
        input: [
          { type: "text", text: "see" },
          { type: "image", data: "aGk=", mimeType: "image/png" },
        ],
        requestId: "req-1",
      }).ok,
    ).toBe(true);
    expect(parse(params, { threadId: THREAD }).ok).toBe(false);
    expect(parse(params, { threadId: "thr_x", input: "hi" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, input: "hi", requestId: "" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, input: "hi", requestId: "x".repeat(65) }).ok).toBe(
      false,
    );
    expect(parse(params, { threadId: THREAD, input: 5 }).ok).toBe(false);
    expect(parse(result, { turnId: rawId("trn", 1) }).ok).toBe(true);
  });

  test("events.subscribe", () => {
    const { params, result } = WIRE_METHODS["events.subscribe"];
    expect(parse(params, { from: "head" }).ok).toBe(true);
    expect(
      parse(params, { from: { storeId: STORE, seq: 0 }, filter: { kindPrefixes: ["item."] } }).ok,
    ).toBe(true);
    expect(parse(params, { from: 0 }).ok).toBe(false);
    expect(
      parse(result, { sub: "s1", start: 0, headSeq: 3, storeId: STORE, mode: "replaying" }).ok,
    ).toBe(true);
  });

  test("settings.get", () => {
    const { params, result } = WIRE_METHODS["settings.get"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { keys: ["l1.loop.maxSteps"], threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { keys: ["nope"] }).ok).toBe(false);
    const effective = {
      key: "l1.loop.maxSteps",
      value: 5,
      source: { scope: "default" },
      locked: false,
      shadowed: [],
      runtimeChange: "live",
      pendingUntil: null,
      deprecated: false,
    };
    expect(parse(result, { settings: [effective] }).ok).toBe(true);
    expect(parse(result, { settings: [{ ...effective, locked: "no" }] }).ok).toBe(false);
  });
});

describe("M2 method schemas are written out", () => {
  test("settings.set and settings.reset share a result", () => {
    expect(WIRE_METHODS["settings.set"].result).toBe(WIRE_METHODS["settings.reset"].result);
    const set = WIRE_METHODS["settings.set"].params;
    expect(parse(set, { key: "l1.loop.maxSteps", value: null, scope: "user" }).ok).toBe(true);
    expect(parse(set, { key: "l1.loop.maxSteps", value: 1, scope: "everywhere" }).ok).toBe(false);
    const reset = WIRE_METHODS["settings.reset"].params;
    expect(parse(reset, { key: "l1.loop.maxSteps", scope: "session", threadId: THREAD }).ok).toBe(
      true,
    );
    expect(parse(reset, { key: "l1.loop.maxSteps", scope: "session", value: 1 }).ok).toBe(false);
  });

  test("thread.close and thread.delete share params and have an empty result", () => {
    const close = WIRE_METHODS["thread.close"];
    expect(close.params).toBe(WIRE_METHODS["thread.delete"].params);
    expect(parse(close.result, {}).ok).toBe(true);
    expect(parse(close.result, { extra: 1 }).ok).toBe(false);
  });

  test("approval.respond", () => {
    const { params } = WIRE_METHODS["approval.respond"];
    expect(
      parse(params, { approvalId: rawId("evt", 1), decision: "allow", remember: "thread" }).ok,
    ).toBe(true);
    expect(
      parse(params, {
        approvalId: rawId("evt", 1),
        decision: "answer",
        answer: { q1: { selected: ["a"], text: "x" } },
      }).ok,
    ).toBe(true);
    // 질문 응답은 질문 id → { selected, text? }다. 문자열 하나나 AskAnswer 배열 모양은 받지 않는다
    expect(
      parse(params, { approvalId: rawId("evt", 1), decision: "answer", answer: { q1: "x" } }).ok,
    ).toBe(false);
    expect(parse(params, { approvalId: rawId("evt", 1), decision: "maybe" }).ok).toBe(false);
  });

  test("thread.read returns items with the position they reflect", () => {
    const { params, result } = WIRE_METHODS["thread.read"];
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, limit: 500, before: rawId("itm", 9) }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, limit: 0 }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, limit: 501 }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, before: "nope" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, mode: "write" }).ok).toBe(false);
    const item = {
      itemId: rawId("itm", 1),
      status: "completed",
      kind: "user",
      message: userText,
      requestId: null,
    };
    const position = { storeId: STORE, seq: 12 };
    expect(parse(result, { threadId: THREAD, items: [item], position, hasMore: false }).ok).toBe(
      true,
    );
    expect(parse(result, { threadId: THREAD, items: [], position, hasMore: true }).ok).toBe(true);
    // position과 hasMore는 빠질 수 없다. 빠지면 UI가 이어 붙일 자리를 모른다
    expect(parse(result, { threadId: THREAD, items: [item], hasMore: false }).ok).toBe(false);
    expect(parse(result, { threadId: THREAD, items: [item], position }).ok).toBe(false);
    expect(
      parse(result, { threadId: THREAD, items: [item], position: { seq: 12 }, hasMore: false }).ok,
    ).toBe(false);
    expect(
      parse(result, {
        threadId: THREAD,
        items: [{ ...item, kind: "assistant" }],
        position,
        hasMore: false,
      }).ok,
    ).toBe(false);
  });

  test("approval.list returns approval.requested payloads with the position they reflect", () => {
    const { params, result } = WIRE_METHODS["approval.list"];
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, {}).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, extra: 1 }).ok).toBe(false);
    const request = PAYLOAD_FIXTURES["approval.requested"];
    const position = { storeId: STORE, seq: 30 };
    const entry = { approvalId: rawId("evt", 7), seq: 21, request };
    expect(parse(result, { approvals: [entry], position }).ok).toBe(true);
    expect(parse(result, { approvals: [], position }).ok).toBe(true);
    expect(parse(result, { approvals: [entry] }).ok).toBe(false);
    expect(parse(result, { approvals: [{ ...entry, seq: -1 }], position }).ok).toBe(false);
    expect(parse(result, { approvals: [{ ...entry, request: {} }], position }).ok).toBe(false);
    expect(
      parse(result, { approvals: [{ approvalId: entry.approvalId, request }], position }).ok,
    ).toBe(false);
  });

  test("secret methods carry no value field", () => {
    for (const name of [
      "secret.meta",
      "secret.remove",
      "secret.test",
      "secret.beginEntry",
      "secret.beginReveal",
    ] as const) {
      const params = WIRE_METHODS[name].params;
      expect(parse(params, { name: "github-token", action: "add", value: "plain" }).ok).toBe(false);
    }
    expect(
      parse(WIRE_METHODS["secret.beginEntry"].params, { name: "github-token", action: "rotate" })
        .ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["secret.test"].params, { name: "GitHub" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["secret.beginReveal"].params, { name: "github-token" }).ok).toBe(
      true,
    );
    expect(parse(WIRE_METHODS["secret.beginReveal"].result, { started: true }).ok).toBe(true);
    expect(parse(WIRE_METHODS["secret.beginReveal"].result, { started: true, value: "x" }).ok).toBe(
      false,
    );
    expect(parse(WIRE_METHODS["secret.list"].params, { meta: true, usage: false }).ok).toBe(true);
  });

  test("thread.list returns summaries with the ThreadSummaryRow fields", () => {
    const { result, params } = WIRE_METHODS["thread.list"];
    const summary = {
      threadId: THREAD,
      title: "hello",
      status: "idle",
      workspace: "/work/app",
      createdAt: "2026-10-23T01:00:00Z",
      updatedAt: "2026-10-23T01:05:00Z",
      headSeq: 42,
      forkedFrom: { threadId: rawId("thr", 2), eventId: rawId("evt", 3) },
      resumable: {
        turnId: rawId("trn", 1),
        runningSince: "2026-10-23T01:04:00Z",
        resumeAttempts: 1,
      },
      queuedInputs: 0,
      pendingApprovals: 2,
    };
    expect(parse(result, { threads: [summary], nextCursor: null }).ok).toBe(true);
    expect(parse(result, { threads: [], nextCursor: "c1" }).ok).toBe(true);
    expect(
      parse(result, {
        threads: [{ ...summary, resumable: null, workspace: null, title: null, forkedFrom: null }],
        nextCursor: null,
      }).ok,
    ).toBe(true);
    // 열려 있던 원소는 더 이상 받지 않는다
    expect(parse(result, { threads: [{ anything: 1 }], nextCursor: null }).ok).toBe(false);
    expect(parse(result, { threads: [{ ...summary, headSeq: -1 }], nextCursor: null }).ok).toBe(
      false,
    );
    expect(
      parse(result, { threads: [{ ...summary, status: "paused" }], nextCursor: null }).ok,
    ).toBe(false);
    expect(
      parse(result, { threads: [{ ...summary, updatedAt: 1_700_000_000 }], nextCursor: null }).ok,
    ).toBe(false);
    expect(parse(result, { threads: [{ ...summary, extra: 1 }], nextCursor: null }).ok).toBe(false);
    expect(parse(params, { workspace: "/work/app", limit: 50 }).ok).toBe(true);
  });

  test("host.shutdown and host.status", () => {
    expect(
      parse(WIRE_METHODS["host.shutdown"].params, { reason: "user", deadlineMs: 3000 }).ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["host.shutdown"].params, { reason: "boredom" }).ok).toBe(false);
    expect(
      parse(WIRE_METHODS["host.status"].result, {
        mode: "service",
        pid: 10,
        startedAt: "2026-10-21T00:00:00.000Z",
        connections: 1,
        liveTurns: 0,
        idleShutdownAt: null,
      }).ok,
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  WIRE_PROTOCOL_VERSION,
} from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";

const STORE = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = rawId("thr", 1);

const names = Object.keys(WIRE_METHODS);

describe("WIRE_METHODS", () => {
  test("has the 24 methods of the spec table with their stages", () => {
    expect(names).toHaveLength(24);
    const stageOf = Object.fromEntries(Object.entries(WIRE_METHODS).map(([n, s]) => [n, s.stage]));
    const m1 = Object.keys(stageOf).filter((n) => stageOf[n] === "M1");
    expect(m1.toSorted()).toEqual(
      ["events.subscribe", "host.hello", "settings.get", "thread.create", "turn.start"].toSorted(),
    );
    expect(names.filter((n) => stageOf[n] === "M2")).toHaveLength(19);
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
      parse(params, { approvalId: rawId("evt", 1), decision: "answer", answer: { text: "x" } }).ok,
    ).toBe(true);
    expect(parse(params, { approvalId: rawId("evt", 1), decision: "maybe" }).ok).toBe(false);
  });

  test("secret methods carry no value field", () => {
    for (const name of [
      "secret.meta",
      "secret.remove",
      "secret.test",
      "secret.beginEntry",
    ] as const) {
      const params = WIRE_METHODS[name].params;
      expect(parse(params, { name: "github-token", action: "add", value: "plain" }).ok).toBe(false);
    }
    expect(
      parse(WIRE_METHODS["secret.beginEntry"].params, { name: "github-token", action: "rotate" })
        .ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["secret.test"].params, { name: "GitHub" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["secret.list"].params, { meta: true, usage: false }).ok).toBe(true);
  });

  test("thread.list leaves the summary open until M2", () => {
    const { result } = WIRE_METHODS["thread.list"];
    expect(parse(result, { threads: [{ anything: 1 }], nextCursor: null }).ok).toBe(true);
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

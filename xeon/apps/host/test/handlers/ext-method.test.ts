import { expect, test } from "bun:test";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type {
  ExtMethodCallOutcome,
  ExtMethodCallRequest,
} from "../../src/handlers/m4/ext-method.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { isRecord, rawClient } from "../fixtures/raw-client.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 확장 메서드 wire(`ext.<확장>.<동사>`): 닫힌 표 밖의 이름이 X 포트로 가고, 결과마다 정해진 JSON-RPC 응답이 나간다(F.wire-settings.spec §4.2).

const THREAD = fixedIdFactory().next("thr");

interface Rig {
  readonly calls: ExtMethodCallRequest[];
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

async function rig(
  outcomeOf: (request: ExtMethodCallRequest) => ExtMethodCallOutcome,
): Promise<Rig> {
  const calls: ExtMethodCallRequest[] = [];
  const host = createFakeHost({
    extMethod: {
      call: (request) => {
        calls.push(request);
        return Promise.resolve(outcomeOf(request));
      },
    },
  });
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  const counter = { value: 0 };
  return {
    calls,
    async request(method, params) {
      counter.value += 1;
      const id = `x${counter.value}`;
      await raw.send({ jsonrpc: "2.0", id, method, params });
      const reply = await raw.response(id);
      if (!isRecord(reply.message)) throw new Error("reply is not an object");
      return reply.message;
    },
    close: () => connection.close(),
  };
}

test("ext-method: a successful call returns the handler result and passes the thread and params apart", async () => {
  const r = await rig(() => ({ kind: "ok", value: { phase: "idle", findings: 0 } }));
  const reply = await r.request("ext.helm.status", { threadId: THREAD, depth: 2 });
  expect(reply).toEqual({ jsonrpc: "2.0", id: "x1", result: { phase: "idle", findings: 0 } });
  expect(
    r.calls.map(({ extension, verb, params, threadId }) => ({ extension, verb, params, threadId })),
  ).toEqual([{ extension: "helm", verb: "status", params: { depth: 2 }, threadId: THREAD }]);
  // thread 없이 부르면 null이다
  await r.request("ext.helm.status", {});
  expect(r.calls[1]?.threadId).toBeNull();
  await r.close();
});

test("ext-method: a threadId that is not a thread id is invalidParams and never reaches the port", async () => {
  const r = await rig(() => ({ kind: "ok", value: {} }));
  const reply = await r.request("ext.helm.status", { threadId: "nope" });
  expect(reply).toMatchObject({
    error: {
      code: -32602,
      data: {
        kind: "jsonrpc.invalidParams",
        details: { issues: [{ path: "/threadId", message: "must be a thread id" }] },
      },
    },
  });
  expect(r.calls).toEqual([]);
  await r.close();
});

test("ext-method: each failure outcome maps to its exact JSON-RPC error", async () => {
  const outcomes: Record<string, ExtMethodCallOutcome> = {
    "ext.a.notfound": { kind: "not_found" },
    "ext.a.off": { kind: "extension_off" },
    "ext.a.badparams": {
      kind: "params_invalid",
      issues: [{ path: "/inquiryId", message: "Expected string" }],
    },
    "ext.a.badresult": { kind: "result_invalid", issues: [{ path: "", message: "x" }] },
    "ext.a.threw": { kind: "threw", message: "boom" },
    "ext.a.slow": { kind: "timeout", budgetMs: 10000 },
    "ext.a.cancelled": { kind: "aborted" },
    "ext.a.list": { kind: "ok", value: [1, 2] },
  };
  const r = await rig(
    (request) => outcomes[`ext.${request.extension}.${request.verb}`] ?? { kind: "not_found" },
  );
  const errorOf = async (method: string): Promise<unknown> => {
    const reply = await r.request(method, {});
    return reply["error"];
  };
  expect(await errorOf("ext.a.notfound")).toEqual({
    code: -32601,
    message: "jsonrpc.methodNotFound",
    data: {
      kind: "jsonrpc.methodNotFound",
      retryable: false,
      details: { method: "ext.a.notfound" },
    },
  });
  expect(await errorOf("ext.a.off")).toEqual({
    code: 10002,
    message: "extension is off",
    data: { kind: "ext.a.off", retryable: false, details: { verb: "off" } },
  });
  expect(await errorOf("ext.a.badparams")).toEqual({
    code: -32602,
    message: "jsonrpc.invalidParams",
    data: {
      kind: "jsonrpc.invalidParams",
      retryable: false,
      details: { issues: [{ path: "/inquiryId", message: "Expected string" }] },
    },
  });
  expect(await errorOf("ext.a.badresult")).toEqual({
    code: 10001,
    message: "result does not match the declaration",
    data: {
      kind: "ext.a.failed",
      retryable: false,
      details: { verb: "badresult", outcome: "result_invalid" },
    },
  });
  expect(await errorOf("ext.a.threw")).toEqual({
    code: 10001,
    message: "boom",
    data: { kind: "ext.a.failed", retryable: false, details: { verb: "threw", outcome: "threw" } },
  });
  expect(await errorOf("ext.a.slow")).toEqual({
    code: 10001,
    message: "method time budget exceeded",
    data: {
      kind: "ext.a.failed",
      retryable: false,
      details: { verb: "slow", outcome: "timeout", budgetMs: 10000 },
    },
  });
  expect(await errorOf("ext.a.cancelled")).toEqual({
    code: 5001,
    message: "request.cancelled",
    data: { kind: "request.cancelled", retryable: false },
  });
  // 결과가 객체가 아니면 확장 오류다(JSON-RPC 결과는 객체다)
  expect(await errorOf("ext.a.list")).toEqual({
    code: 10001,
    message: "result is not an object",
    data: {
      kind: "ext.a.failed",
      retryable: false,
      details: { verb: "list", outcome: "result_not_object" },
    },
  });
  await r.close();
});

test("ext-method: a core-shaped name that is not in the table is methodNotFound without touching the port", async () => {
  const r = await rig(() => ({ kind: "ok", value: {} }));
  const reply = await r.request("nothing.here", {});
  expect(reply).toMatchObject({ error: { code: -32601 } });
  // `ext.ui.*`, `ext.test.*`는 코어 이름이라 확장 경로로 가지 않는다
  const core = await r.request("ext.ui.unknownverb", {});
  expect(core).toMatchObject({ error: { code: -32601 } });
  expect(r.calls).toEqual([]);
  await r.close();
});

test("ext-method: before hello the call is helloRequired like any other method", async () => {
  const host = createFakeHost();
  const { client } = host.connect();
  const raw = rawClient(client);
  await raw.send({ jsonrpc: "2.0", id: "e1", method: "ext.helm.status", params: {} });
  const reply = await raw.response("e1");
  expect(reply.message).toMatchObject({ error: { code: 1001 } });
});

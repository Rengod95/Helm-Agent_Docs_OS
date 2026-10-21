import type { JsonObject, JsonValue } from "../../conversation/index.ts";
import { WIRE_PROTOCOL_VERSION } from "./version.ts";

// 전송 적합성 케이스(F.wire-settings.plan W14). 데이터만 있다. 케이스를 돌리는 실행기는 쓰는 패키지의 test/에 둔다
// (F.readme §1, review.decisions-2 U-03). 같은 케이스를 in-process 전송과 stdio 전송이 같은 결과로 통과해야 한다(수용 기준 A10).
// 엔진이 모델을 부르지 않아도 되는 케이스만 있다. turn 실행 흐름은 L4.host-service의 scenario 테스트가 맡는다.

/**
 * 앞 단계에서 얻은 값을 가리키는 표지. params나 기대값 안의 `{ "$capture": "<이름>" }`은 그 이름으로 잡아 둔 JSON 값으로 바뀐다.
 * 잡아 두는 쪽은 request 단계의 `capture`(이름 → 결과 안 JSON Pointer)다.
 */
export interface CaptureMarker {
  readonly $capture: string;
}

export type ConformanceExpect =
  | {
      readonly outcome: "result";
      /** result 객체가 이 부분 객체를 포함해야 한다(재귀 부분 일치, 배열은 완전 일치). 생략하면 결과 스키마 검사만 한다 */
      readonly include?: JsonObject;
    }
  | {
      readonly outcome: "error";
      readonly code: number;
      /** WireErrorData.kind */
      readonly kind: string;
      /** data.details가 포함해야 하는 부분 객체 */
      readonly details?: JsonObject;
    };

export type ConformanceStep =
  /** 요청 하나를 보내고 그 id의 응답을 기다린다 */
  | {
      readonly type: "request";
      readonly id: string;
      readonly method: string;
      readonly params: JsonObject;
      readonly expect: ConformanceExpect;
      /** 이름 → result 안 JSON Pointer(RFC 6901). 성공 응답에서만 잡는다 */
      readonly capture?: Readonly<Record<string, string>>;
    }
  /** 규칙을 어긴 프레임을 그대로 보내고 오류 응답을 기다린다. id는 응답에 실려야 하는 id(읽을 수 없으면 null) */
  | {
      readonly type: "raw";
      readonly frame: JsonValue;
      readonly responseId: string | null;
      readonly expect: Extract<ConformanceExpect, { readonly outcome: "error" }>;
    }
  /** 클라이언트 알림 하나를 보낸다. 응답은 없다 */
  | { readonly type: "notify"; readonly method: string; readonly params: JsonObject }
  /** 구독 하나의 events.batch 알림을 caughtUp까지 모아 구간 계약(규칙 1·2)을 검사한다 */
  | {
      readonly type: "expectBatches";
      /** 구독 id를 잡아 둔 이름 */
      readonly sub: string;
      /** 응답의 start를 잡아 둔 이름 */
      readonly start: string;
      /** 받은 이벤트들의 kind에 반드시 들어 있어야 하는 것 */
      readonly includesKinds: readonly string[];
    };

export interface ConformanceCase {
  readonly id: string;
  readonly title: string;
  /** 대응하는 수용 기준(F.wire-settings.spec §9) */
  readonly covers: readonly string[];
  readonly steps: readonly ConformanceStep[];
}

const SOME_THREAD = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OTHER_STORE = "sto_00000000000000000000000000";

const HELLO: ConformanceStep = {
  type: "request",
  id: "r1",
  method: "host.hello",
  params: {
    protocolVersion: WIRE_PROTOCOL_VERSION,
    client: { name: "conformance", version: "0.0.0", kind: "other" },
  },
  expect: { outcome: "result", include: { protocolVersion: WIRE_PROTOCOL_VERSION } },
  capture: { storeId: "/storeId" },
};

function request(
  id: string,
  method: string,
  params: JsonObject,
  expect: ConformanceExpect,
  capture?: Readonly<Record<string, string>>,
): ConformanceStep {
  return capture === undefined
    ? { type: "request", id, method, params, expect }
    : { type: "request", id, method, params, expect, capture };
}

function failure(code: number, kind: string, details?: JsonObject): ConformanceExpect {
  return details === undefined
    ? { outcome: "error", code, kind }
    : { outcome: "error", code, kind, details };
}

export const WIRE_CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    id: "hello-required",
    title: "a request before host.hello is rejected",
    covers: ["A7"],
    steps: [
      request(
        "r1",
        "turn.start",
        { threadId: SOME_THREAD, input: "hi" },
        failure(1001, "host.helloRequired"),
      ),
    ],
  },
  {
    id: "hello-ok",
    title: "host.hello answers with the protocol version and a store id",
    covers: ["A7"],
    steps: [HELLO],
  },
  {
    id: "hello-duplicate",
    title: "a second host.hello is rejected",
    covers: ["A7"],
    steps: [
      HELLO,
      request(
        "r2",
        "host.hello",
        {
          protocolVersion: WIRE_PROTOCOL_VERSION,
          client: { name: "conformance", version: "0.0.0", kind: "other" },
        },
        failure(1002, "host.helloDuplicate"),
      ),
    ],
  },
  {
    id: "hello-version-unsupported",
    title: "a different major version is refused",
    covers: ["A7"],
    steps: [
      request(
        "r1",
        "host.hello",
        {
          protocolVersion: "9.0.0",
          client: { name: "conformance", version: "0.0.0", kind: "other" },
        },
        failure(1003, "protocol.unsupported", { clientVersion: "9.0.0" }),
      ),
    ],
  },
  {
    id: "unknown-method",
    title: "an unknown method is -32601",
    covers: ["A7"],
    steps: [
      HELLO,
      request(
        "r2",
        "nope.nothing",
        {},
        failure(-32601, "jsonrpc.methodNotFound", { method: "nope.nothing" }),
      ),
    ],
  },
  {
    id: "experimental-not-opted-in",
    title: "a method that is not open to this connection is -32601, same as an unknown one",
    covers: ["A7"],
    steps: [
      HELLO,
      // M1 계약에는 experimental 메서드가 없다. 열리지 않은 메서드는 모르는 메서드와 같게 보여야 한다(§4.3 4단계)
      request(
        "r2",
        "thread.experimentalProbe",
        {},
        failure(-32601, "jsonrpc.methodNotFound", { method: "thread.experimentalProbe" }),
      ),
    ],
  },
  {
    id: "invalid-params",
    title: "params that break the method schema are -32602",
    covers: ["A5"],
    steps: [HELLO, request("r2", "turn.start", {}, failure(-32602, "jsonrpc.invalidParams"))],
  },
  {
    id: "params-must-be-object",
    title: "array params are -32602 and the response keeps the request id",
    covers: ["A5"],
    steps: [
      HELLO,
      {
        type: "raw",
        frame: { jsonrpc: "2.0", id: "x1", method: "settings.get", params: [] },
        responseId: "x1",
        expect: { outcome: "error", code: -32602, kind: "jsonrpc.invalidParams" },
      },
    ],
  },
  {
    id: "batch-rejected",
    title: "an array message is -32600 with a null id and the connection stays usable",
    covers: ["A5"],
    steps: [
      HELLO,
      {
        type: "raw",
        frame: [{ jsonrpc: "2.0", id: "x1", method: "settings.get", params: {} }],
        responseId: null,
        expect: { outcome: "error", code: -32600, kind: "jsonrpc.invalidRequest" },
      },
      request("r2", "settings.get", {}, { outcome: "result" }),
    ],
  },
  {
    id: "numeric-id-rejected",
    title: "a numeric request id is -32600",
    covers: ["A5"],
    steps: [
      HELLO,
      {
        type: "raw",
        frame: { jsonrpc: "2.0", id: 1, method: "settings.get", params: {} },
        responseId: null,
        expect: { outcome: "error", code: -32600, kind: "jsonrpc.invalidRequest" },
      },
    ],
  },
  {
    id: "cancel-unknown-ignored",
    title: "$/cancelRequest for an id that is not in flight is ignored",
    covers: [],
    steps: [
      HELLO,
      { type: "notify", method: "$/cancelRequest", params: { id: "nope" } },
      request("r2", "settings.get", {}, { outcome: "result" }),
    ],
  },
  {
    id: "thread-create",
    title: "thread.create returns a thread id and a position in this store",
    covers: [],
    steps: [
      HELLO,
      request(
        "r2",
        "thread.create",
        {},
        { outcome: "result", include: { position: { storeId: { $capture: "storeId" } } } },
        { threadId: "/threadId" },
      ),
    ],
  },
  {
    id: "thread-not-found",
    title: "turn.start on an unknown thread is thread.notFound",
    covers: [],
    steps: [
      HELLO,
      request(
        "r2",
        "turn.start",
        { threadId: SOME_THREAD, input: "hi" },
        failure(3001, "thread.notFound", { threadId: SOME_THREAD }),
      ),
    ],
  },
  {
    id: "settings-get-all",
    title: "settings.get without keys returns the effective settings",
    covers: [],
    steps: [HELLO, request("r2", "settings.get", {}, { outcome: "result" })],
  },
  {
    id: "settings-unknown-key",
    title: "settings.get with an unregistered key is settings.unknownKey",
    covers: [],
    steps: [
      HELLO,
      request(
        "r2",
        "settings.get",
        { keys: ["l1.nope.missing"] },
        failure(3101, "settings.unknownKey", { key: "l1.nope.missing" }),
      ),
    ],
  },
  {
    id: "subscribe-head",
    title: "subscribing from head starts at the current head",
    covers: ["A3"],
    steps: [
      HELLO,
      request(
        "r2",
        "events.subscribe",
        { from: "head" },
        { outcome: "result", include: { storeId: { $capture: "storeId" }, mode: "live" } },
        { sub: "/sub", start: "/start" },
      ),
    ],
  },
  {
    id: "subscribe-replay-from-zero",
    title: "replaying from seq 0 delivers every event once, in order, with contiguous intervals",
    covers: ["A1", "A2"],
    steps: [
      HELLO,
      request("r2", "thread.create", {}, { outcome: "result" }),
      request(
        "r3",
        "events.subscribe",
        { from: { storeId: { $capture: "storeId" }, seq: 0 } },
        { outcome: "result", include: { start: 0 } },
        { sub: "/sub", start: "/start" },
      ),
      { type: "expectBatches", sub: "sub", start: "start", includesKinds: ["thread.started"] },
    ],
  },
  {
    id: "subscribe-store-mismatch",
    title: "a position from another store is replay.outOfRange (storeMismatch)",
    covers: ["A4"],
    steps: [
      HELLO,
      request(
        "r2",
        "events.subscribe",
        { from: { storeId: OTHER_STORE, seq: 0 } },
        failure(2001, "replay.outOfRange", { reason: "storeMismatch" }),
      ),
    ],
  },
  {
    id: "subscribe-ahead-of-head",
    title: "a position past the head is replay.outOfRange (aheadOfHead)",
    covers: ["A4"],
    steps: [
      HELLO,
      request(
        "r2",
        "events.subscribe",
        { from: { storeId: { $capture: "storeId" }, seq: 2_000_000_000 } },
        failure(2001, "replay.outOfRange", { reason: "aheadOfHead" }),
      ),
    ],
  },
];

import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  JsonRpcErrorSchema,
  WIRE_CAPABILITY_ERROR_CODE,
  WIRE_CODE_RANGES,
  WIRE_ERRORS,
  WireError,
  WireErrorDataSchema,
  checkEnvelope,
  codeRangeOf,
  internalJsonRpcError,
  toJsonRpcError,
  toRpcError,
  wireError,
  wireErrorCodeMatchesKind,
} from "../../src/wire-settings/wire/index.ts";

const specs = Object.values(WIRE_ERRORS);

describe("WIRE_ERRORS", () => {
  test("kinds unique", () => {
    expect(new Set(specs.map((s) => s.kind)).size).toBe(specs.length);
    expect(new Set(specs.map((s) => s.code)).size).toBe(specs.length);
    for (const [key, spec] of Object.entries(WIRE_ERRORS)) {
      const kind: string = spec.kind;
      expect(kind).toBe(key);
    }
  });

  test("codes follow the M1 table", () => {
    const codes = Object.fromEntries(specs.map((s) => [s.kind, s.code]));
    expect(codes).toEqual({
      "jsonrpc.parseError": -32700,
      "jsonrpc.invalidRequest": -32600,
      "jsonrpc.methodNotFound": -32601,
      "jsonrpc.invalidParams": -32602,
      internal: -32603,
      "host.helloRequired": 1001,
      "host.helloDuplicate": 1002,
      "protocol.unsupported": 1003,
      "host.authFailed": 1004,
      "replay.outOfRange": 2001,
      "events.subscriptionNotFound": 2002,
      "events.subscriptionLimit": 2003,
      "events.filterInvalid": 2004,
      "thread.notFound": 3001,
      "thread.locked": 3002,
      "turn.busy": 3003,
      "thread.hasForks": 3004,
      "thread.invalidTarget": 3005,
      "thread.cancelledByExtension": 3006,
      "settings.unknownKey": 3101,
      "settings.invalidValue": 3102,
      "settings.scopeNotAllowed": 3103,
      "settings.locked": 3104,
      "settings.secretValue": 3105,
      "request.cancelled": 5001,
      "host.shuttingDown": 5002,
      "store.busy": 5003,
      "store.diskFull": 5004,
      "store.readOnly": 5005,
      "store.io": 5006,
    });
  });

  test("retryable flags follow the table", () => {
    const retryable = specs.filter((s) => s.retryable).map((s) => s.kind);
    expect(retryable).toEqual([
      "internal",
      "thread.locked",
      "turn.busy",
      "host.shuttingDown",
      "store.busy",
    ]);
  });

  test("code ranges stay in the wire-owned blocks", () => {
    for (const spec of specs) {
      const inJsonRpc = spec.code >= -32768 && spec.code <= -32000;
      const inWire = spec.code >= 1000 && spec.code < 6000;
      expect({ kind: spec.kind, ok: inJsonRpc || inWire }).toEqual({ kind: spec.kind, ok: true });
    }
  });

  test("the secret-value error carries only the key", () => {
    const secret = WIRE_ERRORS["settings.secretValue"];
    if (secret.details === undefined) throw new Error("details expected");
    expect(parse(secret.details, { key: "l0.secrets.token" }).ok).toBe(true);
    expect(parse(secret.details, { key: "l0.secrets.token", value: "plain" }).ok).toBe(false);
  });
});

describe("WireError", () => {
  test("wireError builds data from the table", () => {
    const error = wireError("settings.locked", {
      message: "locked by managed",
      details: { key: "l1.loop.maxSteps", lockedBy: "managed" },
    });
    expect(error).toBeInstanceOf(WireError);
    expect(error.code).toBe(3104);
    expect(error.data).toEqual({
      kind: "settings.locked",
      retryable: false,
      details: { key: "l1.loop.maxSteps", lockedBy: "managed" },
    });
    const wire = toJsonRpcError(error);
    expect(parse(JsonRpcErrorSchema, wire).ok).toBe(true);
    expect(wire.message).toBe("locked by managed");
  });

  test("retryAfterMs and traceId are carried when given", () => {
    const wire = toJsonRpcError(
      wireError("host.shuttingDown", {
        retryAfterMs: 500,
        traceId: "t-1",
        details: { retryAfterMs: 500 },
      }),
    );
    expect(wire.data.retryAfterMs).toBe(500);
    expect(wire.data.traceId).toBe("t-1");
    expect(wire.data.retryable).toBe(true);
  });

  test("message defaults to the kind and is cut to 512 characters", () => {
    expect(wireError("turn.busy").message).toBe("turn.busy");
    const long = wireError("turn.busy", { message: "x".repeat(600) });
    expect(toJsonRpcError(long).message).toHaveLength(512);
  });

  test("internal error sanitized", () => {
    const secretish = new Error("database password is hunter2");
    const wire = toRpcError(secretish, "trace-9");
    expect(wire.code).toBe(-32603);
    expect(wire.message).toBe("Internal error");
    expect(wire.data).toEqual({ kind: "internal", retryable: true, traceId: "trace-9" });
    expect(JSON.stringify(wire)).not.toContain("hunter2");
    expect(toRpcError("a string")).toEqual(internalJsonRpcError());
    expect(toRpcError(undefined).message).toBe("Internal error");
  });

  test("a WireError passes through unchanged", () => {
    const error = wireError("thread.notFound", { details: { threadId: "thr_x" } });
    expect(toRpcError(error)).toEqual(toJsonRpcError(error));
  });

  test("error data is open for new fields", () => {
    expect(parse(WireErrorDataSchema, { kind: "x", retryable: false, futureField: 1 }).ok).toBe(
      true,
    );
    const failure = {
      jsonrpc: "2.0",
      id: "r1",
      error: toJsonRpcError(wireError("turn.busy", { details: { turnId: "trn_x" } })),
    };
    expect(checkEnvelope(failure).ok).toBe(true);
  });
});

const name = (code: number): string | null => codeRangeOf(code)?.name ?? null;

describe("error code ranges (W16)", () => {
  test("the table covers the spec ranges in order without overlap", () => {
    expect(WIRE_CODE_RANGES.map((r) => [r.name, r.from, r.to])).toEqual([
      ["jsonrpc", -32768, -32000],
      ["wire.connection", 1000, 1999],
      ["wire.events", 2000, 2999],
      ["core", 3000, 3999],
      ["capability", 4000, 4999],
      ["host", 5000, 5999],
      ["extension", 10000, 19999],
    ]);
  });

  test("codeRangeOf maps edges and outsiders", () => {
    expect(name(-32768)).toBe("jsonrpc");
    expect(name(-32000)).toBe("jsonrpc");
    expect(name(-31999)).toBeNull();
    expect(name(999)).toBeNull();
    expect(name(1000)).toBe("wire.connection");
    expect(name(2999)).toBe("wire.events");
    expect(name(3105)).toBe("core");
    expect(name(WIRE_CAPABILITY_ERROR_CODE)).toBe("capability");
    expect(name(5006)).toBe("host");
    expect(name(6000)).toBeNull();
    expect(name(9999)).toBeNull();
    expect(name(10000)).toBe("extension");
    expect(name(19999)).toBe("extension");
    expect(name(20000)).toBeNull();
    expect(name(1.5)).toBeNull();
    expect(name(Number.NaN)).toBeNull();
  });

  test("every registered error code falls in a range that fits its kind", () => {
    for (const spec of Object.values(WIRE_ERRORS)) {
      expect({ kind: spec.kind, fits: wireErrorCodeMatchesKind(spec.code, spec.kind) }).toEqual({
        kind: spec.kind,
        fits: true,
      });
    }
  });

  test("capability and extension ranges require their kind prefix", () => {
    expect(wireErrorCodeMatchesKind(4000, "cap.web.search.session_limit")).toBe(true);
    expect(wireErrorCodeMatchesKind(4000, "web.session_limit")).toBe(false);
    expect(wireErrorCodeMatchesKind(10001, "ext.helm.phase_invalid")).toBe(true);
    expect(wireErrorCodeMatchesKind(10001, "helm.phase_invalid")).toBe(false);
    expect(wireErrorCodeMatchesKind(7000, "ext.helm.x")).toBe(false);
  });
});

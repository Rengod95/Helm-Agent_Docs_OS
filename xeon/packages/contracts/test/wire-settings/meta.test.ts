import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  TRACEPARENT_PATTERN,
  WIRE_METHODS,
  WireMetaSchema,
  formatTraceparent,
  parseTraceparent,
  withMeta,
} from "../../src/wire-settings/wire/index.ts";
import { Type } from "typebox";
import { rawId } from "../helpers/ids.ts";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const THREAD = rawId("thr", 1);

describe("WireMetaSchema", () => {
  test("accepts the three W3C keys and namespaced keys", () => {
    expect(parse(WireMetaSchema, {}).ok).toBe(true);
    expect(
      parse(WireMetaSchema, {
        traceparent: TRACEPARENT,
        tracestate: "vendor=1",
        baggage: "userId=alice",
        "xeon/clientTime": 1_700_000_000,
        "acme-cli/Build.id": { any: "value" },
      }).ok,
    ).toBe(true);
  });

  test("rejects bare unknown keys and malformed traceparent values", () => {
    expect(parse(WireMetaSchema, { clientTime: 1 }).ok).toBe(false);
    expect(parse(WireMetaSchema, { "Xeon/clientTime": 1 }).ok).toBe(false);
    expect(parse(WireMetaSchema, { "xeon/": 1 }).ok).toBe(false);
    expect(parse(WireMetaSchema, { traceparent: "00-abc" }).ok).toBe(false);
    expect(parse(WireMetaSchema, { traceparent: TRACEPARENT.toUpperCase() }).ok).toBe(false);
    expect(parse(WireMetaSchema, { tracestate: "x".repeat(513) }).ok).toBe(false);
    expect(parse(WireMetaSchema, { baggage: "x".repeat(8193) }).ok).toBe(false);
    expect(new RegExp(TRACEPARENT_PATTERN).test(TRACEPARENT)).toBe(true);
  });
});

describe("traceparent", () => {
  test("parses a W3C example and formats it back", () => {
    const parsed = parseTraceparent(TRACEPARENT);
    expect(parsed).toEqual({
      ok: true,
      value: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", flags: 1 },
    });
    if (!parsed.ok) return;
    expect(formatTraceparent(parsed.value)).toEqual({ ok: true, value: TRACEPARENT });
  });

  test("flags are one byte and print as two hex digits", () => {
    const base = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
    expect(formatTraceparent({ ...base, flags: 0 })).toEqual({
      ok: true,
      value: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    });
    expect(formatTraceparent({ ...base, flags: 255 }).ok).toBe(true);
    expect(formatTraceparent({ ...base, flags: 256 })).toEqual({
      ok: false,
      error: { kind: "malformed" },
    });
    expect(formatTraceparent({ ...base, flags: -1 }).ok).toBe(false);
    expect(formatTraceparent({ ...base, flags: 1.5 }).ok).toBe(false);
  });

  test("rejects malformed text, version ff and all-zero ids", () => {
    expect(parseTraceparent("")).toEqual({ ok: false, error: { kind: "malformed" } });
    expect(parseTraceparent("00-4bf9-00f067aa0ba902b7-01").ok).toBe(false);
    expect(parseTraceparent(`${TRACEPARENT}-extra`).ok).toBe(false);
    expect(parseTraceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toEqual({
      ok: false,
      error: { kind: "unsupported_version", version: "ff" },
    });
    expect(parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`)).toEqual({
      ok: false,
      error: { kind: "zero_id" },
    });
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`).ok).toBe(
      false,
    );
    expect(
      formatTraceparent({ traceId: "0".repeat(32), spanId: "00f067aa0ba902b7", flags: 1 }),
    ).toEqual({ ok: false, error: { kind: "zero_id" } });
  });
});

describe("withMeta and the registry", () => {
  test("adds an optional _meta and keeps the other fields and strictness", () => {
    const schema = withMeta(Type.Object({ name: Type.String() }, { additionalProperties: false }));
    expect(parse(schema, { name: "a" }).ok).toBe(true);
    expect(parse(schema, { name: "a", _meta: { traceparent: TRACEPARENT } }).ok).toBe(true);
    expect(parse(schema, { name: "a", _meta: { traceparent: "bad" } }).ok).toBe(false);
    expect(parse(schema, { name: "a", other: 1 }).ok).toBe(false);
    expect(parse(schema, { _meta: {} }).ok).toBe(false);
  });

  test("every request method accepts _meta with a traceparent", () => {
    const meta = { _meta: { traceparent: TRACEPARENT } };
    const bad = { _meta: { traceparent: "nope" } };
    const samples: Readonly<Record<string, Record<string, unknown>>> = {
      "host.status": {},
      "thread.close": { threadId: THREAD },
      "secret.test": { name: "github-token" },
      "settings.get": {},
    };
    for (const [name, params] of Object.entries(samples)) {
      const spec = Object.entries(WIRE_METHODS).find(([key]) => key === name)?.[1];
      expect(spec).toBeDefined();
      if (spec === undefined) continue;
      expect({ name, ok: parse(spec.params, params).ok }).toEqual({ name, ok: true });
      expect({ name, ok: parse(spec.params, { ...params, ...meta }).ok }).toEqual({
        name,
        ok: true,
      });
      expect({ name, ok: parse(spec.params, { ...params, ...bad }).ok }).toEqual({
        name,
        ok: false,
      });
    }
  });

  test("every registry row has _meta among its params properties (every variant for a union)", () => {
    for (const [name, spec] of Object.entries(WIRE_METHODS)) {
      const variants: unknown = Reflect.get(spec.params, "anyOf");
      const schemas: readonly unknown[] = Array.isArray(variants) ? variants : [spec.params];
      const hasMeta = schemas.map((schema) => {
        const properties: unknown =
          typeof schema === "object" && schema !== null
            ? Reflect.get(schema, "properties")
            : undefined;
        return typeof properties === "object" && properties !== null && "_meta" in properties;
      });
      expect({ name, hasMeta }).toEqual({ name, hasMeta: schemas.map(() => true) });
    }
  });

  test("methods sharing a params shape share the extended schema object", () => {
    expect(WIRE_METHODS["thread.close"].params).toBe(WIRE_METHODS["thread.delete"].params);
    expect(WIRE_METHODS["secret.remove"].params).toBe(WIRE_METHODS["secret.beginReveal"].params);
  });
});

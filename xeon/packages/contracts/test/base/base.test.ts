import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  Bug,
  EpochMsSchema,
  Nullable,
  assertNever,
  canonicalJson,
  err,
  ok,
  parse,
  type Result,
} from "../../src/index.ts";

describe("result", () => {
  test("ok and err carry their payload", () => {
    const a: Result<number, string> = ok(1);
    const b: Result<number, string> = err("x");
    expect(a).toEqual({ ok: true, value: 1 });
    expect(b).toEqual({ ok: false, error: "x" });
  });
});

describe("bug", () => {
  test("Bug is an Error named Bug", () => {
    const bug = new Bug("boom");
    expect(bug).toBeInstanceOf(Error);
    expect(bug.name).toBe("Bug");
  });

  test("assertNever throws Bug with the offending value as cause", () => {
    try {
      // @ts-expect-error -- 테스트: never 자리에 값을 넘겨 런타임 동작을 확인한다 (eng.typescript.guide TY-14)
      assertNever("x", "here");
      throw new Error("not reached");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Bug);
      if (caught instanceof Bug) {
        expect(caught.message).toContain("here");
        expect(caught.cause).toBe("x");
      }
    }
  });
});

describe("parse", () => {
  const Schema = Type.Object(
    { name: Type.String({ maxLength: 4 }), n: Type.Optional(Type.Integer()) },
    { additionalProperties: false },
  );

  test("returns the same value on success without modifying it", () => {
    const input = { name: "abc" };
    const result = parse(Schema, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(input);
    expect(input).toEqual({ name: "abc" });
  });

  test("returns a ParseError instead of throwing", () => {
    const result = parse(Schema, { name: "toolong", extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("parse");
      expect(result.error.schemaId).toBeUndefined();
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  test("keeps the schema $id in the error", () => {
    const withId = Type.Object({ a: Type.String({ maxLength: 1 }) }, { $id: "WithId" });
    const result = parse(withId, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.schemaId).toBe("WithId");
  });

  test("caps the issue list at 20", () => {
    const many = Type.Array(Type.Integer(), { maxItems: 100 });
    const result = parse(
      many,
      Array.from({ length: 50 }, () => "x"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("Nullable and EpochMsSchema", () => {
  test("Nullable accepts null and the inner value", () => {
    const schema = Nullable(Type.String({ maxLength: 3 }));
    expect(parse(schema, null).ok).toBe(true);
    expect(parse(schema, "ab").ok).toBe(true);
    expect(parse(schema, 3).ok).toBe(false);
  });

  test("EpochMsSchema accepts ms integers in range only", () => {
    expect(parse(EpochMsSchema, 1_700_000_000_000).ok).toBe(true);
    expect(parse(EpochMsSchema, 1_700_000_000_000.5).ok).toBe(false);
    expect(parse(EpochMsSchema, 5).ok).toBe(false);
  });
});

describe("canonicalJson", () => {
  test("sorts keys, drops undefined members, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: undefined })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
  });

  test("sorts keys by UTF-16 code unit", () => {
    expect(canonicalJson({ b: 1, B: 2, é: 3 })).toBe('{"B":2,"b":1,"é":3}');
  });

  test("rejects values with no JSON form", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(Bug);
    expect(() => canonicalJson([undefined])).toThrow(Bug);
    expect(() => canonicalJson(1n)).toThrow(Bug);
  });
});

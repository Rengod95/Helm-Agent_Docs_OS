import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { parse } from "../../src/index.ts";
import {
  CapabilityError,
  CapabilityErrorDataSchema,
  COMMON_ERROR_CODES,
  DEFAULT_RETRYABLE,
  defineCapability,
  isCapabilityError,
  isCapabilityId,
  isSemVer,
  isSemVerRange,
  serviceKey,
  validateCapability,
  type AnyCapabilityDef,
  type CapabilityErrorData,
} from "../../src/capabilities/index.ts";
import { WebSearch, WebSearchKey } from "./fixtures/web-search.ts";
import { loose, makeDef } from "./helpers.ts";

function codes(def: AnyCapabilityDef): string[] {
  return validateCapability(def).map((issue) => issue.code);
}

describe("required fields", () => {
  test("an empty definition reports each missing piece", () => {
    const empty: AnyCapabilityDef = {
      id: "web.search",
      version: "1.0.0",
      description: "",
      service: { methods: {} },
      tools: [],
    };
    expect(codes(empty)).toEqual(["description_empty", "service_empty"]);
  });
});

function withVersion(version: string): AnyCapabilityDef {
  return loose(makeDef("web.search", []), { version });
}

function withId(id: string): AnyCapabilityDef {
  return loose(makeDef("web.search", []), { id });
}

describe("version format", () => {
  test("1.0, v1.0.0 and 01.0.0 are version_invalid; 1.0.0-rc.1 passes", () => {
    for (const bad of ["1.0", "v1.0.0", "01.0.0"]) {
      expect(codes(withVersion(bad))).toContain("version_invalid");
    }
    expect(codes(withVersion("1.0.0-rc.1"))).not.toContain("version_invalid");
    expect(isSemVer("1.0.0-rc.1")).toBe(true);
    expect(isSemVer("1.0")).toBe(false);
  });
});

describe("id format and reserved prefixes", () => {
  test("malformed ids are id_invalid", () => {
    for (const bad of ["web", "Web.search", "a.b.c.d.e", "web..search"]) {
      expect(codes(withId(bad))).toContain("id_invalid");
    }
  });
  test("reserved first segments are id_reserved", () => {
    for (const reserved of ["ext.foo", "core.x", "grp.helm", "x.foo"]) {
      expect(codes(withId(reserved))).toContain("id_reserved");
    }
  });
  test("good ids pass", () => {
    for (const good of ["web.search", "acme-notes.sync", "knowledge.memory.read"]) {
      const found = codes(withId(good));
      expect(found).not.toContain("id_invalid");
      expect(found).not.toContain("id_reserved");
      expect(isCapabilityId(good)).toBe(true);
    }
    expect(isCapabilityId("web")).toBe(false);
  });
});

describe("semver ranges", () => {
  test("allowed forms only", () => {
    for (const ok of ["1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3", ">=1.2.3 <2.0.0"]) {
      expect(isSemVerRange(ok)).toBe(true);
    }
    for (const bad of [
      "",
      "*",
      "1.x",
      "^1.2",
      "1.2.3 || 2.0.0",
      ">1.2.3",
      "<=1.2.3",
      ">=1.2.3 <2",
    ]) {
      expect(isSemVerRange(bad)).toBe(false);
    }
  });
});

describe("defineCapability and serviceKey", () => {
  test("defineCapability returns the same reference", () => {
    const input = {
      id: "web.ping",
      version: "1.0.0",
      description: "ping",
      service: {
        methods: {
          ping: {
            description: "ping",
            input: Type.Object({}, { additionalProperties: false }),
            output: Type.Object({}, { additionalProperties: false }),
          },
        },
      },
      tools: [],
    } as const;
    expect(defineCapability(input)).toBe(input);
  });

  test("serviceKey carries only capability and version", () => {
    const key = serviceKey(WebSearch);
    expect(key).toEqual({ capability: "web.search", version: "1.0.0" });
    expect(WebSearchKey).toEqual(key);
    expect(Object.keys(key).toSorted()).toEqual(["capability", "version"]);
  });
});

describe("CapabilityError", () => {
  const data: CapabilityErrorData = {
    capability: "web.search",
    method: "search",
    code: "rate_limited",
    message: "slow down",
    retryable: DEFAULT_RETRYABLE.rate_limited,
    retryAfterMs: 1500,
    detail: { limit: 10 },
  };

  test("data passes the schema and the error exposes it", () => {
    const error = new CapabilityError(data);
    expect(error).toBeInstanceOf(Error);
    expect(isCapabilityError(error)).toBe(true);
    expect(isCapabilityError(new Error("x"))).toBe(false);
    expect(error.message).toBe("slow down");
    expect(error.data).toBe(data);
    expect(parse(CapabilityErrorDataSchema, JSON.parse(JSON.stringify(error.data))).ok).toBe(true);
  });

  test("schema rejects a bad code", () => {
    expect(parse(CapabilityErrorDataSchema, { ...data, code: "Rate-Limited" }).ok).toBe(false);
  });

  test("default retryable table covers every common code", () => {
    expect(DEFAULT_RETRYABLE.rate_limited).toBe(true);
    for (const code of COMMON_ERROR_CODES) expect(typeof DEFAULT_RETRYABLE[code]).toBe("boolean");
    expect(Object.keys(DEFAULT_RETRYABLE).length).toBe(COMMON_ERROR_CODES.length);
  });
});

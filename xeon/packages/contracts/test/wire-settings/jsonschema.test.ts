import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  buildCatalog,
  checkSettingWrite,
  settingsJsonSchema,
  validateSettingValue,
  type SettingCatalog,
  type SettingDef,
} from "../../src/wire-settings/settings/index.ts";
import { parseJson } from "../../src/base/index.ts";
import { boolDef, intDef, secretDef } from "./helpers.ts";

const choice: SettingDef = intDef({
  key: "l1.models.thinking",
  type: Type.String(),
  default: "medium",
  range: { enum: ["off", "low", "medium", "high"] },
  allowedScopes: ["managed", "user", "session"],
  ui: { tab: "models", widget: "select", order: 2, label: "추론 수준" },
  runtimeChange: "live",
});

const userOnly: SettingDef = boolDef({
  key: "l4.appearance.sendUsage",
  layer: "L4",
  allowedScopes: ["managed", "user"],
  ui: { tab: "appearance", widget: "toggle", order: 1, label: "사용량 전송" },
});

const old: SettingDef = intDef({
  key: "l1.loop.oldSteps",
  deprecated: { since: "0.2.0", replacedBy: "l1.loop.maxSteps", note: "renamed" },
});

function catalog(): SettingCatalog {
  const result = buildCatalog([
    { owner: "loop", namespace: "l1.loop", defs: [intDef(), old] },
    { owner: "models", namespace: "l1.models", defs: [choice, secretDef()] },
    { owner: "ui", namespace: "l4.appearance", defs: [userOnly] },
    { owner: "web", namespace: "l2.web", defs: [boolDef()] },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.catalog;
}

function properties(
  document: Readonly<Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const props: unknown = document["properties"];
  if (typeof props !== "object" || props === null) throw new Error("no properties");
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, Object(value)]));
}

describe("settingsJsonSchema output", () => {
  test("draft 2020-12 header, flat object, unknown keys preserved", () => {
    const document = settingsJsonSchema(catalog(), { scope: "user" });
    expect(document["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(document["type"]).toBe("object");
    expect(document["additionalProperties"]).toBe(true);
    expect(document["x-xeon-unknownKeys"]).toBe("warn");
    expect(Object.keys(properties(document))).toContain("l1.loop.maxSteps");
  });

  test("range is merged into the property schema", () => {
    const props = properties(settingsJsonSchema(catalog(), { scope: "user" }));
    expect(props["l1.loop.maxSteps"]).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 10_000,
      default: 0,
    });
    expect(props["l1.models.thinking"]).toMatchObject({ enum: ["off", "low", "medium", "high"] });
  });

  test("a key not allowed in the scope is absent (S7)", () => {
    const project = properties(settingsJsonSchema(catalog(), { scope: "project" }));
    expect(project["l4.appearance.sendUsage"]).toBeUndefined();
    expect(project["l1.models.thinking"]).toBeUndefined();
    expect(project["l1.loop.maxSteps"]).toBeDefined();
    const user = properties(settingsJsonSchema(catalog(), { scope: "user" }));
    expect(user["l4.appearance.sendUsage"]).toBeDefined();
  });

  test("a secret has no default and keeps the SecretRef pattern (S1)", () => {
    const props = properties(settingsJsonSchema(catalog(), { scope: "user" }));
    const key = props["l1.models.apiKey"];
    expect(key).toBeDefined();
    expect(key?.["default"]).toBeUndefined();
    expect(key?.["pattern"]).toBe("^secret://[a-z][a-z0-9-]{1,63}$");
  });

  test("x-xeon metadata and deprecation", () => {
    const props = properties(settingsJsonSchema(catalog(), { scope: "user" }));
    expect(props["l1.loop.maxSteps"]?.["x-xeon"]).toMatchObject({
      layer: "L1",
      runtimeChange: "nextTurn",
      secret: false,
      since: "0.1.0",
    });
    expect(props["l1.loop.oldSteps"]).toMatchObject({ deprecated: true });
    expect(String(props["l1.loop.oldSteps"]?.["description"])).toContain("l1.loop.maxSteps");
    const without = properties(
      settingsJsonSchema(catalog(), { scope: "user", includeDeprecated: false }),
    );
    expect(without["l1.loop.oldSteps"]).toBeUndefined();
  });

  test("deterministic output (S10): same input, same bytes, sorted keys", () => {
    const a = JSON.stringify(settingsJsonSchema(catalog(), { scope: "user" }));
    const b = JSON.stringify(settingsJsonSchema(catalog(), { scope: "user" }));
    expect(a).toBe(b);
    const keys = Object.keys(properties(settingsJsonSchema(catalog(), { scope: "user" })));
    expect(keys).toEqual(keys.toSorted());
  });
});

/** 시드 고정 의사 난수(LCG). 테스트 결과가 실행마다 같다. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function sampleValue(next: () => number): unknown {
  const pick = Math.floor(next() * 12);
  switch (pick) {
    case 0:
      return Math.floor(next() * 20_000) - 5000;
    case 1:
      return next() * 100;
    case 2:
      return ["off", "low", "medium", "high", "extreme", ""][Math.floor(next() * 6)];
    case 3:
      return next() < 0.5;
    case 4:
      return null;
    case 5:
      return [1, 2, 3];
    case 6:
      return { a: 1 };
    case 7:
      return "secret://exa-key";
    case 8:
      return "plain";
    case 9:
      return 10_000 + Math.floor(next() * 3) - 1;
    case 10:
      return -1 + Math.floor(next() * 3);
    default:
      return String(Math.floor(next() * 10));
  }
}

describe("same verdict as validateSettingValue (S6)", () => {
  const cat = catalog();
  const document = settingsJsonSchema(cat, { scope: "user" });
  const props = properties(document);

  test("1,000 generated values per kind of key give identical verdicts", () => {
    const next = lcg(20_261_021);
    for (const def of cat.values()) {
      const property = props[def.key];
      if (property === undefined) continue;
      const schema = Type.Unsafe(property);
      for (let i = 0; i < 1000; i += 1) {
        const value = sampleValue(next);
        expect(Value.Check(schema, value)).toBe(validateSettingValue(def, value).ok);
      }
    }
  });

  test("CLI-style parsing (JSON first, string on failure) gives the same verdict as the file check", () => {
    const def = intDef();
    const raws = ["5", "10001", "-1", "abc", "true", "1.5", "[1]", '"5"', "null", "0"];
    for (const raw of raws) {
      const decoded = parseJson(raw);
      const parsed: unknown = decoded.ok ? decoded.value : raw;
      const write = checkSettingWrite(cat, [], def.key, "user", parsed);
      expect(write.ok).toBe(validateSettingValue(def, parsed).ok);
      const schema = Type.Unsafe(props[def.key] ?? {});
      expect(write.ok).toBe(Value.Check(schema, parsed));
    }
  });
});

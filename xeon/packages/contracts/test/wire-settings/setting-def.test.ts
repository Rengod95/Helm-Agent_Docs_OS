import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { parse } from "../../src/index.ts";
import { SecretRef } from "../../src/capabilities/index.ts";
import { CORE_EVENT_CATALOG } from "../../src/records/index.ts";
import {
  SETTING_KEY_PATTERN,
  SettingDefWireSchema,
  SettingKeySchema,
  SettingScopeSchema,
  checkSettingDef,
  toSettingDefWire,
  type SettingDefRule,
} from "../../src/wire-settings/settings/index.ts";
import { boolDef, intDef, secretDef } from "./helpers.ts";

function rules(issues: readonly { readonly rule: SettingDefRule }[]): SettingDefRule[] {
  return issues.map((issue) => issue.rule);
}

describe("checkSettingDef", () => {
  test("well-formed definitions pass", () => {
    expect(checkSettingDef(intDef())).toEqual([]);
    expect(checkSettingDef(secretDef())).toEqual([]);
    expect(checkSettingDef(boolDef())).toEqual([]);
  });

  test("D1: key pattern and prefix must match the layer", () => {
    expect(rules(checkSettingDef(intDef({ key: "l1.loop.x", layer: "L2" })))).toEqual(["D1"]);
    expect(rules(checkSettingDef(intDef({ key: "Loop.max", layer: "L1" })))).toContain("D1");
    expect(rules(checkSettingDef(intDef({ key: "l9.loop.maxSteps" })))).toContain("D1");
    // ext. 키는 층을 접두로 정하지 않는다
    expect(checkSettingDef(boolDef({ key: "ext.web-exa.enabled", layer: "L2" }))).toEqual([]);
  });

  test("D2: a secret cannot have a default", () => {
    expect(rules(checkSettingDef(secretDef({ default: "secret://x-key" })))).toContain("D2");
  });

  test("D3: a secret's type must be the SecretRef string schema, and its widget secret", () => {
    expect(rules(checkSettingDef(secretDef({ type: Type.String({ maxLength: 10 }) })))).toContain(
      "D3",
    );
    expect(
      rules(
        checkSettingDef(
          secretDef({ ui: { tab: "secrets", widget: "text", order: 1, label: "API 키" } }),
        ),
      ),
    ).toContain("D3");
    expect(checkSettingDef(secretDef({ type: SecretRef }))).toEqual([]);
  });

  test("D4: the default must satisfy type and range", () => {
    expect(rules(checkSettingDef(intDef({ default: 20_000 })))).toEqual(["D4"]);
    expect(rules(checkSettingDef(intDef({ default: "x" })))).toEqual(["D4"]);
    expect(rules(checkSettingDef(intDef({ default: -1 })))).toEqual(["D4"]);
  });

  test("D5: range min/max order and applicability", () => {
    expect(rules(checkSettingDef(intDef({ range: { min: 5, max: 1 }, default: 3 })))).toContain(
      "D5",
    );
    expect(
      rules(
        checkSettingDef(
          boolDef({
            range: { min: 0 },
            ui: { tab: "tools", widget: "toggle", order: 1, label: "x" },
          }),
        ),
      ),
    ).toContain("D5");
    expect(rules(checkSettingDef(boolDef({ range: { enum: ["a"] } })))).toContain("D5");
  });

  test("D6: the same constraint cannot sit in type and in range", () => {
    expect(
      rules(
        checkSettingDef(
          intDef({ type: Type.Integer({ minimum: 0 }), range: { min: 0, max: 5 }, default: 1 }),
        ),
      ),
    ).toContain("D6");
    expect(
      rules(
        checkSettingDef(
          intDef({
            type: Type.String({ enum: ["a", "b"] }),
            range: { enum: ["a", "b"] },
            default: "a",
            ui: { tab: "models", widget: "select", order: 1, label: "x" },
          }),
        ),
      ),
    ).toContain("D6");
  });

  test("D7: duplicate scopes, and restart settings cannot be session-scoped", () => {
    expect(rules(checkSettingDef(intDef({ allowedScopes: ["user", "user"] })))).toContain("D7");
    expect(
      rules(
        checkSettingDef(intDef({ runtimeChange: "restart", allowedScopes: ["user", "session"] })),
      ),
    ).toContain("D7");
    expect(checkSettingDef(intDef({ runtimeChange: "restart", allowedScopes: ["user"] }))).toEqual(
      [],
    );
  });

  test("D8: widget must fit the type", () => {
    const toggle = { tab: "tools", widget: "toggle", order: 1, label: "x" } as const;
    expect(rules(checkSettingDef(intDef({ ui: toggle })))).toContain("D8");
    const num = { tab: "tools", widget: "number", order: 1, label: "x" } as const;
    expect(rules(checkSettingDef(boolDef({ ui: num })))).toContain("D8");
    const select = { tab: "tools", widget: "select", order: 1, label: "x" } as const;
    expect(rules(checkSettingDef(boolDef({ ui: select })))).toContain("D8");
    const secret = { tab: "secrets", widget: "secret", order: 1, label: "x" } as const;
    expect(rules(checkSettingDef(boolDef({ ui: secret })))).toContain("D8");
    expect(
      checkSettingDef(
        intDef({
          type: Type.String(),
          default: "a",
          range: { enum: ["a", "b"] },
          ui: { tab: "models", widget: "select", order: 1, label: "x" },
        }),
      ),
    ).toEqual([]);
  });
});

describe("keys and scopes", () => {
  test("key pattern", () => {
    for (const good of [
      "l1.loop.maxSteps",
      "l1.models.routing.review",
      "ext.web-exa.apiKey",
      "f.contracts.x",
      "x.primitives.driveLimits",
    ]) {
      expect(parse(SettingKeySchema, good).ok).toBe(true);
    }
    for (const bad of [
      "loop.maxSteps",
      "l1.loop",
      "L1.loop.x",
      "ext.web_exa.x",
      "l1.loop.Max",
      "l5.a.b",
    ]) {
      expect(parse(SettingKeySchema, bad).ok).toBe(false);
    }
    expect(new RegExp(SETTING_KEY_PATTERN).test("l3.helm.driveLimits")).toBe(true);
  });

  test("five scopes", () => {
    for (const scope of ["managed", "user", "project", "local", "session"]) {
      expect(parse(SettingScopeSchema, scope).ok).toBe(true);
    }
    expect(parse(SettingScopeSchema, "default").ok).toBe(false);
  });
});

describe("settings.changed alignment with records", () => {
  test("a SettingKey and every SettingScope pass the SettingsChanged payload schema", () => {
    const entry = CORE_EVENT_CATALOG.find((e) => e.kind === "settings.changed");
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    for (const scope of ["managed", "user", "project", "local", "session"]) {
      expect(parse(entry.payload, { key: intDef().key, scope, value: 5 }).ok).toBe(true);
    }
    expect(parse(SettingKeySchema, intDef().key).ok).toBe(true);
  });
});

describe("SettingDefWire", () => {
  test("toSettingDefWire produces a valid wire form with a JSON Schema type", () => {
    const wire = toSettingDefWire(intDef());
    expect(parse(SettingDefWireSchema, JSON.parse(JSON.stringify(wire))).ok).toBe(true);
    expect(wire.type).toMatchObject({ type: "integer" });
    expect(wire.default).toBe(0);
    expect(toSettingDefWire(secretDef()).default).toBeUndefined();
  });
});

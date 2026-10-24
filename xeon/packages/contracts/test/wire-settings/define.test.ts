import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  SettingDefError,
  buildCatalog,
  defineSettings,
  type SettingDef,
} from "../../src/wire-settings/settings/index.ts";
import { boolDef, intDef } from "./helpers.ts";

const loopSettings = defineSettings("l1.loop", {
  maxSteps: {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "budgets",
      widget: "number",
      order: 10,
      label: "턴당 최대 단계",
      help: "0이면 상한 없음",
      unit: "단계",
    },
    since: "0.1.0",
  },
});

function secretWithDefault(): unknown {
  return defineSettings("l1.models", {
    apiKey: {
      type: Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$", maxLength: 75 }),
      default: "secret://k-1",
      secret: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      ui: { tab: "secrets", widget: "secret", order: 1, label: "키" },
      since: "0.1.0",
    },
  });
}

describe("defineSettings", () => {
  test("builds full keys and fills layer from the namespace", () => {
    const def = loopSettings.defs.maxSteps;
    expect(def.key).toBe("l1.loop.maxSteps");
    expect(def.layer).toBe("L1");
    expect(loopSettings.namespace).toBe("l1.loop");
    // 키가 리터럴 타입으로 추론된다: 다른 키를 대입하면 컴파일 오류
    const typed: "l1.loop.maxSteps" = def.key;
    expect(typed).toBe("l1.loop.maxSteps");
  });

  test("dotted names are allowed", () => {
    const group = defineSettings("l1.models", {
      "routing.review": {
        type: Type.String({ maxLength: 64 }),
        default: "auto",
        runtimeChange: "live",
        allowedScopes: ["user"],
        since: "0.1.0",
      },
    });
    expect(group.defs["routing.review"].key).toBe("l1.models.routing.review");
  });

  test("rule violations throw SettingDefError (S1: secret default)", () => {
    expect(secretWithDefault).toThrow(SettingDefError);
    try {
      secretWithDefault();
    } catch (caught) {
      expect(caught).toBeInstanceOf(SettingDefError);
      if (caught instanceof SettingDefError) {
        expect(caught.key).toBe("l1.models.apiKey");
        expect(caught.issues.map((i) => i.rule)).toContain("D2");
      }
    }
  });

  test("range violations (S2) throw", () => {
    expect(() =>
      defineSettings("l1.loop", {
        bad: {
          type: Type.Integer(),
          range: { min: 5, max: 1 },
          runtimeChange: "live",
          allowedScopes: ["user"],
          since: "0.1.0",
        },
      }),
    ).toThrow(SettingDefError);
    expect(() =>
      defineSettings("l1.loop", {
        bad: {
          type: Type.Integer(),
          default: 99,
          range: { min: 0, max: 10 },
          runtimeChange: "live",
          allowedScopes: ["user"],
          since: "0.1.0",
        },
      }),
    ).toThrow(SettingDefError);
  });

  test("bad namespace or name throws", () => {
    expect(() =>
      // @ts-expect-error -- 잘못된 네임스페이스는 타입 검사 단계에서도 거부된다 (F.wire-settings.spec §3.8.3)
      defineSettings("l1", {}),
    ).toThrow(SettingDefError);
    expect(() =>
      defineSettings("l1.loop", {
        Bad_Name: {
          type: Type.Boolean(),
          runtimeChange: "live",
          allowedScopes: ["user"],
          since: "0.1.0",
        },
      }),
    ).toThrow(SettingDefError);
  });
});

describe("buildCatalog", () => {
  const loop: readonly SettingDef[] = [loopSettings.defs.maxSteps];

  test("merges groups into a map", () => {
    const result = buildCatalog([
      { owner: "core-loop", namespace: "l1.loop", defs: loop },
      { owner: "cap-web", namespace: "l2.web", defs: [boolDef()] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.catalog.keys()].toSorted()).toEqual(["l1.loop.maxSteps", "l2.web.enabled"]);
    }
  });

  test("two owners defining the same key produce duplicateKey (S9)", () => {
    const result = buildCatalog([
      { owner: "core-loop", namespace: "l1.loop", defs: loop },
      { owner: "other", namespace: "l1.loop", defs: [intDef()] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        code: "duplicateKey",
        key: "l1.loop.maxSteps",
        owners: ["core-loop", "other"],
      });
    }
  });

  test("an extension group defining an l1. key is foreignNamespace (S9)", () => {
    const result = buildCatalog([
      { owner: "ext:web-exa", namespace: "ext.web-exa", defs: [intDef()] },
    ]);
    expect(result).toEqual({
      ok: false,
      issues: [{ code: "foreignNamespace", key: "l1.loop.maxSteps", owner: "ext:web-exa" }],
    });
  });

  test("an extension may define keys under its own ext. namespace", () => {
    const result = buildCatalog([
      {
        owner: "ext:web-exa",
        namespace: "ext.web-exa",
        defs: [boolDef({ key: "ext.web-exa.verbose" })],
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test("rule violations come back as invalidDef", () => {
    const result = buildCatalog([
      {
        owner: "core-loop",
        namespace: "l1.loop",
        defs: [intDef({ allowedScopes: ["user", "user"] })],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatchObject({ code: "invalidDef", rule: "D7" });
  });

  test("D9: replacedBy must be in the same catalog", () => {
    const old = intDef({
      key: "l1.loop.oldSteps",
      deprecated: { since: "0.2.0", replacedBy: "l1.loop.maxSteps" },
    });
    const ok = buildCatalog([{ owner: "core-loop", namespace: "l1.loop", defs: [old, ...loop] }]);
    expect(ok.ok).toBe(true);
    const missing = buildCatalog([{ owner: "core-loop", namespace: "l1.loop", defs: [old] }]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues[0]).toMatchObject({ code: "invalidDef", rule: "D9" });
  });
});

import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import {
  DEFAULT_MODELS_SETTINGS,
  DEFAULT_RETRY_SETTINGS,
  MODELS_SETTING_DEFS,
  modelsSettingsOf,
} from "../src/index.ts";

// L1.models.plan §5 settings_defs_pass_checks
function row(apiKeyRef: string | null): unknown {
  return [{ id: "anthropic", enabled: true, apiKeyRef, baseUrl: null }];
}

describe("settings_defs_pass_checks", () => {
  test("declares exactly the M1, M2 and M3 account keys of spec section 6", () => {
    expect(MODELS_SETTING_DEFS.map((def) => def.key).toSorted()).toEqual(
      [
        "l1.models.default",
        "l1.models.routing.review",
        "l1.models.routing.summary",
        "l1.models.routing.subagent",
        "l1.models.routing.judge",
        "l1.models.routing.search",
        "l1.models.groupRouting",
        "l1.models.thinkingLevel",
        "l1.models.thinkingBudgets",
        "l1.models.allowedModels",
        "l1.models.deniedModels",
        "l1.models.providers",
        "l1.models.cacheRetention",
        "l1.models.retry",
        "l1.models.accounts",
        "l1.models.rateLimit",
      ].toSorted(),
    );
  });

  test("every definition passes checkSettingDef and belongs to L1", () => {
    for (const def of MODELS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L1");
    }
  });

  test("builds a catalog without issues", () => {
    const built = buildCatalog([
      { owner: "core-models", namespace: "l1.models", defs: MODELS_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("no definition carries a secret value or a secret flag", () => {
    for (const def of MODELS_SETTING_DEFS) expect(def.secret).toBeUndefined();
  });

  test("defaults match the spec table", () => {
    const defaults = Object.fromEntries(MODELS_SETTING_DEFS.map((def) => [def.key, def.default]));
    expect(defaults).toEqual({
      "l1.models.default": null,
      "l1.models.routing.review": null,
      "l1.models.routing.summary": null,
      "l1.models.routing.subagent": null,
      "l1.models.routing.judge": null,
      "l1.models.routing.search": null,
      "l1.models.groupRouting": {},
      "l1.models.thinkingLevel": "medium",
      "l1.models.thinkingBudgets": {
        minimal: 1024,
        low: 2048,
        medium: 8192,
        high: 16_384,
        xhigh: 32_768,
        max: 32_768,
      },
      "l1.models.allowedModels": [],
      "l1.models.deniedModels": [],
      "l1.models.providers": [],
      "l1.models.cacheRetention": "short",
      "l1.models.retry": { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60_000 },
      "l1.models.accounts": [],
      "l1.models.rateLimit": {},
    });
    expect(defaults["l1.models.retry"]).toEqual(DEFAULT_RETRY_SETTINGS);
  });

  test("the default model setting accepts references and null, and rejects malformed values", () => {
    const def = MODELS_SETTING_DEFS.find((entry) => entry.key === "l1.models.default");
    expect(def).toBeDefined();
    if (def === undefined) return;
    expect(validateSettingValue(def, "anthropic/claude-x:high").ok).toBe(true);
    expect(validateSettingValue(def, null).ok).toBe(true);
    expect(validateSettingValue(def, "anthropic").ok).toBe(false);
  });

  test("provider api key references must be secret references, never literal keys", () => {
    const def = MODELS_SETTING_DEFS.find((entry) => entry.key === "l1.models.providers");
    expect(def).toBeDefined();
    if (def === undefined) return;
    expect(validateSettingValue(def, row("secret://anthropic-key")).ok).toBe(true);
    expect(validateSettingValue(def, row(null)).ok).toBe(true);
    expect(validateSettingValue(def, row("sk-ant-literal-key")).ok).toBe(false);
    expect(validateSettingValue(def, row("$ANTHROPIC_API_KEY")).ok).toBe(false);
  });

  test("retry bounds follow the spec (0 to 10 retries)", () => {
    const def = MODELS_SETTING_DEFS.find((entry) => entry.key === "l1.models.retry");
    expect(def).toBeDefined();
    if (def === undefined) return;
    expect(validateSettingValue(def, { maxRetries: 10, baseDelayMs: 1, maxDelayMs: 1 }).ok).toBe(
      true,
    );
    expect(validateSettingValue(def, { maxRetries: 11, baseDelayMs: 1, maxDelayMs: 1 }).ok).toBe(
      false,
    );
  });
});

function defOf(key: string): (typeof MODELS_SETTING_DEFS)[number] {
  const def = MODELS_SETTING_DEFS.find((entry) => entry.key === key);
  if (def === undefined) throw new Error(`missing definition ${key}`);
  return def;
}

describe("M2 keys", () => {
  test("routing keys take a model reference or null", () => {
    const def = defOf("l1.models.routing.summary");
    expect(validateSettingValue(def, "anthropic/claude-x").ok).toBe(true);
    expect(validateSettingValue(def, null).ok).toBe(true);
    expect(validateSettingValue(def, "claude-x").ok).toBe(false);
  });

  test("groupRouting maps scope id to role to reference", () => {
    const def = defOf("l1.models.groupRouting");
    expect(validateSettingValue(def, { helm: { review: "anthropic/claude-x" } }).ok).toBe(true);
    expect(validateSettingValue(def, { helm: { reviewer: "anthropic/claude-x" } }).ok).toBe(false);
    expect(validateSettingValue(def, { helm: { review: "claude-x" } }).ok).toBe(false);
  });

  test("thinkingLevel is one of the seven levels", () => {
    const def = defOf("l1.models.thinkingLevel");
    expect(validateSettingValue(def, "xhigh").ok).toBe(true);
    expect(validateSettingValue(def, "extreme").ok).toBe(false);
  });

  test("thinkingBudgets needs all six non-negative integers", () => {
    const def = defOf("l1.models.thinkingBudgets");
    expect(validateSettingValue(def, DEFAULT_MODELS_SETTINGS.thinkingBudgets).ok).toBe(true);
    expect(validateSettingValue(def, { minimal: 1 }).ok).toBe(false);
    expect(
      validateSettingValue(def, { ...DEFAULT_MODELS_SETTINGS.thinkingBudgets, low: -1 }).ok,
    ).toBe(false);
  });

  test("cacheRetention accepts none, short and long only", () => {
    const def = defOf("l1.models.cacheRetention");
    expect(validateSettingValue(def, "long").ok).toBe(true);
    expect(validateSettingValue(def, "forever").ok).toBe(false);
  });

  test("allowedModels and deniedModels are string lists", () => {
    expect(validateSettingValue(defOf("l1.models.allowedModels"), ["tape/*"]).ok).toBe(true);
    expect(validateSettingValue(defOf("l1.models.deniedModels"), [1]).ok).toBe(false);
  });
});

describe("modelsSettingsOf", () => {
  test("an empty reader gives the defaults", () => {
    expect(modelsSettingsOf(() => undefined)).toEqual(DEFAULT_MODELS_SETTINGS);
  });

  test("valid values are taken and invalid ones fall back per key", () => {
    const values: Record<string, unknown> = {
      "l1.models.default": "tape/plain",
      "l1.models.routing.review": "tape/other",
      "l1.models.routing.judge": "not a reference",
      "l1.models.thinkingLevel": "high",
      "l1.models.cacheRetention": "forever",
      "l1.models.deniedModels": ["tape/x"],
      "l1.models.groupRouting": { helm: { review: "tape/other" } },
    };
    const settings = modelsSettingsOf((key) => values[key]);
    expect(settings.default).toBe("tape/plain");
    expect(settings.routing).toEqual({ review: "tape/other" });
    expect(settings.thinkingLevel).toBe("high");
    expect(settings.cacheRetention).toBe("short");
    expect(settings.deniedModels).toEqual(["tape/x"]);
    expect(settings.groupRouting).toEqual({ helm: { review: "tape/other" } });
  });
});

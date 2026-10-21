import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { DEFAULT_RETRY_SETTINGS, MODELS_SETTING_DEFS } from "../src/index.ts";

// L1.models.plan §5 settings_defs_pass_checks
function row(apiKeyRef: string | null): unknown {
  return [{ id: "anthropic", enabled: true, apiKeyRef, baseUrl: null }];
}

describe("settings_defs_pass_checks", () => {
  test("declares exactly the M1 keys", () => {
    expect(MODELS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l1.models.default",
      "l1.models.providers",
      "l1.models.retry",
    ]);
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
      "l1.models.providers": [],
      "l1.models.retry": { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60_000 },
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

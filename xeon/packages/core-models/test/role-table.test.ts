import { describe, expect, test } from "bun:test";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { MODEL_ROLES } from "@xeon/contracts/services";
import {
  isModelAllowed,
  matchesModelPattern,
  passableBudgets,
  ROLE_FALLBACK,
  resolveRole,
  type RoutingTable,
} from "../src/role-table.ts";
import { DEFAULT_THINKING_BUDGETS } from "../src/settings.ts";
import { tapePlayer, tapeProvider, tape } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";

const fake = tapeProvider(
  tapePlayer(tape("core-models/role-table", []), { clock: manualClock() }),
  {
    models: [{ id: "plain" }, { id: "thinker", reasoning: true }, { id: "other" }],
  },
);
const catalog = createModels();
catalog.setProvider(fake.provider);

function lookup(provider: string, modelId: string): Model<Api> | undefined {
  return catalog.getModel(provider, modelId);
}

function table(patch: Partial<RoutingTable> = {}): RoutingTable {
  return {
    default: "tape/plain",
    routing: {},
    groupRouting: {},
    thinkingLevel: "medium",
    thinkingBudgets: DEFAULT_THINKING_BUDGETS,
    allowed: [],
    denied: [],
    ...patch,
  };
}

const TABLE = table();

function level(overrides: { ref?: string; thinkingLevel?: "low" }): string | undefined {
  const result = resolveRole({ role: "main", overrides, table: TABLE, lookup });
  return result.ok ? result.value.binding.thinkingLevel : undefined;
}

function kind(t: RoutingTable, ref?: string): string | undefined {
  const result = resolveRole({
    role: "main",
    overrides: ref === undefined ? {} : { ref },
    table: t,
    lookup,
  });
  return result.ok ? undefined : result.error.kind;
}

function judge(t: RoutingTable): { modelId: string; source: string } | undefined {
  const result = resolveRole({ role: "judge", overrides: {}, table: t, lookup });
  return result.ok
    ? { modelId: result.value.binding.modelId, source: result.value.source }
    : undefined;
}

describe("resolve_role_precedence", () => {
  test("the default is used when nothing overrides it", () => {
    const result = resolveRole({ role: "main", overrides: {}, table: TABLE, lookup });
    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: { role: "main", provider: "tape", modelId: "plain", thinkingLevel: "off" },
        source: "default",
        trace: [
          { step: "explicit", ref: null },
          { step: "default", ref: "tape/plain" },
        ],
      },
    });
  });

  test("explicit > group > role > role-fallback > default", () => {
    const full = table({
      default: "tape/plain",
      routing: { review: "tape/other", summary: "tape/other" },
      groupRouting: { helm: { review: "tape/thinker" } },
    });
    const pick = (
      overrides: { ref?: string; scopeId?: string },
      t: RoutingTable = full,
    ): { modelId: string; source: string } | undefined => {
      const result = resolveRole({ role: "review", overrides, table: t, lookup });
      return result.ok
        ? { modelId: result.value.binding.modelId, source: result.value.source }
        : undefined;
    };
    expect(pick({ ref: "tape/plain", scopeId: "helm" })).toEqual({
      modelId: "plain",
      source: "explicit",
    });
    expect(pick({ scopeId: "helm" })).toEqual({ modelId: "thinker", source: "group:helm" });
    expect(pick({})).toEqual({ modelId: "other", source: "role" });
    expect(pick({}, table({ routing: {} }))).toEqual({ modelId: "plain", source: "default" });
  });

  test("judge falls back to review, then main, then the default", () => {
    expect(judge(table({ routing: { review: "tape/other" } }))).toEqual({
      modelId: "other",
      source: "role-fallback",
    });
    expect(judge(table({ routing: { judge: "tape/thinker", review: "tape/other" } }))).toEqual({
      modelId: "thinker",
      source: "role",
    });
    expect(judge(TABLE)).toEqual({ modelId: "plain", source: "default" });
  });

  test("search falls back to summary before main", () => {
    const result = resolveRole({
      role: "search",
      overrides: {},
      table: table({ routing: { summary: "tape/other" } }),
      lookup,
    });
    expect(result.ok && result.value.binding.modelId).toBe("other");
    expect(result.ok && result.value.source).toBe("role-fallback");
  });

  test("the same input gives the same result twice, whatever the key order of the table", () => {
    const reordered: RoutingTable = {
      denied: [],
      allowed: [],
      thinkingBudgets: DEFAULT_THINKING_BUDGETS,
      thinkingLevel: "medium",
      groupRouting: {},
      routing: {},
      default: "tape/plain",
    };
    const a = resolveRole({ role: "judge", overrides: {}, table: TABLE, lookup });
    const b = resolveRole({ role: "judge", overrides: {}, table: reordered, lookup });
    expect(a).toEqual(b);
  });

  test("every role has a fallback chain that ends without cycles", () => {
    for (const role of MODEL_ROLES) {
      expect(ROLE_FALLBACK[role]).not.toContain(role);
    }
    expect(ROLE_FALLBACK.main).toEqual([]);
  });
});

describe("resolve_group_override", () => {
  const grouped = table({
    routing: { review: "tape/other" },
    groupRouting: { helm: { review: "tape/thinker" } },
  });

  test("a group override beats the role table, and an explicit reference beats the group", () => {
    const group = resolveRole({
      role: "review",
      overrides: { scopeId: "helm" },
      table: grouped,
      lookup,
    });
    expect(group.ok && group.value.binding.modelId).toBe("thinker");
    const explicit = resolveRole({
      role: "review",
      overrides: { scopeId: "helm", ref: "tape/plain" },
      table: grouped,
      lookup,
    });
    expect(explicit.ok && explicit.value.binding.modelId).toBe("plain");
  });

  test("a scope that is off is ignored", () => {
    const result = resolveRole({
      role: "review",
      overrides: { scopeId: "helm" },
      table: grouped,
      lookup,
      scopeEnabled: () => false,
    });
    expect(result.ok && result.value.binding.modelId).toBe("other");
    expect(result.ok && result.value.source).toBe("role");
  });

  test("another scope does not see the override", () => {
    const result = resolveRole({
      role: "review",
      overrides: { scopeId: "other-group" },
      table: grouped,
      lookup,
    });
    expect(result.ok && result.value.binding.modelId).toBe("other");
  });
});

describe("thinking level and budget", () => {
  test("overrides.thinkingLevel beats the reference suffix, which beats the table level", () => {
    const thinker = table({ default: "tape/thinker" });
    const at = (overrides: { ref?: string; thinkingLevel?: "low" }): string | undefined => {
      const result = resolveRole({ role: "main", overrides, table: thinker, lookup });
      return result.ok ? result.value.binding.thinkingLevel : undefined;
    };
    expect(at({})).toBe("medium");
    expect(at({ ref: "tape/thinker:high" })).toBe("high");
    expect(at({ ref: "tape/thinker:high", thinkingLevel: "low" })).toBe("low");
    expect(level({ ref: "tape/thinker" })).toBe("medium");
  });

  test("a model without reasoning always resolves to off and has no budget", () => {
    const result = resolveRole({
      role: "main",
      overrides: { ref: "tape/plain:high" },
      table: TABLE,
      lookup,
    });
    expect(result.ok && result.value.binding.thinkingLevel).toBe("off");
    expect(result.ok && result.value.thinkingBudgetTokens).toBeNull();
  });

  test("a reasoning model gets the configured budget of its level", () => {
    const result = resolveRole({
      role: "main",
      overrides: { ref: "tape/thinker:low" },
      table: table({ thinkingBudgets: { ...DEFAULT_THINKING_BUDGETS, low: 777 } }),
      lookup,
    });
    expect(result.ok && result.value.thinkingBudgetTokens).toBe(777);
  });

  test("a level the model does not support is clamped (xhigh needs a thinkingLevelMap entry)", () => {
    const result = resolveRole({
      role: "main",
      overrides: { ref: "tape/thinker:xhigh" },
      table: TABLE,
      lookup,
    });
    expect(result.ok && result.value.binding.thinkingLevel).toBe("high");
  });

  test("only minimal to high budgets are handed to pi-ai", () => {
    expect(passableBudgets(DEFAULT_THINKING_BUDGETS)).toEqual({
      minimal: 1024,
      low: 2048,
      medium: 8192,
      high: 16_384,
    });
  });
});

describe("errors", () => {
  test("no model, malformed reference, unknown model", () => {
    expect(kind(table({ default: null }))).toBe("no_model_for_role");
    expect(kind(TABLE, "tape")).toBe("invalid_ref");
    expect(kind(TABLE, "tape/unknown")).toBe("model_not_found");
  });

  test("a bad value does not fall through to the next step", () => {
    const result = resolveRole({
      role: "review",
      overrides: {},
      table: table({ routing: { review: "tape/missing" } }),
      lookup,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("model_not_found");
  });
});

describe("allowed and denied models", () => {
  test("patterns match a full reference or provider/*", () => {
    expect(matchesModelPattern("tape/plain", "tape", "plain")).toBe(true);
    expect(matchesModelPattern("tape/*", "tape", "anything")).toBe(true);
    expect(matchesModelPattern("tape/plain", "tape", "other")).toBe(false);
    expect(matchesModelPattern("tap/*", "tape", "plain")).toBe(false);
  });

  test("denied wins, and a non-empty allowed list is exclusive", () => {
    expect(isModelAllowed({ allowed: [], denied: [] }, "tape", "plain")).toBe(true);
    expect(isModelAllowed({ allowed: [], denied: ["tape/*"] }, "tape", "plain")).toBe(false);
    expect(isModelAllowed({ allowed: ["tape/plain"], denied: [] }, "tape", "other")).toBe(false);
    expect(isModelAllowed({ allowed: ["tape/*"], denied: ["tape/plain"] }, "tape", "plain")).toBe(
      false,
    );
  });

  test("resolve returns model_denied for a denied model", () => {
    expect(kind(table({ denied: ["tape/plain"] }))).toBe("model_denied");
    expect(kind(table({ allowed: ["tape/other"] }))).toBe("model_denied");
    expect(kind(table({ allowed: ["tape/*"] }))).toBeUndefined();
  });
});

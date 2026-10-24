import { describe, expect, test } from "bun:test";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { basicCachePolicy, resolveRole, type RoutingTable } from "../src/role-table.ts";
import { tapePlayer, tapeProvider, tape } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";

const fake = tapeProvider(
  tapePlayer(tape("core-models/role-table", []), { clock: manualClock() }),
  {
    models: [{ id: "plain" }, { id: "thinker", reasoning: true }],
  },
);
const catalog = createModels();
catalog.setProvider(fake.provider);

function lookup(provider: string, modelId: string): Model<Api> | undefined {
  return catalog.getModel(provider, modelId);
}

const TABLE: RoutingTable = { default: "tape/plain", thinkingLevel: "medium" };

function level(overrides: { ref?: string; thinkingLevel?: "low" }): string | undefined {
  const result = resolveRole({ role: "main", overrides, table: TABLE, lookup });
  return result.ok ? result.value.binding.thinkingLevel : undefined;
}

function kind(table: RoutingTable, ref?: string): string | undefined {
  const result = resolveRole({
    role: "main",
    overrides: ref === undefined ? {} : { ref },
    table,
    lookup,
  });
  return result.ok ? undefined : result.error.kind;
}

describe("resolveRole (M1 minimal path)", () => {
  test("the default is used when nothing overrides it", () => {
    const result = resolveRole({ role: "main", overrides: {}, table: TABLE, lookup });
    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: { role: "main", provider: "tape", modelId: "plain", thinkingLevel: "off" },
        source: "default",
        trace: [{ step: "default", ref: "tape/plain" }],
      },
    });
  });

  test("an explicit reference wins and its suffix sets the level for a reasoning model", () => {
    const result = resolveRole({
      role: "main",
      overrides: { ref: "tape/thinker:high" },
      table: TABLE,
      lookup,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { binding: { modelId: "thinker", thinkingLevel: "high" }, source: "explicit" },
    });
  });

  test("overrides.thinkingLevel beats the reference suffix, which beats the table level", () => {
    expect(level({ ref: "tape/thinker" })).toBe("medium");
    expect(level({ ref: "tape/thinker:high" })).toBe("high");
    expect(level({ ref: "tape/thinker:high", thinkingLevel: "low" })).toBe("low");
  });

  test("a model without reasoning always resolves to off", () => {
    const result = resolveRole({
      role: "main",
      overrides: { ref: "tape/plain:high" },
      table: TABLE,
      lookup,
    });
    expect(result.ok && result.value.binding.thinkingLevel).toBe("off");
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

  test("the same input gives the same result twice, whatever the key order of the table", () => {
    const reordered: RoutingTable = { thinkingLevel: "medium", default: "tape/plain" };
    const a = resolveRole({ role: "judge", overrides: {}, table: TABLE, lookup });
    const b = resolveRole({ role: "judge", overrides: {}, table: reordered, lookup });
    expect(a).toEqual(b);
  });

  test("errors: no model, malformed reference, unknown model", () => {
    expect(kind({ default: null, thinkingLevel: "medium" })).toBe("no_model_for_role");
    expect(kind(TABLE, "tape")).toBe("invalid_ref");
    expect(kind(TABLE, "tape/unknown")).toBe("model_not_found");
  });
});

describe("basicCachePolicy", () => {
  test("main, review and subagent keep the configured retention with a thread session key", () => {
    for (const role of ["main", "review", "subagent"] as const) {
      expect(basicCachePolicy(role, "short")).toMatchObject({
        retention: "short",
        sessionKey: "thread",
      });
    }
  });

  test("summary, judge and search never cache and have no session key", () => {
    for (const role of ["summary", "judge", "search"] as const) {
      expect(basicCachePolicy(role, "long")).toMatchObject({ retention: "none", sessionKey: null });
    }
  });

  test("a configured retention of none disables the session key for every role", () => {
    expect(basicCachePolicy("main", "none")).toMatchObject({ retention: "none", sessionKey: null });
  });
});

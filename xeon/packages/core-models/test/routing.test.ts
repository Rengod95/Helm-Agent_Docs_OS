import { describe, expect, test } from "bun:test";
import { t, tape } from "../src/testing/index.ts";
import { DEFAULT_THINKING_BUDGETS } from "../src/index.ts";
import { createHarness, unwrap } from "./support/harness.ts";

const ONE = tape("core-models/routing", [
  { role: "main", response: { type: "message", content: [t.text("ok")], stopReason: "stop" } },
]);

const MODELS = { models: [{ id: "plain" }, { id: "thinker", reasoning: true }, { id: "other" }] };

describe("thinking_level_pinned_in_checkpoint", () => {
  test("rebind ignores later setting changes and returns the pinned value", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    h.setSettings({ default: "tape/thinker:high" });
    const first = unwrap(h.service.resolve("main"));
    expect(first.binding.thinkingLevel).toBe("high");

    h.setSettings({ default: "tape/other", thinkingLevel: "low" });
    const rebound = unwrap(h.service.rebind(first.binding));
    expect(rebound.binding).toEqual(first.binding);
    expect(rebound.source).toBe("checkpoint");
    expect(rebound.model.id).toBe("thinker");
    // 새로 해석하면 바뀐 설정을 따른다
    expect(unwrap(h.service.resolve("main")).binding.modelId).toBe("other");
  });

  test("a pinned model that left the catalog is an error", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    const result = h.service.rebind({
      role: "main",
      provider: "tape",
      modelId: "gone",
      thinkingLevel: "off",
    });
    expect(result).toMatchObject({ ok: false, error: { kind: "model_not_found" } });
  });

  test("a pinned model that is now denied is an error", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    const pinned = unwrap(h.service.resolve("main")).binding;
    h.setSettings({ deniedModels: ["tape/*"] });
    expect(h.service.rebind(pinned)).toMatchObject({ ok: false, error: { kind: "model_denied" } });
  });

  test("the pinned level is not clamped or changed by the role table", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    const rebound = unwrap(
      h.service.rebind({ role: "main", provider: "tape", modelId: "plain", thinkingLevel: "high" }),
    );
    expect(rebound.binding.thinkingLevel).toBe("high");
  });
});

describe("thinking_budgets_passed_for_four_levels", () => {
  test("the resolved model carries the budget of its level", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    h.setSettings({ default: "tape/thinker:low" });
    expect(unwrap(h.service.resolve("main")).thinkingBudgetTokens).toBe(
      DEFAULT_THINKING_BUDGETS.low,
    );
    h.setSettings({ default: "tape/plain" });
    expect(unwrap(h.service.resolve("main")).thinkingBudgetTokens).toBeNull();
  });

  test("only minimal to high reach pi-ai while xhigh and max stay in settings", async () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    h.setSettings({
      default: "tape/thinker:high",
      thinkingBudgets: { ...DEFAULT_THINKING_BUDGETS, high: 999, xhigh: 4242 },
    });
    await h.service.stream(h.request("hi")).result();
    const budgets = h.fake.calls()[0]?.thinkingBudgets;
    expect(budgets).toEqual({ minimal: 1024, low: 2048, medium: 8192, high: 999 });
    expect(h.fake.calls()[0]?.reasoning).toBe("high");
  });

  test("no budgets are sent when thinking is off", async () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    await h.service.stream(h.request("hi")).result();
    expect(h.fake.calls()[0]?.thinkingBudgets).toBeUndefined();
    expect(h.fake.calls()[0]?.reasoning).toBeUndefined();
  });
});

describe("settings take effect without a restart", () => {
  test("routing changes show in the next resolve", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    expect(unwrap(h.service.resolve("summary")).binding.modelId).toBe("plain");
    h.setSettings({ routing: { summary: "tape/other" } });
    const summary = unwrap(h.service.resolve("summary"));
    expect(summary.binding.modelId).toBe("other");
    expect(summary.source).toBe("role");
  });

  test("a disabled scope's group override is ignored when the host reports it off", () => {
    const h = createHarness({
      tape: ONE,
      provider: MODELS,
      scopeEnabled: (scopeId) => scopeId !== "helm",
    });
    h.setSettings({
      groupRouting: { helm: { review: "tape/thinker" }, lens: { review: "tape/other" } },
    });
    expect(unwrap(h.service.resolve("review", { scopeId: "helm" })).binding.modelId).toBe("plain");
    expect(unwrap(h.service.resolve("review", { scopeId: "lens" })).binding.modelId).toBe("other");
  });

  test("cacheRetention applies to main and never to summary", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    h.setSettings({ cacheRetention: "long" });
    expect(unwrap(h.service.resolve("main")).cachePolicy.retention).toBe("long");
    expect(unwrap(h.service.resolve("summary")).cachePolicy.retention).toBe("none");
    h.setSettings({ cacheRetention: "none" });
    expect(unwrap(h.service.resolve("main")).cachePolicy.sessionKey).toBeNull();
  });

  test("list() applies the allowed and denied lists", () => {
    const h = createHarness({ tape: ONE, provider: MODELS });
    expect(h.service.list().map((info) => info.ref)).toEqual([
      "tape/plain",
      "tape/thinker",
      "tape/other",
    ]);
    h.setSettings({ deniedModels: ["tape/other"], allowedModels: ["tape/*"] });
    expect(h.service.list().map((info) => info.ref)).toEqual(["tape/plain", "tape/thinker"]);
  });
});

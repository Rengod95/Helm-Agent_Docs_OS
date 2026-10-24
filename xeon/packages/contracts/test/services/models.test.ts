import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { MODEL_THINKING_LEVELS } from "../../src/conversation/index.ts";
import {
  MODEL_REF_PATTERN,
  MODEL_ROLES,
  ModelBindingSchema,
  ModelRefStringSchema,
  ModelRoleSchema,
  ProviderConfigDefSchema,
  THINKING_LEVELS,
  formatModelRef,
  parseModelRef,
} from "../../src/services/index.ts";

describe("parseModelRef", () => {
  test("splits provider, model id and thinking level", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-5")).toEqual({
      ok: true,
      value: { provider: "anthropic", modelId: "claude-sonnet-4-5", thinkingLevel: null },
    });
    expect(parseModelRef("anthropic/claude-sonnet-4-5:high")).toEqual({
      ok: true,
      value: { provider: "anthropic", modelId: "claude-sonnet-4-5", thinkingLevel: "high" },
    });
  });

  test("a colon segment that is not a thinking level stays in the model id", () => {
    expect(parseModelRef("bedrock/anthropic.claude-3-v1:0")).toEqual({
      ok: true,
      value: { provider: "bedrock", modelId: "anthropic.claude-3-v1:0", thinkingLevel: null },
    });
    expect(parseModelRef("x/model:HIGH")).toEqual({
      ok: true,
      value: { provider: "x", modelId: "model:HIGH", thinkingLevel: null },
    });
  });

  test("a model id may contain slashes", () => {
    expect(parseModelRef("openrouter/anthropic/claude-x:low")).toEqual({
      ok: true,
      value: { provider: "openrouter", modelId: "anthropic/claude-x", thinkingLevel: "low" },
    });
  });

  test("every thinking level is recognised", () => {
    for (const level of MODEL_THINKING_LEVELS) {
      const parsed = parseModelRef(`p/m:${level}`);
      expect(parsed).toEqual({
        ok: true,
        value: { provider: "p", modelId: "m", thinkingLevel: level },
      });
    }
  });

  test("malformed and empty references", () => {
    for (const input of ["", "nomodel", "/m", "UPPER/m", "p/has space", `p/${"x".repeat(201)}`]) {
      expect(parseModelRef(input)).toEqual({ ok: false, error: { kind: "malformed", input } });
    }
    expect(parseModelRef("p/")).toEqual({
      ok: false,
      error: { kind: "empty_model_id", input: "p/" },
    });
    expect(parseModelRef("p/:high")).toEqual({
      ok: false,
      error: { kind: "empty_model_id", input: "p/:high" },
    });
  });

  test("formatModelRef is the inverse", () => {
    for (const input of ["a/b", "a/b:high", "bedrock/x:0", "openrouter/x/y:max"]) {
      const parsed = parseModelRef(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatModelRef(parsed.value)).toBe(input);
    }
  });

  test("references that parse match the string schema", () => {
    for (const input of ["a/b", "anthropic/claude-x:high", "openrouter/x/y"]) {
      expect(parseModelRef(input).ok).toBe(true);
      expect(parse(ModelRefStringSchema, input).ok).toBe(true);
    }
    expect(new RegExp(MODEL_REF_PATTERN).test("nope")).toBe(false);
  });
});

describe("model constants and schemas", () => {
  test("THINKING_LEVELS equals the conversation list", () => {
    expect([...THINKING_LEVELS]).toEqual([...MODEL_THINKING_LEVELS]);
  });

  test("roles", () => {
    expect(MODEL_ROLES).toEqual(["main", "review", "summary", "subagent", "judge", "search"]);
    for (const role of MODEL_ROLES) expect(parse(ModelRoleSchema, role).ok).toBe(true);
    expect(parse(ModelRoleSchema, "smol").ok).toBe(false);
  });

  test("binding", () => {
    const binding = {
      role: "main",
      provider: "anthropic",
      modelId: "claude-x",
      thinkingLevel: "medium",
    };
    expect(parse(ModelBindingSchema, binding).ok).toBe(true);
    expect(parse(ModelBindingSchema, { ...binding, thinkingLevel: "huge" }).ok).toBe(false);
    expect(parse(ModelBindingSchema, { ...binding, role: "boss" }).ok).toBe(false);
    expect(parse(ModelBindingSchema, { ...binding, provider: "Anthropic" }).ok).toBe(false);
  });

  test("provider config accepts secret references only for keys", () => {
    const config = {
      kind: "config",
      baseUrl: "https://llm.example.com/v1",
      api: "openai-completions",
      apiKey: "secret://example-key",
      headers: { "x-team": "xeon" },
      models: [
        {
          id: "m1",
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    expect(parse(ProviderConfigDefSchema, config).ok).toBe(true);
    for (const apiKey of ["sk-live-123", "$OPENAI_API_KEY", "!pass show key", "secret://A"]) {
      expect({ apiKey, ok: parse(ProviderConfigDefSchema, { ...config, apiKey }).ok }).toEqual({
        apiKey,
        ok: false,
      });
    }
    expect(parse(ProviderConfigDefSchema, { kind: "runtime" }).ok).toBe(false);
    expect(parse(ProviderConfigDefSchema, { ...config, extra: 1 }).ok).toBe(false);
  });
});

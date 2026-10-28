import { describe, expect, test } from "bun:test";
import {
  checkModelRef,
  checkProviderId,
  defaultModelOf,
  providerSecretName,
  providersOf,
  readyToChat,
  setupSteps,
  withProviderKey,
  type ProviderEntry,
} from "../../src/settings/index.ts";

const anthropic: ProviderEntry = {
  id: "anthropic",
  enabled: true,
  apiKeyRef: "secret://anthropic-api-key",
  baseUrl: null,
};

function nameOf(providerId: string): string | null {
  const result = providerSecretName(providerId);
  return result.ok ? result.value : null;
}

describe("provider and model input", () => {
  test("provider ids and model refs follow the contract patterns", () => {
    expect(checkProviderId(" anthropic ")).toEqual({ ok: true, value: "anthropic" });
    expect(checkProviderId("Anthropic").ok).toBe(false);
    expect(checkProviderId("").ok).toBe(false);
    expect(checkModelRef("anthropic/claude-sonnet-5-5")).toEqual({
      ok: true,
      value: "anthropic/claude-sonnet-5-5",
    });
    expect(checkModelRef("anthropic/claude-sonnet-5-5:high").ok).toBe(true);
    expect(checkModelRef("claude").ok).toBe(false);
    expect(checkModelRef("anthropic/").ok).toBe(false);
    expect(checkModelRef("a/b c").ok).toBe(false);
  });

  test("the secret name is <provider>-api-key with dots and underscores turned into hyphens", () => {
    expect(nameOf("anthropic")).toBe("anthropic-api-key");
    expect(nameOf("my.corp_llm")).toBe("my-corp-llm-api-key");
    // 숫자로 시작하는 provider id는 비밀 이름 규칙(소문자로 시작)에 맞지 않는다
    expect(providerSecretName("9router").ok).toBe(false);
  });
});

describe("settings values", () => {
  test("providersOf reads a valid list and falls back to empty on a wrong shape", () => {
    expect(providersOf([anthropic])).toEqual([anthropic]);
    expect(providersOf("nope")).toEqual([]);
    expect(providersOf([{ id: "x", enabled: true }])).toEqual([]);
    // 평문 키는 참조 형식이 아니라 읽지 않는다
    expect(providersOf([{ ...anthropic, apiKeyRef: "sk-live-123" }])).toEqual([]);
  });

  test("defaultModelOf reads a ref or null", () => {
    expect(defaultModelOf("anthropic/claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5");
    expect(defaultModelOf(null)).toBeNull();
    expect(defaultModelOf(7)).toBeNull();
  });

  test("withProviderKey adds a new provider, or updates only the matching one and keeps its baseUrl", () => {
    const secret = providerSecretName("openai");
    if (!secret.ok) throw new Error("fixture");
    const added = withProviderKey([anthropic], "openai", secret.value);
    expect(added).toEqual([
      anthropic,
      { id: "openai", enabled: true, apiKeyRef: "secret://openai-api-key", baseUrl: null },
    ]);
    const off: ProviderEntry = {
      id: "openai",
      enabled: false,
      apiKeyRef: null,
      baseUrl: "http://x",
    };
    expect(withProviderKey([anthropic, off], "openai", secret.value)).toEqual([
      anthropic,
      { id: "openai", enabled: true, apiKeyRef: "secret://openai-api-key", baseUrl: "http://x" },
    ]);
  });
});

describe("first-run steps", () => {
  const base = {
    providers: [anthropic],
    defaultModel: "anthropic/claude-sonnet-5-5",
    secrets: [{ name: "anthropic-api-key", registered: true }],
    toolsReady: true,
  };

  test("everything done", () => {
    expect(setupSteps(base).map((s) => [s.id, s.done, s.unknown])).toEqual([
      ["tools", true, false],
      ["key", true, false],
      ["model", true, false],
    ]);
    expect(readyToChat(base)).toBe(true);
  });

  test("a reference to a secret that is not registered does not count as a key", () => {
    const input = { ...base, secrets: [{ name: "anthropic-api-key", registered: false }] };
    expect(setupSteps(input).find((s) => s.id === "key")?.done).toBe(false);
    expect(readyToChat(input)).toBe(false);
  });

  test("the default model must belong to a provider that has a key", () => {
    const input = { ...base, defaultModel: "openai/gpt-x" };
    expect(setupSteps(input).find((s) => s.id === "model")?.done).toBe(false);
    expect(readyToChat({ ...base, defaultModel: null })).toBe(false);
  });

  test("unknown tool results and an unreadable secret list are marked unknown, and tools do not block chatting", () => {
    const steps = setupSteps({ ...base, toolsReady: null, secrets: null });
    expect(steps.find((s) => s.id === "tools")).toEqual({
      id: "tools",
      done: false,
      unknown: true,
    });
    expect(steps.find((s) => s.id === "key")).toEqual({ id: "key", done: false, unknown: true });
    expect(readyToChat({ ...base, toolsReady: null })).toBe(true);
    expect(readyToChat({ ...base, toolsReady: false })).toBe(true);
  });

  test("a disabled provider has no key even with a registered secret", () => {
    const input = { ...base, providers: [{ ...anthropic, enabled: false }] };
    expect(setupSteps(input).find((s) => s.id === "key")?.done).toBe(false);
  });
});

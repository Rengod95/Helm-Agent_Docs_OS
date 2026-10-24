import { describe, expect, test } from "bun:test";
import type { ModelsPort } from "@xeon/contracts/extensions";
import type { ModelService, ProviderConfigDef } from "@xeon/contracts/services";
import { ModelRegistrationError } from "../src/index.ts";
import { t, tape, tapePlayer, tapeProvider } from "../src/testing/index.ts";
import { createHarness, FAKE_KEY, unwrap } from "./support/harness.ts";

const ONE = tape("core-models/registry", [
  { role: "main", response: { type: "message", content: [t.text("hi")], stopReason: "stop" } },
]);

const OWNER = "ext.acme";

function config(patch: Partial<ProviderConfigDef> = {}): ProviderConfigDef {
  return {
    kind: "config",
    baseUrl: "http://127.0.0.1:9/local",
    api: "openai-completions",
    models: [
      { id: "local-1", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 800 },
    ],
    ...patch,
  };
}

function harness(): ReturnType<typeof createHarness> {
  return createHarness({ tape: ONE });
}

describe("provider_registry_rejects_duplicate_api_id", () => {
  test("a second addProvider with the same name is a provider_conflict", () => {
    const h = harness();
    const first = h.service.addProvider(OWNER, "local", config());
    expect(first.ok).toBe(true);
    const second = h.service.addProvider("ext.other", "local", config());
    expect(second).toMatchObject({ ok: false, error: { kind: "provider_conflict" } });
    // 같은 소유자라도 먼저 해제해야 한다
    const again = h.service.addProvider(OWNER, "local", config());
    expect(again).toMatchObject({ ok: false, error: { kind: "provider_conflict" } });
  });

  test("a name that is already a catalog provider is a conflict when models are given", () => {
    const h = harness();
    const result = h.service.addProvider(OWNER, "tape", config());
    expect(result).toMatchObject({ ok: false, error: { kind: "provider_conflict" } });
  });

  test("a malformed provider name is invalid_provider", () => {
    const h = harness();
    expect(h.service.addProvider(OWNER, "Bad Name", config())).toMatchObject({
      ok: false,
      error: { kind: "invalid_provider" },
    });
  });

  test("a config for a new provider needs baseUrl and models", () => {
    const h = harness();
    expect(
      h.service.addProvider(OWNER, "local", { kind: "config", baseUrl: "http://127.0.0.1:9" }),
    ).toMatchObject({ ok: false, error: { kind: "invalid_provider" } });
  });

  test("an api without a built-in implementation is invalid_provider", () => {
    const h = harness();
    const result = h.service.addProvider(OWNER, "local", config({ api: "nonexistent-api" }));
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_provider" } });
  });

  test("a runtime provider must be registered under its own id", () => {
    const h = harness();
    const other = tapeProvider(tapePlayer(ONE, { clock: h.clock }), { id: "wrapped" });
    expect(
      h.service.addProvider(OWNER, "different", { kind: "runtime", provider: other.provider }),
    ).toMatchObject({ ok: false, error: { kind: "invalid_provider" } });
    expect(
      h.service.addProvider(OWNER, "wrapped", { kind: "runtime", provider: other.provider }).ok,
    ).toBe(true);
  });
});

describe("unsubscribe", () => {
  test("the models of a released provider leave list()", () => {
    const h = harness();
    const added = unwrap(h.service.addProvider(OWNER, "local", config()));
    expect(h.service.list({ provider: "local" })).toHaveLength(1);
    added();
    expect(h.service.list({ provider: "local" })).toHaveLength(0);
    // 두 번 불러도 다른 소유자의 새 등록을 건드리지 않는다
    const next = unwrap(h.service.addProvider("ext.other", "local", config()));
    added();
    expect(h.service.list({ provider: "local" })).toHaveLength(1);
    next();
  });

  test("after release the name can be registered again", () => {
    const h = harness();
    unwrap(h.service.addProvider(OWNER, "local", config()))();
    expect(h.service.addProvider(OWNER, "local", config()).ok).toBe(true);
  });
});

describe("registered providers in use", () => {
  test("a config provider appears in list() as available and can be resolved", () => {
    const h = harness();
    unwrap(h.service.addProvider(OWNER, "local", config()));
    const info = h.service.list({ provider: "local" })[0];
    expect(info).toMatchObject({
      ref: "local/local-1",
      contextWindow: 8000,
      available: true,
    });
    expect(h.service.resolve("main", { ref: "local/local-1" }).ok).toBe(true);
  });

  test("a runtime provider streams through the service with its own credential reference", async () => {
    const h = harness();
    const wrapped = tapeProvider(h.player, { id: "wrapped", requireKey: true });
    unwrap(
      h.service.addProvider(OWNER, "wrapped", {
        kind: "runtime",
        provider: wrapped.provider,
        credential: "secret://tape-key",
      }),
    );
    const resolved = unwrap(h.service.resolve("main", { ref: "wrapped/tape-1" }));
    const request = { ...h.ctx(), resolved, context: h.context("hi") };
    const message = await h.service.stream(request).result();
    expect(message.stopReason).toBe("stop");
    // 요청 직전에 참조를 풀어 provider 인증에 넣었다
    expect(wrapped.calls()[0]?.apiKey).toBe(FAKE_KEY);
  });

  test("the credential reference of a runtime provider is resolved only at request time", async () => {
    const h = harness();
    const wrapped = tapeProvider(h.player, { id: "wrapped2", requireKey: true });
    unwrap(
      h.service.addProvider(OWNER, "wrapped2", {
        kind: "runtime",
        provider: wrapped.provider,
        credential: "secret://tape-key",
      }),
    );
    expect(h.secrets.valueReads()).toBe(0);
    const resolved = unwrap(h.service.resolve("main", { ref: "wrapped2/tape-1" }));
    expect(h.secrets.valueReads()).toBe(0);
    await h.service.stream({ ...h.ctx(), resolved, context: h.context("hi") }).result();
    expect(h.secrets.valueReads()).toBe(1);
  });

  test("a baseUrl-only config overrides a built-in provider's address", async () => {
    const h = harness();
    const added = h.service.addProvider(OWNER, "tape", {
      kind: "config",
      baseUrl: "http://127.0.0.1:9/override",
    });
    expect(added.ok).toBe(true);
    await h.service.stream(h.request("hi")).result();
    // 카탈로그의 모델은 그대로 있고 요청은 나간다
    expect(h.fake.calls()).toHaveLength(1);
    if (added.ok) added.value();
    expect(h.service.list({ provider: "tape" })).toHaveLength(1);
  });
});

describe("registerProvider (ModelsPort path)", () => {
  test("is assignable to ModelsPort", () => {
    const h = harness();
    const service: ModelService = h.service;
    const port: ModelsPort = service;
    expect(typeof port.registerProvider).toBe("function");
  });

  test("a valid JSON config registers in the same registry as addProvider", () => {
    const h = harness();
    const unsubscribe = h.service.registerProvider(OWNER, "local", {
      kind: "config",
      baseUrl: "http://127.0.0.1:9/local",
      api: "openai-completions",
      models: [{ id: "m1", reasoning: false, input: ["text"], contextWindow: 100, maxTokens: 10 }],
    });
    expect(h.service.list({ provider: "local" })).toHaveLength(1);
    expect(h.service.addProvider("ext.x", "local", config())).toMatchObject({
      ok: false,
      error: { kind: "provider_conflict" },
    });
    unsubscribe();
    expect(h.service.list({ provider: "local" })).toHaveLength(0);
  });

  test("a config that fails the schema throws an invalid_provider ModelError", () => {
    const h = harness();
    const bad = (): unknown =>
      h.service.registerProvider(OWNER, "local", { kind: "config", unknownField: 1 });
    expect(bad).toThrow(ModelRegistrationError);
    try {
      bad();
    } catch (caught) {
      expect(caught).toBeInstanceOf(ModelRegistrationError);
      if (caught instanceof ModelRegistrationError) expect(caught.kind).toBe("invalid_provider");
    }
  });

  test("a literal apiKey is rejected, only secret references pass", () => {
    const h = harness();
    expect(() =>
      h.service.registerProvider(OWNER, "local", {
        kind: "config",
        baseUrl: "http://127.0.0.1:9",
        apiKey: "sk-literal-key",
      }),
    ).toThrow(ModelRegistrationError);
  });

  test("a duplicate name throws provider_conflict", () => {
    const h = harness();
    h.service.registerProvider(OWNER, "local", {
      kind: "config",
      baseUrl: "http://127.0.0.1:9",
      api: "openai-completions",
      models: [{ id: "m1", reasoning: false, input: ["text"], contextWindow: 100, maxTokens: 10 }],
    });
    try {
      h.service.registerProvider("ext.other", "local", { kind: "config", baseUrl: "http://x" });
      throw new Error("expected a throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(ModelRegistrationError);
      if (caught instanceof ModelRegistrationError) expect(caught.kind).toBe("provider_conflict");
    }
  });
});

describe("overlay headers", () => {
  test("static headers pass through and secret references are resolved at request time", async () => {
    const h = harness();
    const added = h.service.addProvider(OWNER, "tape", {
      kind: "config",
      headers: { "x-team": "core", "x-token": "secret://tape-key" },
    });
    expect(added.ok).toBe(true);
    expect(h.secrets.valueReads()).toBe(0);
    await h.service.stream(h.request("hi")).result();
    const headers = h.fake.calls()[0]?.headers;
    expect(headers).toMatchObject({ "x-team": "core", "x-token": FAKE_KEY });
  });

  test("an unresolvable header reference ends the call as secret_unresolved", async () => {
    const h = createHarness({ tape: ONE, secretValues: { "tape-key": FAKE_KEY } });
    h.service.addProvider(OWNER, "tape", {
      kind: "config",
      headers: { "x-token": "secret://missing-one" },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toStartWith("secret_unresolved:");
    expect(h.fake.calls()).toHaveLength(0);
  });
});

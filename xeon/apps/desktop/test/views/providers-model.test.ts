import { describe, expect, test } from "bun:test";
import type { AccountEntry } from "@fresnel/client";
import type { ProviderEntry } from "@fresnel/client/settings";
import type { ModelEntry, UsageGauge } from "@fresnel/contracts/wire";
import {
  ACCOUNT_FOLD_MAX,
  fieldOfKey,
  foldOf,
  poolsOf,
  reprioritizedOf,
  rotationConfirmOf,
  rotationStepOf,
  usageFractionOf,
  addableProvidersOf,
  initialChecks,
  isBaseUrl,
  storeFailedChecks,
  isModelRule,
  linkedCheckOf,
  modelAccessGroupsOf,
  modelsCheckOf,
  nextPriorityOf,
  providerCardsOf,
  secretNameOfRef,
  storedCheckOf,
  stringListOf,
  usageTotalsOf,
  withCheck,
  withModelUsable,
  withNewProvider,
  withProviderBaseUrl,
  withProviderEnabled,
  withoutProvider,
} from "../../src/views/pages/providers/providers-model.ts";

// 모델과 계정 구역(P-11, DP-83·DP-84)의 순수 모델. 값은 `toEqual`로 비교한다.

function account(
  provider: string,
  accountId: string,
  priority: number,
  reservePct = 0,
): AccountEntry {
  return { provider, accountId, credential: `secret://${accountId}-key`, priority, reservePct };
}

describe("poolsOf", () => {
  test("accounts group by provider, providers by id, accounts by priority", () => {
    const pools = poolsOf([
      account("openai", "team", 0),
      account("anthropic", "work", 20),
      account("anthropic", "personal", 10),
    ]);
    expect(pools.map((pool) => pool.provider)).toEqual(["anthropic", "openai"]);
    expect(pools[0]?.accounts.map((entry) => entry.accountId)).toEqual(["personal", "work"]);
    expect(pools[1]?.accounts.map((entry) => entry.accountId)).toEqual(["team"]);
  });
});

describe("foldOf", () => {
  test("a list longer than the fold shows the first twenty and counts the rest", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    expect(ACCOUNT_FOLD_MAX).toBe(20);
    expect(foldOf(items, false)).toEqual({ shown: items.slice(0, 20), hidden: 5 });
    expect(foldOf(items, true)).toEqual({ shown: items, hidden: 0 });
    expect(foldOf([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], hidden: 0 });
  });
});

describe("reprioritizedOf", () => {
  test("the accounts of one provider take their new order, ten apart; other providers stay", () => {
    const list = [
      account("anthropic", "work", 10),
      account("anthropic", "personal", 0),
      account("openai", "team", 5),
    ];
    expect(reprioritizedOf(list, "anthropic", ["personal", "work"])).toEqual([
      account("anthropic", "work", 10),
      account("anthropic", "personal", 0),
      account("openai", "team", 5),
    ]);
    expect(reprioritizedOf(list, "anthropic", ["work", "personal"])).toEqual([
      account("anthropic", "work", 0),
      account("anthropic", "personal", 10),
      account("openai", "team", 5),
    ]);
  });
});

describe("rotationStepOf", () => {
  const ENABLED = "ext.account-rotation.enabled";

  test("turning off writes only the enabled key, and only when the plugin is on", () => {
    expect(rotationStepOf({ pluginEnabled: true, acknowledged: true }, false)).toEqual({
      kind: "write",
      writes: [{ key: ENABLED, value: false }],
    });
    expect(rotationStepOf({ pluginEnabled: false, acknowledged: true }, false)).toEqual({
      kind: "write",
      writes: [],
    });
  });

  test("turning on without the acknowledgement asks first, from off and from needs-notice alike", () => {
    expect(rotationStepOf({ pluginEnabled: false, acknowledged: false }, true)).toEqual({
      kind: "ask",
    });
    expect(rotationStepOf({ pluginEnabled: true, acknowledged: false }, true)).toEqual({
      kind: "ask",
    });
  });

  test("turning on with the acknowledgement writes the enabled key only when it was off", () => {
    expect(rotationStepOf({ pluginEnabled: false, acknowledged: true }, true)).toEqual({
      kind: "write",
      writes: [{ key: ENABLED, value: true }],
    });
    expect(rotationStepOf({ pluginEnabled: true, acknowledged: true }, true)).toEqual({
      kind: "write",
      writes: [],
    });
  });

  test("the confirm dialog writes the acknowledgement first and the enabled key after it when it was off", () => {
    expect(rotationConfirmOf({ pluginEnabled: false })).toEqual([
      { key: "ext.account-rotation.acknowledgeRisk", value: true },
      { key: ENABLED, value: true },
    ]);
    expect(rotationConfirmOf({ pluginEnabled: true })).toEqual([
      { key: "ext.account-rotation.acknowledgeRisk", value: true },
    ]);
  });
});

function sessionGauge(used: number, limit: number | null): UsageGauge {
  return {
    id: "anthropic::session:tokens",
    providerId: "anthropic",
    account: null,
    window: "session",
    unit: "tokens",
    used,
    limit,
    resetsAt: null,
  };
}

describe("usageFractionOf", () => {
  test("a known limit gives the fraction, capped at 100", () => {
    expect(usageFractionOf(sessionGauge(41_000, 100_000))).toBe(41);
    expect(usageFractionOf(sessionGauge(200, 100))).toBe(100);
  });

  test("an unknown or zero limit gives no fraction, so no number is made up", () => {
    expect(usageFractionOf(sessionGauge(41_000, null))).toBeNull();
    expect(usageFractionOf(sessionGauge(41_000, 0))).toBeNull();
  });
});

describe("fieldOfKey", () => {
  test("finds a field by its exact key and says so when it is not on the tab", () => {
    const fields = [
      { key: "ext.account-rotation.enabled", value: true },
      { key: "ext.account-rotation.acknowledgeRisk", value: false },
    ];
    expect(fieldOfKey(fields, "ext.account-rotation.enabled")).toEqual(fields[0]);
    expect(fieldOfKey(fields, "ext.account-rotation")).toBeUndefined();
  });
});

function provider(id: string, over: Partial<ProviderEntry> = {}): ProviderEntry {
  return { id, enabled: true, apiKeyRef: `secret://${id}-api-key`, baseUrl: null, ...over };
}

function model(ref: string, name = ""): ModelEntry {
  return {
    ref,
    name,
    contextWindow: 200_000,
    reasoning: false,
    inputPrice: 3,
    outputPrice: 15,
  };
}

function gauge(providerId: string, unit: UsageGauge["unit"], used: number): UsageGauge {
  return {
    id: `${providerId}::session:${unit}`,
    providerId,
    account: null,
    window: "session",
    unit,
    used,
    limit: null,
    resetsAt: null,
  };
}

describe("providerCardsOf", () => {
  test("each provider gets a status from switch, key reference, stored secret and catalog", () => {
    const cards = providerCardsOf({
      providers: [
        provider("anthropic"),
        provider("openai", { enabled: false }),
        provider("google", { apiKeyRef: null }),
        provider("openrouter"),
        provider("my-llm", { baseUrl: "https://llm.example" }),
      ],
      secrets: [
        { name: "anthropic-api-key", registered: true },
        { name: "my-llm-api-key", registered: true },
      ],
      models: [model("anthropic/claude-a"), model("anthropic/claude-b")],
      gauges: [
        gauge("anthropic", "tokens", 1200),
        gauge("anthropic", "usd", 0.5),
        gauge("anthropic", "requests", 3),
      ],
    });
    expect(
      cards.map((card) => [
        card.id,
        card.name,
        card.mark,
        card.custom,
        card.status,
        card.modelCount,
      ]),
    ).toEqual([
      ["anthropic", "Anthropic", "A", false, "connected", 2],
      ["openai", "OpenAI", "O", false, "off", 0],
      ["google", "Google", "G", false, "noKey", 0],
      ["openrouter", "OpenRouter", "O", false, "missingKey", 0],
      ["my-llm", "my-llm", "M", true, "noModels", 0],
    ]);
    expect(cards[0]?.usage).toEqual({ tokens: 1200, usd: 0.5, requests: 3 });
    expect(cards[1]?.usage).toBeNull();
    expect(cards[4]?.baseUrl).toBe("https://llm.example");
  });

  test("an unread secret list skips the store check instead of claiming the key is missing", () => {
    const cards = providerCardsOf({
      providers: [provider("openrouter")],
      secrets: null,
      models: [model("openrouter/x")],
      gauges: [],
    });
    expect(cards[0]?.status).toBe("connected");
  });
});

describe("usageTotalsOf", () => {
  test("sums tokens, dollars and requests of one provider only", () => {
    expect(
      usageTotalsOf(
        [
          gauge("a", "tokens", 10),
          gauge("a", "tokens", 5),
          gauge("a", "cacheRead", 99),
          gauge("b", "usd", 1),
        ],
        "a",
      ),
    ).toEqual({ tokens: 15, usd: 0, requests: 0 });
    expect(usageTotalsOf([], "a")).toBeNull();
  });
});

describe("provider list writes", () => {
  const list = [provider("anthropic"), provider("openai")];

  test("toggle, base URL, remove and new provider touch only their entry", () => {
    expect(withProviderEnabled(list, "openai", false)).toEqual([
      provider("anthropic"),
      provider("openai", { enabled: false }),
    ]);
    expect(withProviderBaseUrl(list, "anthropic", "  https://proxy.example  ")).toEqual([
      provider("anthropic", { baseUrl: "https://proxy.example" }),
      provider("openai"),
    ]);
    expect(withProviderBaseUrl(list, "anthropic", " ")).toEqual(list);
    expect(withoutProvider(list, "anthropic")).toEqual([provider("openai")]);
    expect(withNewProvider(list, "my-llm", "https://llm.example")).toEqual([
      ...list,
      { id: "my-llm", enabled: true, apiKeyRef: null, baseUrl: "https://llm.example" },
    ]);
    expect(withNewProvider(list, "openai", "")).toEqual(list);
  });

  test("known providers already in the list are not offered again", () => {
    expect(addableProvidersOf(list)).toEqual(["google", "openrouter"]);
  });

  test("a base URL is empty or an http(s) address", () => {
    expect([
      isBaseUrl(""),
      isBaseUrl("https://a.example/v1"),
      isBaseUrl("http://localhost:8080"),
      isBaseUrl("ftp://a"),
      isBaseUrl("nope"),
    ]).toEqual([true, true, true, false, false]);
  });
});

describe("connection checks", () => {
  test("a key registration failure is the store step's reason, and the steps after it are skipped", () => {
    const checks = storeFailedChecks("키 저장소를 쓸 수 없어요", "잠금을 풀어요");
    expect(checks.map((check) => [check.id, check.state])).toEqual([
      ["stored", "failed"],
      ["linked", "skipped"],
      ["models", "skipped"],
    ]);
    expect(checks[0]).toEqual({
      id: "stored",
      state: "failed",
      reason: { kind: "error", text: "키 저장소를 쓸 수 없어요", fix: "잠금을 풀어요" },
    });
    expect(storeFailedChecks("다른 사유", undefined)[0]).toEqual({
      id: "stored",
      state: "failed",
      reason: { kind: "error", text: "다른 사유" },
    });
  });

  test("a failed step skips the steps after it and keeps the ones before", () => {
    const first = withCheck(initialChecks(), {
      id: "stored",
      state: "passed",
      reason: { kind: "stored", length: 41 },
      elapsedMs: 12,
    });
    const failed = withCheck(first, {
      id: "linked",
      state: "failed",
      reason: { kind: "off" },
      elapsedMs: 30,
    });
    expect(failed.map((check) => [check.id, check.state])).toEqual([
      ["stored", "passed"],
      ["linked", "failed"],
      ["models", "skipped"],
    ]);
  });

  test("each step reads its own source", () => {
    expect(storedCheckOf({ state: "missing", decryptable: false, length: null })).toEqual({
      kind: "missing",
    });
    expect(storedCheckOf({ state: "registered", decryptable: false, length: null })).toEqual({
      kind: "undecryptable",
    });
    expect(storedCheckOf({ state: "registered", decryptable: true, length: 41 })).toEqual({
      kind: "stored",
      length: 41,
    });
    const name = secretNameOfRef("secret://anthropic-api-key");
    expect<string | null>(name).toBe("anthropic-api-key");
    if (name === null) return;
    expect(linkedCheckOf([provider("anthropic")], "anthropic", name)).toEqual({ kind: "linked" });
    expect(linkedCheckOf([provider("anthropic", { enabled: false })], "anthropic", name)).toEqual({
      kind: "off",
    });
    expect(linkedCheckOf([provider("anthropic", { apiKeyRef: null })], "anthropic", name)).toEqual({
      kind: "notLinked",
    });
    expect(modelsCheckOf([model("anthropic/a"), model("openai/b")], "anthropic")).toEqual({
      kind: "models",
      count: 1,
    });
    expect(modelsCheckOf([], "anthropic")).toEqual({ kind: "noModels" });
  });
});

describe("model access", () => {
  test("blocked models stay in the list as switched-off rows, patterns first", () => {
    const groups = modelAccessGroupsOf(
      [model("anthropic/claude-b", "Claude B"), model("anthropic/claude-a", "Claude A")],
      ["anthropic/claude-old", "openai/*"],
      "",
    );
    expect(
      groups.map((group) => [
        group.provider,
        group.rows.map((row) => [row.label, row.usable, row.pattern]),
      ]),
    ).toEqual([
      [
        "anthropic",
        [
          ["Claude A", true, false],
          ["Claude B", true, false],
          ["claude-old", false, false],
        ],
      ],
      ["openai", [["OpenAI", false, true]]],
    ]);
  });

  test("the search keeps rows whose name or reference holds the text", () => {
    const groups = modelAccessGroupsOf(
      [model("anthropic/claude-a", "Claude A"), model("openai/gpt-x", "GPT X")],
      [],
      "gpt",
    );
    expect(groups.map((group) => group.rows.map((row) => row.ref))).toEqual([["openai/gpt-x"]]);
  });

  test("turning a row off blocks it once, turning it on unblocks it", () => {
    expect(withModelUsable([], "a/x", false)).toEqual(["a/x"]);
    expect(withModelUsable(["a/x"], "a/x", false)).toEqual(["a/x"]);
    expect(withModelUsable(["a/x", "b/*"], "a/x", true)).toEqual(["b/*"]);
  });

  test("allow rules are provider/model or provider/*", () => {
    expect(
      ["anthropic/*", "anthropic/claude-a", "anthropic", "Anthropic/x", "a/ b"].map(isModelRule),
    ).toEqual([true, true, false, false, false]);
    expect(stringListOf(["a", "b"])).toEqual(["a", "b"]);
    expect(stringListOf(["a", 1])).toBeNull();
  });
});

describe("nextPriorityOf", () => {
  test("a new account goes after the last of its provider", () => {
    expect(
      nextPriorityOf(
        [account("anthropic", "a", 0), account("anthropic", "b", 20), account("openai", "c", 90)],
        "anthropic",
      ),
    ).toBe(30);
    expect(nextPriorityOf([], "anthropic")).toBe(0);
  });
});

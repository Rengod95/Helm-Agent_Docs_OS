import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { AccountEntry } from "@fresnel/client";
import type { ModelEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  initialChecks,
  poolsOf,
  withCheck,
  type ProviderCard,
} from "../../src/views/pages/providers/providers-model.ts";
import {
  AccountPool,
  AllowedRules,
  ModelAccessList,
  ProvidersView,
  RotationRow,
  providerStepsOf,
  rotationSummaryOf,
  usageLineOf,
  type ProvidersViewProps,
} from "../../src/views/pages/providers/providers-view.tsx";

// 모델과 계정 구역(P-11, DP-83·DP-84)의 서버 렌더. 제공자 카드(상태·사용량·시험 줄), 빈 상태의 고르기 격자, 회전 줄의 요약,
// 계정 목록, 모델 목록 스위치, 허용 규칙을 그린다. 문장은 `t()`로 비교한다. 시험 로케일은 ko다.

const NOOP = (): void => {};

function card(over: Partial<ProviderCard> = {}): ProviderCard {
  return {
    id: "anthropic",
    name: "Anthropic",
    mark: "A",
    custom: false,
    enabled: true,
    secretName: null,
    baseUrl: null,
    status: "connected",
    modelCount: 12,
    usage: null,
    ...over,
  };
}

function viewProps(over: Partial<ProvidersViewProps> = {}): ProvidersViewProps {
  return {
    cards: [card()],
    unreadable: null,
    editable: true,
    lockedText: null,
    error: null,
    addable: ["google", "openrouter"],
    steps: {},
    handlers: {
      onAdd: NOOP,
      onPick: NOOP,
      onCustom: NOOP,
      onToggle: NOOP,
      onKey: NOOP,
      onTest: NOOP,
      onBaseUrl: NOOP,
      onRemove: NOOP,
    },
    ...over,
  };
}

function account(accountId: string, priority: number, provider = "anthropic"): AccountEntry {
  return { provider, accountId, credential: `secret://${accountId}-key`, priority, reservePct: 10 };
}

function model(ref: string, name: string): ModelEntry {
  return { ref, name, contextWindow: 200_000, reasoning: false, inputPrice: 3, outputPrice: 15 };
}

describe("ProvidersView", () => {
  test("a card shows name, status with model count, usage and the key action", () => {
    const html = renderToString(
      <ProvidersView
        {...viewProps({
          cards: [card({ usage: { tokens: 1_200_000, usd: 3.4, requests: 120 } })],
        })}
      />,
    );
    expect(html).toContain("Anthropic");
    expect(html).toContain(t("desktop.providers.status.connected", { count: 12 }));
    expect(html).toContain(usageLineOf({ tokens: 1_200_000, usd: 3.4, requests: 120 }));
    expect(html).toContain(t("desktop.providers.key.add"));
    expect(html).toContain(t("desktop.providers.add"));
    expect(html).not.toContain('data-slot="check-steps"');
  });

  test("a stored key reads change key; a missing key says so", () => {
    const html = renderToString(
      <ProvidersView
        {...viewProps({
          cards: [
            card({ status: "missingKey", secretName: null }),
            card({ id: "openai", name: "OpenAI", mark: "O", status: "off" }),
          ],
        })}
      />,
    );
    expect(html).toContain(t("desktop.providers.status.missingKey"));
    expect(html).toContain(t("desktop.providers.status.off"));
  });

  test("an empty list shows the pick grid of known providers and no add button in the head", () => {
    const html = renderToString(<ProvidersView {...viewProps({ cards: [] })} />);
    expect(html).toContain(t("desktop.providers.empty.lead"));
    expect(html).toContain("Google");
    expect(html).toContain("OpenRouter");
    expect(html).toContain(t("desktop.providers.custom.title"));
    expect(html.match(/data-slot="provider-pick"/g)?.length).toBe(3);
  });

  test("a running test shows the steps under the card", () => {
    const checks = withCheck(initialChecks(), {
      id: "stored",
      state: "passed",
      reason: { kind: "stored", length: 41 },
      elapsedMs: 12,
    });
    const steps = providerStepsOf(checks, { onKey: NOOP, onEnable: NOOP });
    const html = renderToString(<ProvidersView {...viewProps({ steps: { anthropic: steps } })} />);
    expect(html).toContain('data-slot="check-steps"');
    expect(html).toContain(t("desktop.providers.check.detail.stored", { length: 41 }));
    expect(html).toContain("12ms");
  });

  test("an unreadable list shows only the note", () => {
    const html = renderToString(
      <ProvidersView
        {...viewProps({ cards: null, unreadable: t("desktop.providers.unreadable") })}
      />,
    );
    expect(html).toContain(t("desktop.providers.unreadable"));
    expect(html).not.toContain('data-slot="provider-card"');
  });
});

describe("providerStepsOf", () => {
  test("a missing key gives a fix and the add key action, later steps are skipped", () => {
    const checks = withCheck(initialChecks(), {
      id: "stored",
      state: "failed",
      reason: { kind: "missing" },
      elapsedMs: 5,
    });
    const steps = providerStepsOf(checks, { onKey: NOOP, onEnable: NOOP });
    expect(
      steps.map((step) => [step.id, step.state, step.detail ?? null, step.action?.label ?? null]),
    ).toEqual([
      [
        "stored",
        "failed",
        t("desktop.providers.check.detail.missing"),
        t("desktop.providers.key.add"),
      ],
      ["linked", "skipped", null, null],
      ["models", "skipped", null, null],
    ]);
  });
});

describe("rotation", () => {
  test("the summary says what rotates", () => {
    const pools = poolsOf([account("a", 0), account("b", 10), account("c", 0, "openai")]);
    expect(rotationSummaryOf("off", pools)).toBe(t("desktop.providers.rotation.summary.off"));
    expect(rotationSummaryOf("on", pools)).toBe(
      t("desktop.providers.rotation.summary.on", {
        list: t("desktop.providers.rotation.summary.pool", { name: "Anthropic", count: 2 }),
      }),
    );
    expect(rotationSummaryOf("on", poolsOf([account("a", 0)]))).toBe(
      t("desktop.providers.rotation.summary.none"),
    );
  });

  test("the row is one line with the switch, no acknowledged badge", () => {
    const html = renderToString(
      <RotationRow
        state="on"
        notice="risk"
        pools={[]}
        editable
        lockedText={null}
        error={null}
        asking={false}
        onToggle={NOOP}
        onConfirm={NOOP}
        onCancel={NOOP}
      />,
    );
    expect(html).toContain('data-layout="inline"');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('data-slot="badge"');
  });
});

describe("AccountPool", () => {
  test("an empty pool is one line, not a picture", () => {
    const html = renderToString(
      <AccountPool
        pools={[]}
        expanded={new Set()}
        editable
        onExpand={NOOP}
        onMove={NOOP}
        onReserve={NOOP}
        onRemove={NOOP}
      />,
    );
    expect(html).toContain(t("desktop.providers.pool.emptyLead"));
    expect(html).not.toContain("<svg");
  });

  test("accounts list under the provider name with their key names", () => {
    const html = renderToString(
      <AccountPool
        pools={poolsOf([account("work", 0), account("home", 10)])}
        expanded={new Set()}
        editable
        onExpand={NOOP}
        onMove={NOOP}
        onReserve={NOOP}
        onRemove={NOOP}
      />,
    );
    expect(html).toContain("Anthropic");
    expect(html).toContain("work-key");
    expect(html.indexOf("work")).toBeLessThan(html.indexOf("home"));
  });
});

describe("model policy parts", () => {
  test("the access list shows catalog models on and blocked ones off", () => {
    const html = renderToString(
      <ModelAccessList
        models={[model("anthropic/claude-a", "Claude A")]}
        denied={["anthropic/claude-old"]}
        query=""
        editable
        onQuery={NOOP}
        onUsable={NOOP}
      />,
    );
    expect(html).toContain("Claude A");
    expect(html).toContain("claude-old");
    expect(html).toContain(t("desktop.models.list.blocked"));
    expect(html.match(/data-usable="true"/g)?.length).toBe(1);
    expect(html.match(/data-usable="false"/g)?.length).toBe(1);
  });

  test("an empty catalog says where models come from", () => {
    const html = renderToString(
      <ModelAccessList models={[]} denied={[]} query="" editable onQuery={NOOP} onUsable={NOOP} />,
    );
    expect(html).toContain(t("desktop.models.list.empty"));
  });

  test("allow rules: empty means all, rules show as chips with quick provider chips", () => {
    const empty = renderToString(
      <AllowedRules
        rules={[]}
        quick={["anthropic"]}
        draft=""
        error={null}
        editable
        onDraft={NOOP}
        onAdd={NOOP}
        onRemove={NOOP}
      />,
    );
    expect(empty).toContain(t("desktop.models.allowed.all"));
    expect(empty).toContain(t("desktop.models.list.pattern", { name: "Anthropic" }));
    const some = renderToString(
      <AllowedRules
        rules={["openai/*"]}
        quick={[]}
        draft=""
        error={null}
        editable
        onDraft={NOOP}
        onAdd={NOOP}
        onRemove={NOOP}
      />,
    );
    expect(some).toContain("openai/*");
    expect(some).toContain(t("desktop.models.allowed.remove", { rule: "openai/*" }));
  });
});

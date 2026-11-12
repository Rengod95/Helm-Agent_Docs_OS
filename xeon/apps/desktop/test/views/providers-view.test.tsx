import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { AccountEntry } from "@fresnel/client";
import type { ModelEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { CheckStep } from "../../src/views/pages/shared/check-steps.tsx";
import {
  initialChecks,
  poolsOf,
  storeFailedChecks,
  withCheck,
  type ProviderCard,
} from "../../src/views/pages/providers/providers-model.ts";
import {
  AccountPool,
  AllowedRules,
  ErrorLine,
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

/** 넷째 단계가 이 원인으로 떨어진 점검 줄의 마지막 단계 */
function authStepOf(
  cause: "oauthTokenNotApiKey" | "badAddress" | "timeout",
): CheckStep | undefined {
  const steps = providerStepsOf(
    withCheck(initialChecks(), {
      id: "auth",
      state: "failed",
      reason: { kind: "authFailed", cause },
    }),
    { onKey: NOOP, onEnable: NOOP },
  );
  return steps[steps.length - 1];
}

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

describe("card status words", () => {
  test("an unchecked card says not checked, and a failed check shows its word and cause", () => {
    const failed = providerStepsOf(
      withCheck(initialChecks(), {
        id: "auth",
        state: "failed",
        reason: { kind: "authFailed", cause: "timeout" },
      }),
      { onKey: NOOP, onEnable: NOOP },
    );
    const html = renderToString(
      <ProvidersView
        {...viewProps({
          cards: [
            card({ status: "unchecked" }),
            card({ id: "openai", name: "OpenAI", mark: "O", status: "rejected" }),
          ],
          steps: { anthropic: failed },
        })}
      />,
    );
    expect(html).toContain(t("desktop.providers.status.unchecked"));
    expect(html).toContain(
      `${t("desktop.providers.status.unchecked")} · ${t("desktop.providers.check.detail.timeout")}`,
    );
    expect(html).toContain(t("desktop.providers.status.rejected"));
    expect(html).not.toContain(t("desktop.providers.status.connected", { count: 12 }));
  });
});

describe("key registration failure on the card", () => {
  test("the store step keeps the cause and its fix, and the card status line says the same cause", () => {
    const checks = storeFailedChecks(
      "이 컴퓨터에서만 값을 넣을 수 있어요",
      "값을 넣을 컴퓨터의 앱에서 등록해요",
    );
    const steps = providerStepsOf(checks, { onKey: NOOP, onEnable: NOOP });
    const html = renderToString(
      <ProvidersView
        {...viewProps({
          cards: [card({ status: "noKey", secretName: null, modelCount: 0 })],
          steps: { anthropic: steps },
        })}
      />,
    );
    expect(html).toContain("이 컴퓨터에서만 값을 넣을 수 있어요");
    expect(html).toContain("값을 넣을 컴퓨터의 앱에서 등록해요");
    expect(html).not.toContain(t("desktop.providers.status.noKey"));
    expect(html).toContain('data-slot="check-steps"');
  });

  test("a card with no failed step keeps its status words", () => {
    const html = renderToString(
      <ProvidersView
        {...viewProps({
          cards: [card({ status: "noKey", secretName: null, modelCount: 0 })],
        })}
      />,
    );
    expect(html).toContain(t("desktop.providers.status.noKey"));
  });
});

describe("ErrorLine", () => {
  test("a cause with a fix shows the cause as the alert and the fix under it", () => {
    const html = renderToString(
      <ErrorLine text="그 이름의 키가 없어요" fix="이름을 확인하거나 새 키로 등록해요" />,
    );
    expect(html).toContain('role="alert"');
    expect(html.indexOf("그 이름의 키가 없어요")).toBeLessThan(
      html.indexOf("이름을 확인하거나 새 키로 등록해요"),
    );
    expect(html).toContain("text-text-tertiary");
  });

  test("a cause without a fix is only the alert, and no text means nothing", () => {
    expect(renderToString(<ErrorLine text="키가 비어 있어요" />)).not.toContain(
      "text-text-tertiary",
    );
    expect(renderToString(<ErrorLine text={null} />)).toBe("");
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
      ["auth", "skipped", null, null],
    ]);
  });

  test("a rejected key says so with the status and the server reason, and offers to change the key", () => {
    const checks = withCheck(initialChecks(), {
      id: "auth",
      state: "failed",
      reason: { kind: "authFailed", cause: "rejected", status: 401, reason: "invalid key ••••" },
      elapsedMs: 80,
    });
    const [auth] = providerStepsOf(checks, { onKey: NOOP, onEnable: NOOP }).slice(-1);
    expect(auth?.detail).toBe(t("desktop.providers.check.detail.rejectedStatus", { status: 401 }));
    expect(auth?.fix).toBe(
      `${t("desktop.providers.check.fix.reason", { reason: "invalid key ••••" })} ${t("desktop.providers.check.fix.rejected")}`,
    );
    expect(auth?.action?.label).toBe(t("desktop.providers.key.change"));
  });

  test("an unsupported provider is a skipped step with its reason and no fix, not a failure", () => {
    const checks = withCheck(initialChecks(), {
      id: "auth",
      state: "neutral",
      reason: { kind: "authUnsupported" },
    });
    const [auth] = providerStepsOf(checks, { onKey: NOOP, onEnable: NOOP }).slice(-1);
    expect([auth?.state, auth?.detail, auth?.fix ?? null]).toEqual([
      "skipped",
      t("desktop.providers.check.detail.unsupported"),
      null,
    ]);
  });

  test("a subscription token gets the same sentence, and the other causes say what to check", () => {
    expect(authStepOf("oauthTokenNotApiKey")?.detail).toBe(
      t("desktop.providers.subscriptionToken.text"),
    );
    expect(authStepOf("badAddress")?.fix).toBe(t("desktop.providers.check.fix.badAddress"));
    expect(authStepOf("timeout")?.detail).toBe(t("desktop.providers.check.detail.timeout"));
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

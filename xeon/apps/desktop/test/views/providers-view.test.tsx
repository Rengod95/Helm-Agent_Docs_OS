import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { AccountEntry, RateLimitEntry } from "@fresnel/client";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  AccountPoolView,
  ChainMapView,
  EMPTY_ACCOUNT_DRAFT,
  RateLimitView,
  RoleRefsView,
  RotationRowView,
  UnreadableNote,
  UsagePanelView,
  type AccountPoolViewProps,
  type RateLimitViewProps,
  type RotationRowViewProps,
  type UsageLoad,
} from "../../src/views/pages/providers/providers-view.tsx";
import { poolsOf, rateRowsOf } from "../../src/views/pages/providers/providers-model.ts";
import { resetTextOf } from "../../src/views/pages/providers/providers-text.ts";

// 계정과 제공자 화면(P-11)의 서버 렌더. 빈 목록, 긴 계정 목록(접힘), 레이트 리밋 표, 모델 역할과 대체 사슬,
// 사용량 패널(읽는 중, 실패, 오프라인, 대화 없음, 값 있음), 계정 회전 행(꺼짐, 고지 필요, 켜짐, 잠김, 설정 없음),
// 읽을 수 없는 값을 그린다. 문장은 `t()`로 비교하고 값 글자는 그대로 비교한다. 시험 로케일은 ko다.

const NOOP = (): void => {};

function account(accountId: string, priority: number, provider = "anthropic"): AccountEntry {
  return { provider, accountId, credential: `secret://${accountId}`, priority, reservePct: 10 };
}

function poolProps(
  accounts: readonly AccountEntry[],
  over: Partial<AccountPoolViewProps> = {},
): AccountPoolViewProps {
  return {
    pools: poolsOf(accounts),
    expanded: new Set(),
    editable: true,
    draft: EMPTY_ACCOUNT_DRAFT,
    error: null,
    onDraft: NOOP,
    onAdd: NOOP,
    onExpand: NOOP,
    onMove: NOOP,
    onPriority: NOOP,
    onReserve: NOOP,
    onRemove: NOOP,
    ...over,
  };
}

describe("AccountPoolView", () => {
  test("no account says the default key is used", () => {
    const html = renderToString(<AccountPoolView {...poolProps([])} />);
    expect(html).toContain(t("desktop.providers.pool.empty"));
    expect(html).toContain(t("desktop.providers.pool.add"));
  });

  test("accounts show their credential reference, their reserve as an editable value, and their provider", () => {
    const html = renderToString(
      <AccountPoolView {...poolProps([account("work", 0), account("personal", 10)])} />,
    );
    expect(html).toContain("anthropic");
    expect(html).toContain("work");
    expect(html).toContain("secret://work");
    expect(html).toContain(`aria-label="work ${t("desktop.providers.field.reservePct")}"`);
    expect(html).toContain('value="10"');
  });

  test("a provider with more than twenty accounts folds the rest and offers to show all", () => {
    const many = Array.from({ length: 25 }, (_, index) => account(`acc-${String(index)}`, index));
    const folded = renderToString(<AccountPoolView {...poolProps(many)} />);
    expect(folded).toContain(t("desktop.providers.pool.hidden", { count: 5 }));
    expect(folded).toContain(t("desktop.providers.pool.expand"));
    expect(folded).not.toContain("acc-20");

    const open = renderToString(
      <AccountPoolView {...poolProps(many, { expanded: new Set(["anthropic"]) })} />,
    );
    expect(open).toContain("acc-24");
    expect(open).not.toContain(t("desktop.providers.pool.hidden", { count: 5 }));
  });

  test("with editing locked nothing takes focus or changes", () => {
    const html = renderToString(
      <AccountPoolView {...poolProps([account("work", 0)], { editable: false })} />,
    );
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain("disabled");
  });

  test("a rejected check shows its message under the form", () => {
    const html = renderToString(
      <AccountPoolView
        {...poolProps([], {
          error: t("desktop.providers.invalid", { field: t("desktop.providers.field.credential") }),
        })}
      />,
    );
    expect(html).toContain(
      t("desktop.providers.invalid", { field: t("desktop.providers.field.credential") }),
    );
  });
});

function rateProps(
  map: Readonly<Record<string, RateLimitEntry>>,
  over: Partial<RateLimitViewProps> = {},
): RateLimitViewProps {
  return {
    rows: rateRowsOf(map),
    editable: true,
    draftProvider: "",
    error: null,
    onDraftProvider: NOOP,
    onAdd: NOOP,
    onChange: NOOP,
    onRemove: NOOP,
    ...over,
  };
}

describe("RateLimitView", () => {
  test("no policy says so and states the default for providers without one", () => {
    const html = renderToString(<RateLimitView {...rateProps({})} />);
    expect(html).toContain(t("desktop.providers.rate.empty"));
    expect(html).toContain(t("desktop.providers.rate.defaultNote"));
  });

  test("a policy row shows its provider, its two numbers and a named action choice", () => {
    const html = renderToString(
      <RateLimitView
        {...rateProps({ anthropic: { minIntervalMs: 500, onLimit: "wait", maxWaitMs: 30000 } })}
      />,
    );
    expect(html).toContain("anthropic");
    expect(html).toContain('value="500"');
    expect(html).toContain('value="30000"');
    expect(html).toContain(`aria-label="anthropic ${t("desktop.providers.field.onLimit")}"`);
  });

  test("locked editing disables the policy inputs", () => {
    const html = renderToString(
      <RateLimitView
        {...rateProps(
          { openai: { minIntervalMs: 0, onLimit: "switch", maxWaitMs: 0 } },
          { editable: false },
        )}
      />,
    );
    expect(html).toContain("disabled");
  });
});

describe("role and chain editors", () => {
  test("a role without a reference says it uses the default model", () => {
    const html = renderToString(
      <RoleRefsView
        refs={{ main: "anthropic/claude-sonnet-5-5" }}
        editable={true}
        error={null}
        onCommit={NOOP}
      />,
    );
    expect(html).toContain('value="anthropic/claude-sonnet-5-5"');
    expect(html).toContain(t("desktop.providers.roles.default"));
    expect(html).toContain(t("desktop.providers.role.judge"));
  });

  test("an empty fallback chain says so and still lists every role", () => {
    const html = renderToString(
      <ChainMapView chains={{}} editable={true} error={null} onChange={NOOP} />,
    );
    expect(html).toContain(t("desktop.providers.chain.empty"));
    expect(html).toContain(t("desktop.providers.role.search"));
  });

  test("a filled fallback chain shows its models as tags", () => {
    const html = renderToString(
      <ChainMapView
        chains={{ main: ["anthropic/a", "openai/b"] }}
        editable={true}
        error={null}
        onChange={NOOP}
      />,
    );
    expect(html).toContain("anthropic/a");
    expect(html).toContain("openai/b");
    expect(html).not.toContain(t("desktop.providers.chain.empty"));
  });
});

function gaugeOf(over: Partial<UsageGauge> = {}): UsageGauge {
  return {
    id: "anthropic::session:tokens",
    providerId: "anthropic",
    account: null,
    window: "session",
    unit: "tokens",
    used: 41_000,
    limit: null,
    resetsAt: null,
    ...over,
  };
}

function usageProps(
  load: UsageLoad,
  over: Partial<{ offline: boolean; hasThread: boolean }> = {},
): Parameters<typeof UsagePanelView>[0] {
  return { load, offline: false, hasThread: true, onRetry: NOOP, ...over };
}

describe("usage panel", () => {
  test("while the values are read it says so and shows no numbers", () => {
    const html = renderToString(<UsagePanelView {...usageProps({ status: "loading" })} />);
    expect(html).toContain(t("desktop.providers.usage.title"));
    expect(html).toContain(t("desktop.providers.usage.loading"));
    expect(html).toContain('role="status"');
    expect(html).not.toContain("41천");
  });

  test("a failed read names the failure and offers a read again", () => {
    const message = t("desktop.providers.usage.failed");
    const html = renderToString(<UsagePanelView {...usageProps({ status: "failed", message })} />);
    expect(html).toContain(message);
    expect(html).toContain(t("desktop.providers.usage.retry"));
    expect(html).toContain("<button");
  });

  test("offline says it is not connected and keeps the last numbers out of view", () => {
    const load: UsageLoad = { status: "ready", gauges: [gaugeOf()] };
    const html = renderToString(<UsagePanelView {...usageProps(load, { offline: true })} />);
    expect(html).toContain(t("desktop.providers.usage.offline"));
    expect(html).not.toContain("41천");
  });

  test("without a conversation it says to pick one and shows no gauges", () => {
    const load: UsageLoad = { status: "ready", gauges: [gaugeOf()] };
    const html = renderToString(<UsagePanelView {...usageProps(load, { hasThread: false })} />);
    expect(html).toContain(t("desktop.providers.usage.noThread"));
    expect(html).not.toContain("41천");
  });

  test("a conversation with no usage says so", () => {
    const html = renderToString(
      <UsagePanelView {...usageProps({ status: "ready", gauges: [] })} />,
    );
    expect(html).toContain(t("desktop.providers.usage.empty"));
  });

  test("a gauge without a limit says the usage and that the limit is unknown, as the screen reader sentence", () => {
    const html = renderToString(
      <UsagePanelView {...usageProps({ status: "ready", gauges: [gaugeOf()] })} />,
    );
    expect(html).toContain('aria-label="anthropic 토큰 41천, 한도 모름"');
    expect(html).toContain("anthropic 토큰");
    expect(html).toContain("41천");
    expect(html).toContain(t("desktop.providers.usage.limitUnknown"));
    // 한도를 모르면 막대에 숫자를 지어내지 않는다(빈 막대 자리만 보인다)
    expect(html).not.toContain("aria-valuenow");
  });

  test("a known limit is shown as a fraction of it and the reset line stays out until the wire gives one", () => {
    const html = renderToString(
      <UsagePanelView
        {...usageProps({
          status: "ready",
          gauges: [gaugeOf({ limit: 100_000 })],
        })}
      />,
    );
    expect(html).toContain('aria-label="anthropic 토큰 41천, 100천 중"');
    // 막대는 장식(aria-hidden)이고 채운 비율은 글 줄의 이름 문장이 말한다. 막대 칸에는 비율만 들어간다
    expect(html).toContain("--cs-progress:41%");
    expect(html).toContain("100천 중");
    expect(html).not.toContain(t("desktop.providers.usage.limitUnknown"));
    expect(html).not.toContain("재설정");
  });

  test("a reset time the wire gives is shown in the local time sentence", () => {
    const resetsAt = "2026-11-05T09:30:00.000Z";
    const html = renderToString(
      <UsagePanelView
        {...usageProps({
          status: "ready",
          gauges: [gaugeOf({ resetsAt })],
        })}
      />,
    );
    expect(html).toContain(
      t("desktop.providers.usage.resets", { time: resetTextOf(resetsAt, "ko") }),
    );
    expect(html).not.toContain("한도와 재설정 시각은 아직 몰라요");
  });

  test("a cost gauge is shown in dollars and a windowed gauge names its window", () => {
    const html = renderToString(
      <UsagePanelView
        {...usageProps({
          status: "ready",
          gauges: [gaugeOf({ id: "anthropic::day:usd", window: "day", unit: "usd", used: 0.82 })],
        })}
      />,
    );
    expect(html).toContain("anthropic 하루 비용");
    expect(html).toContain("$0.82");
  });
});

function rotationProps(over: Partial<RotationRowViewProps> = {}): RotationRowViewProps {
  return {
    state: "off",
    notice: t("client.accounts.rotationRiskNotice"),
    editable: true,
    lockedText: null,
    error: null,
    asking: false,
    onToggle: NOOP,
    onConfirm: NOOP,
    onCancel: NOOP,
    ...over,
  };
}

describe("unreadable values and the rotation row", () => {
  test("an unreadable value is named as unreadable and cannot be edited here", () => {
    const html = renderToString(
      <UnreadableNote message={t("desktop.providers.pool.unreadable")} />,
    );
    expect(html).toContain(t("desktop.providers.pool.unreadable"));
  });

  test("the rotation switch is on only in the on state, and only the on state shows the acknowledged badge", () => {
    const off = renderToString(<RotationRowView {...rotationProps({ state: "off" })} />);
    const needsNotice = renderToString(
      <RotationRowView {...rotationProps({ state: "needsNotice" })} />,
    );
    const on = renderToString(<RotationRowView {...rotationProps({ state: "on" })} />);
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain(t("desktop.providers.rotation.acknowledged"));
    expect(needsNotice).toContain('aria-checked="false"');
    expect(needsNotice).not.toContain(t("desktop.providers.rotation.acknowledged"));
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain(t("desktop.providers.rotation.acknowledged"));
  });

  test("only the needs-notice state shows the terms warning", () => {
    const warning = t("desktop.providers.rotation.warning");
    expect(
      renderToString(<RotationRowView {...rotationProps({ state: "needsNotice" })} />),
    ).toContain(warning);
    expect(renderToString(<RotationRowView {...rotationProps({ state: "off" })} />)).not.toContain(
      warning,
    );
    expect(renderToString(<RotationRowView {...rotationProps({ state: "on" })} />)).not.toContain(
      warning,
    );
  });

  test("offline or locked, the switch is disabled and the reason is a sentence", () => {
    const html = renderToString(
      <RotationRowView
        {...rotationProps({
          state: "off",
          editable: false,
          lockedText: t("desktop.providers.rotation.offline"),
        })}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain(t("desktop.providers.rotation.offline"));
  });

  test("an engine without the setting shows the row locked with a sentence and no state badge", () => {
    const html = renderToString(
      <RotationRowView
        {...rotationProps({
          state: null,
          editable: false,
          lockedText: t("desktop.providers.rotation.missing"),
        })}
      />,
    );
    expect(html).toContain(t("desktop.providers.rotation.missing"));
    expect(html).not.toContain("꺼짐");
    expect(html).not.toContain("켜짐");
    expect(html).toContain('aria-checked="false"');
  });

  test("a save error sits under the row", () => {
    const html = renderToString(
      <RotationRowView {...rotationProps({ error: "저장하지 못했어요" })} />,
    );
    expect(html).toContain("저장하지 못했어요");
  });

  test("the risk dialog is not drawn while it is closed", () => {
    const html = renderToString(
      <RotationRowView {...rotationProps({ state: "needsNotice", asking: false })} />,
    );
    expect(html).not.toContain(t("desktop.providers.rotation.confirm.accept"));
    expect(html).not.toContain(t("desktop.providers.rotation.confirm.title"));
  });
});

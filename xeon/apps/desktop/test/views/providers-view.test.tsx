import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { AccountEntry, RateLimitEntry } from "@fresnel/client";
import type { GaugeSlotVM } from "@fresnel/client/settings";
import { renderToString } from "react-dom/server";
import {
  AccountPoolView,
  ChainMapView,
  EMPTY_ACCOUNT_DRAFT,
  GaugeSlotView,
  RateLimitView,
  RoleRefsView,
  UnreadableNote,
  type AccountPoolViewProps,
  type RateLimitViewProps,
} from "../../src/views/pages/providers/providers-view.tsx";
import { poolsOf, rateRowsOf } from "../../src/views/pages/providers/providers-model.ts";

// 계정과 제공자 화면(P-11)의 서버 렌더. 빈 목록, 긴 계정 목록(접힘), 레이트 리밋 표, 모델 역할과 대체 사슬, 게이지 자리,
// 읽을 수 없는 값, 잠긴 상태를 그린다. 문장은 `t()`로 비교하고 값 글자는 그대로 비교한다.

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

  test("accounts show their credential reference and reserve, and their provider", () => {
    const html = renderToString(
      <AccountPoolView {...poolProps([account("work", 0), account("personal", 10)])} />,
    );
    expect(html).toContain("anthropic");
    expect(html).toContain("work");
    expect(html).toContain(
      t("desktop.providers.pool.detail", { credential: "secret://work", reservePct: 10 }),
    );
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

describe("gauge slot and unreadable values", () => {
  test("the gauge slot says the usage is not visible yet", () => {
    const gauge: GaugeSlotVM = {
      tab: "providers",
      status: "unavailable",
      text: "사용량 정보는 아직 볼 수 없어요",
    };
    const html = renderToString(<GaugeSlotView gauge={gauge} />);
    expect(html).toContain("사용량 정보는 아직 볼 수 없어요");
    expect(html).toContain('role="status"');
  });

  test("an unreadable value is named as unreadable and cannot be edited here", () => {
    const html = renderToString(
      <UnreadableNote message={t("desktop.providers.pool.unreadable")} />,
    );
    expect(html).toContain(t("desktop.providers.pool.unreadable"));
  });
});

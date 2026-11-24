// P-17 측정 탭 그림과 상세 머리(ADR-0022 §3.3, AGE-76 plugMin). 값이 있을 때, 빈 문장, 오류 한 줄, 오프라인, 읽는 중, 마지막 값을 본다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  INITIAL_WORKBENCH,
  listLoaded,
  type BurdenRowVM,
  type GroupMetricsVM,
  type TabRead,
} from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { DetailActions } from "../../../src/views/workbench/detail-actions.tsx";
import { ExtDetail } from "../../../src/views/workbench/ext-detail.tsx";
import { MetricsPanel, type MetricsBody } from "../../../src/views/workbench/metrics-tab.tsx";
import { tabLinkOf } from "../../../src/views/workbench/tab-read.ts";
import { entry, inContexts } from "./support.tsx";

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 배지 글, 그린 순서대로 */
const badgesOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="badge"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");

/** 측정 탭의 값과 이름(caustic CardStat 칸의 label·value), 그린 순서대로 */
const valuesOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="card-stat-value"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");
const labelsOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="card-stat-label"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");

const skeletonOf = (html: string): boolean => html.includes('data-slot="skeleton"');

const ready = <T,>(value: T, stale = false): TabRead<T> => ({ kind: "ready", value, stale });

const METRICS: GroupMetricsVM = {
  tokens: [
    { key: "input", value: 1200 },
    { key: "output", value: 300 },
    { key: "cacheRead", value: 900 },
    { key: "cacheWrite", value: 50 },
  ],
  costUsd: 3.1,
  lead: { unit: "min", value: 41 },
  denies: 12,
  handlerErrors: 1,
  posts: 7,
  spawns: 3,
};

const num = (value: number): string => t("desktop.workbench.metrics.number", { value });

describe("측정 탭 그림", () => {
  test("그룹이 아니면 성능 측정 화면의 부담 표와 같은 칸(훅 시간, 토큰, 호출, 캐시 사건, 실패)을 보인다", () => {
    const row: BurdenRowVM = {
      owner: "docs",
      turns: 4,
      sectionTokens: 0,
      tokensPerTurn: 120,
      tokensEstimated: true,
      hookMs: 90,
      msPerTurn: 23,
      problems: 2,
      cacheEvents: 1,
      costUsd: null,
      callTokens: 0,
      callCount: 3,
      worstTurnId: "turn-1",
    };
    const html = renderToString(
      <MetricsPanel view={{ kind: "plugin", read: ready({ kind: "ready", turns: 4, row }) }} />,
    );
    expect(labelsOf(html)).toEqual([
      t("desktop.measure.perf.col.time"),
      t("desktop.measure.perf.col.tokens"),
      t("desktop.workbench.metrics.plugin.calls"),
      t("desktop.measure.perf.col.cache"),
      t("desktop.measure.perf.col.problems"),
    ]);
    expect(valuesOf(html)).toEqual([
      t("desktop.measure.ms", { ms: 23 }),
      t("desktop.measure.perf.tokensEstimated", { count: num(120) }),
      num(3),
      num(1),
      num(2),
    ]);
    expect(textOf(html)).toContain(t("desktop.workbench.metrics.plugin.range", { turns: 4 }));
  });

  test("그룹이 아니고 읽은 Turn에 이 확장이 없거나 읽을 Turn이 없으면 한 문장만 보인다", () => {
    const unused = renderToString(
      <MetricsPanel
        view={{ kind: "plugin", read: ready({ kind: "ready", turns: 3, row: null }) }}
      />,
    );
    expect(textOf(unused)).toBe(t("desktop.workbench.metrics.plugin.unused", { turns: 3 }));
    const empty = renderToString(
      <MetricsPanel view={{ kind: "plugin", read: ready({ kind: "empty" }) }} />,
    );
    expect(textOf(empty)).toBe(t("desktop.workbench.metrics.plugin.empty"));
    const off = renderToString(
      <MetricsPanel view={{ kind: "plugin", read: ready({ kind: "off" }) }} />,
    );
    expect(textOf(off)).toBe(t("desktop.workbench.metrics.off"));
  });

  test("값이 있으면 토큰 네 칸, 정가 기준 추정 비용, 나머지 칸을 보인다", () => {
    const view: MetricsBody = { kind: "read", read: ready(METRICS) };
    const html = renderToString(<MetricsPanel view={view} />);
    expect(labelsOf(html)).toEqual([
      t("desktop.workbench.metrics.token.input"),
      t("desktop.workbench.metrics.token.output"),
      t("desktop.workbench.metrics.token.cacheRead"),
      t("desktop.workbench.metrics.token.cacheWrite"),
      t("desktop.workbench.metrics.lead"),
      t("desktop.workbench.metrics.denies"),
      t("desktop.workbench.metrics.handlerErrors"),
      t("desktop.workbench.metrics.posts"),
      t("desktop.workbench.metrics.spawns"),
    ]);
    expect(valuesOf(html)).toEqual([
      num(1200),
      num(300),
      num(900),
      num(50),
      t("desktop.workbench.metrics.lead.min", { value: 41 }),
      num(12),
      num(1),
      num(7),
      num(3),
    ]);
    expect(textOf(html)).toContain(t("desktop.workbench.metrics.cost", { amount: "$3.10" }));
    expect(textOf(html)).toContain(t("desktop.workbench.metrics.costNote"));
  });

  test("계측이 꺼져 있으면 빈 문장만 보이고 칸은 없다", () => {
    const html = renderToString(<MetricsPanel view={{ kind: "read", read: ready(null) }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.metrics.off"));
    expect(html).not.toContain("<dl");
  });

  test("읽기가 실패하면 오류 한 줄만 보인다", () => {
    const html = renderToString(<MetricsPanel view={{ kind: "read", read: { kind: "error" } }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.load.failed"));
    expect(valuesOf(html)).toEqual([]);
  });

  test("연결이 끊기면 오프라인 한 줄이고, 마지막 값이 있으면 그 값을 stale로 보인다", () => {
    const offline = renderToString(
      <MetricsPanel view={{ kind: "read", read: { kind: "offline" } }} />,
    );
    expect(textOf(offline)).toBe(t("desktop.workbench.detail.offline"));
    const stale = renderToString(
      <MetricsPanel view={{ kind: "read", read: ready(METRICS, true) }} />,
    );
    expect(textOf(stale).startsWith(t("desktop.workbench.detail.stale"))).toBe(true);
    expect(valuesOf(stale)).toHaveLength(9);
  });

  test("읽는 중에는 Skeleton이다", () => {
    const html = renderToString(
      <MetricsPanel view={{ kind: "read", read: { kind: "loading" } }} />,
    );
    expect(skeletonOf(html)).toBe(true);
    expect(valuesOf(html)).toEqual([]);
  });
});

/** 확장 목록을 읽은 상태로 상세를 그린다 */
function detailHtml(over: Parameters<typeof entry>[1]): string {
  const row = entry("web", over);
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <ExtDetail
        entry={row}
        tab="overview"
        card={null}
        readiness={null}
        profiles={{ set: null, reload: () => undefined }}
        onTab={() => undefined}
        onRetry={() => undefined}
        onStop={() => undefined}
        onRecheck={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

/** 이름 줄(상세 맨 위 `<header>`)의 글 */
function nameLineOf(html: string): string {
  return textOf(/<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "");
}

/** 시스템 머리줄 오른쪽의 상세 행동 */
function actionsOf(over: Parameters<typeof entry>[1]): string {
  const row = entry("web", over);
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <DetailActions
        entry={row}
        profiles={{ set: null, reload: () => undefined }}
        onRemove={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

describe("상세 이름 줄과 머리 행동(plugHead)", () => {
  test("이름 줄은 이름, 괄호 안 id, 종류, 버전 셋만이고 출처와 쓰는 곳은 없다", () => {
    const html = detailHtml({ origin: "user", enabledSource: "profile", displayName: "웹" });
    expect(nameLineOf(html)).toBe(`웹(web)${t("desktop.workbench.kind.plugin")}1.0.0`);
    expect(nameLineOf(html)).not.toContain(t("desktop.workbench.origin.user"));
    expect(badgesOf(html)).toEqual([]);
    expect(html).not.toContain('role="switch"');
  });

  test("앱 핵심이 아닌 플러그인은 '프로필에 넣기' 메뉴와 지우기가 든 메뉴를 둔다", () => {
    const html = actionsOf({ origin: "user", enabledSource: "profile" });
    expect(textOf(html)).toContain(t("desktop.workbench.use.put"));
    expect(html).toContain(`aria-label="${t("desktop.workbench.detail.menu")}"`);
    expect(textOf(html)).not.toContain(t("desktop.workbench.core.locked"));
  });

  test("앱 핵심(코어 출처)은 자물쇠 문장만 두고 넣기, 끄기, 지우기가 없다", () => {
    const html = actionsOf({ origin: "builtin", enabledSource: "core" });
    expect(textOf(html)).toContain(t("desktop.workbench.core.locked"));
    expect(textOf(html)).not.toContain(t("desktop.workbench.use.put"));
    expect(html).not.toContain(`aria-label="${t("desktop.workbench.detail.menu")}"`);
  });
});

describe("탭 연결 상태", () => {
  test("연결 단계를 탭의 연결 상태로 줄인다. 연결 중과 재동기화는 pending이다", () => {
    expect(tabLinkOf("live")).toBe("live");
    expect(tabLinkOf("offline")).toBe("offline");
    expect(tabLinkOf("failed")).toBe("offline");
    expect(tabLinkOf("connecting")).toBe("pending");
    expect(tabLinkOf("syncing")).toBe("pending");
    expect(tabLinkOf("resync")).toBe("pending");
    expect(tabLinkOf("reset")).toBe("pending");
  });
});

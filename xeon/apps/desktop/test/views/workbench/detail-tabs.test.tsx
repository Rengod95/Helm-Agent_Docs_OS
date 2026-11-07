// P-17 설정·측정·화면 탭 그림과 머리 출처 배지(ADR-0022 §3.3). 값이 있을 때, 빈 문장, 오류 한 줄, 오프라인, 읽는 중, 마지막 값을 본다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  INITIAL_WORKBENCH,
  listLoaded,
  type ExtSettingRowVM,
  type GroupMetricsVM,
  type ScreenRowVM,
  type TabRead,
} from "@fresnel/client/workbench";
import type { EffectiveSetting } from "@fresnel/contracts/settings";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { ExtDetail } from "../../../src/views/workbench/ext-detail.tsx";
import { MetricsPanel, type MetricsBody } from "../../../src/views/workbench/metrics-tab.tsx";
import { ScreensPanel } from "../../../src/views/workbench/screens-tab.tsx";
import { SettingsPanel } from "../../../src/views/workbench/settings-tab.tsx";
import { tabLinkOf } from "../../../src/views/workbench/tab-read.ts";
import { entry, inContexts } from "./support.tsx";

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 배지 글, 그린 순서대로 */
const badgesOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="badge"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");

/** 설정 탭의 값 칸 글, 그린 순서대로 */
const settingValuesOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="setting-value"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");

/** 설정 줄의 적용 시점 자리 글(보이는 쪽), 그린 순서대로. 즉시는 빈 글이다 */
const applyMarksOf = (html: string): string[] =>
  [
    ...html.matchAll(
      /aria-hidden="true" class="flex flex-none items-center gap-2">([\s\S]*?)<\/div>/g,
    ),
  ].map((m) => textOf(m[1] ?? ""));

/** 낭독기에만 읽히는 줄 글(이름 뒤 적용 시점), 그린 순서대로 */
const srOnlyOf = (html: string): string[] =>
  [...html.matchAll(/class="sr-only">([^<]*)</g)].map((m) => m[1] ?? "");

/** 측정 탭의 값과 이름(caustic CardStat 칸의 label·value), 그린 순서대로 */
const valuesOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="card-stat-value"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");
const labelsOf = (html: string): string[] =>
  [...html.matchAll(/data-slot="card-stat-label"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");

/** 화면 탭의 상태 점: 색(`data-tone`)과 글, 그린 순서대로 */
const statesOf = (html: string): { tone: string; text: string }[] =>
  [
    ...html.matchAll(
      /data-slot="status-dot" data-tone="(\w+)"[\s\S]*?data-slot="status-dot-label"[^>]*>([^<]*)</g,
    ),
  ].map((m) => ({ tone: m[1] ?? "", text: m[2] ?? "" }));

const skeletonOf = (html: string): boolean => html.includes('data-slot="skeleton"');

const ready = <T,>(value: T, stale = false): TabRead<T> => ({ kind: "ready", value, stale });

const SETTINGS: readonly ExtSettingRowVM[] = [
  {
    key: "ext.web.enabled",
    label: "웹 검색 켜기",
    value: { kind: "text", text: "true" },
    scope: "global",
  },
  { key: "ext.web.apiKey", label: "키", value: { kind: "secret" }, scope: "global" },
  { key: "ext.web.model", label: "모델", value: { kind: "unset" }, scope: "thread" },
];

/** 엔진 설정 값 하나(시험용). 빠진 칸은 기본값이다 */
function effective(
  key: string,
  over: Partial<Omit<EffectiveSetting, "key">> = {},
): EffectiveSetting {
  return {
    key,
    value: null,
    source: { scope: "default" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
    ...over,
  };
}

/** 적용 시점과 출처가 다른 세 줄: 즉시, 다음 턴, 재시작 */
const TIMED: readonly (ExtSettingRowVM & { readonly setting: EffectiveSetting })[] = [
  {
    key: "ext.web.enabled",
    label: "웹 검색 켜기",
    value: { kind: "text", text: "true" },
    scope: "global",
    setting: effective("ext.web.enabled", { source: { scope: "user", path: "/u/settings.json" } }),
  },
  {
    key: "ext.web.model",
    label: "모델",
    value: { kind: "text", text: "m1" },
    scope: "project",
    setting: effective("ext.web.model", {
      source: { scope: "project", path: "/p/.fresnel/settings.json" },
      runtimeChange: "nextTurn",
      pendingUntil: "nextTurn",
    }),
  },
  {
    key: "ext.web.port",
    label: "포트",
    value: { kind: "text", text: "8080" },
    scope: "global",
    setting: effective("ext.web.port", {
      source: { scope: "user", path: "/u/settings.json" },
      runtimeChange: "restart",
      pendingUntil: "restart",
    }),
  },
];

/** 다른 범위(프로젝트)가 이긴 줄에 사용자 범위 값이 가려져 있다 */
const SHADOWED: readonly (ExtSettingRowVM & { readonly setting: EffectiveSetting })[] = [
  {
    key: "ext.web.model",
    label: "모델",
    value: { kind: "text", text: "m2" },
    scope: "project",
    setting: effective("ext.web.model", {
      source: { scope: "project", path: "/p/.fresnel/settings.json" },
      shadowed: [{ scope: "user", path: "/u/settings.json" }],
    }),
  },
];

/** 이 대화(launch)에서 정한 값이 줄을 이긴다. 가려진 목록은 펼쳐져 있어야 한다 */
const THREAD_SHADOWED: readonly (ExtSettingRowVM & { readonly setting: EffectiveSetting })[] = [
  {
    key: "ext.web.model",
    label: "모델",
    value: { kind: "text", text: "m3" },
    scope: "thread",
    setting: effective("ext.web.model", {
      source: { scope: "launch" },
      shadowed: [{ scope: "user", path: "/u/settings.json" }],
    }),
  },
];

describe("설정 탭 그림", () => {
  test("값이 있으면 줄마다 이름, 값, 범위 배지를 보인다. 키는 그리지 않고 시크릿은 값 없이 가린다", () => {
    const html = renderToString(<SettingsPanel read={ready(SETTINGS)} />);
    expect(textOf(html)).not.toContain("ext.web.enabled");
    expect(textOf(html)).toContain("웹 검색 켜기");
    expect(settingValuesOf(html)).toEqual([
      "true",
      t("desktop.workbench.detail.settings.secret"),
      t("desktop.workbench.detail.settings.unset"),
    ]);
    expect(badgesOf(html)).toEqual([
      t("desktop.workbench.scope.global"),
      t("desktop.workbench.scope.global"),
      t("desktop.workbench.scope.thread"),
    ]);
    expect(textOf(html)).not.toContain(t("desktop.workbench.detail.stale"));
  });

  test("마지막 값이면 '마지막으로 읽은 값' 글을 먼저 보인다", () => {
    const html = renderToString(<SettingsPanel read={ready(SETTINGS, true)} />);
    expect(textOf(html).startsWith(t("desktop.workbench.detail.stale"))).toBe(true);
    expect(badgesOf(html)).toHaveLength(3);
  });

  test("설정이 없으면 빈 문장만 보이고 줄과 배지는 없다", () => {
    const html = renderToString(<SettingsPanel read={ready([])} />);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.settings.empty"));
    expect(badgesOf(html)).toEqual([]);
  });

  test("읽기가 실패하면 오류 한 줄만 보인다", () => {
    const html = renderToString(<SettingsPanel read={{ kind: "error" }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.load.failed"));
    expect(settingValuesOf(html)).toEqual([]);
  });

  test("읽는 중에는 Skeleton, 연결이 없고 읽은 값이 없으면 오프라인 한 줄이다", () => {
    expect(skeletonOf(renderToString(<SettingsPanel read={{ kind: "loading" }} />))).toBe(true);
    const offline = renderToString(<SettingsPanel read={{ kind: "offline" }} />);
    expect(textOf(offline)).toBe(t("desktop.workbench.detail.offline"));
  });

  test("적용 시점: 즉시는 글을 그리지 않고, 다음 턴은 연한 글, 재시작은 warning 배지다. 셋 다 낭독기에 읽힌다", () => {
    const html = renderToString(<SettingsPanel read={ready(TIMED)} />);
    expect(applyMarksOf(html)).toEqual([
      "",
      t("client.settings.runtime.nextTurn"),
      t("client.settings.runtime.restart"),
    ]);
    expect(badgesOf(html)).toEqual([
      t("desktop.workbench.scope.global"),
      t("desktop.workbench.scope.project"),
      t("desktop.workbench.scope.global"),
      t("client.settings.runtime.restart"),
    ]);
    expect(srOnlyOf(html)).toEqual([
      `, ${t("client.settings.runtime.live")}`,
      `, ${t("client.settings.runtime.nextTurn")}`,
      `, ${t("client.settings.runtime.restart")}`,
    ]);
  });

  test("값 출처 줄은 이긴 범위와 파일 경로를 보인다", () => {
    const html = renderToString(<SettingsPanel read={ready(TIMED)} />);
    expect(textOf(html)).toContain(t("desktop.workbench.detail.settings.source"));
    expect(textOf(html)).toContain(
      t("desktop.workbench.detail.settings.wins", {
        scope: t("desktop.workbench.scope.project"),
      }),
    );
    expect(textOf(html)).toContain("/p/.fresnel/settings.json");
  });

  test("읽기에 설정 값이 없는 줄은 적용 시점 자리와 낭독기 글을 비운다", () => {
    const html = renderToString(<SettingsPanel read={ready(SETTINGS)} />);
    expect(applyMarksOf(html)).toEqual(["", "", ""]);
    expect(srOnlyOf(html)).toEqual([]);
  });

  test("가려진 범위가 있으면 접힌 목록 단추만 보이고, 펼치면 범위와 파일 경로를 보인다", () => {
    const html = renderToString(<SettingsPanel read={ready(SHADOWED)} />);
    expect(html).toContain('aria-expanded="false"');
    expect(textOf(html)).toContain(t("desktop.workbench.detail.settings.shadowed"));
    expect(textOf(html)).not.toContain("/u/settings.json");
  });

  test("이 대화에서 정한 값이면 가려진 목록을 펼쳐 둔다", () => {
    const html = renderToString(<SettingsPanel read={ready(THREAD_SHADOWED)} />);
    expect(html).toContain('aria-expanded="true"');
    expect(textOf(html)).toContain("/u/settings.json");
    expect(textOf(html)).toContain(t("desktop.workbench.scope.global"));
  });

  test("가려진 범위가 없으면 목록 단추를 두지 않는다", () => {
    const html = renderToString(<SettingsPanel read={ready(TIMED)} />);
    expect(html).not.toContain("aria-expanded");
    expect(textOf(html)).not.toContain(t("desktop.workbench.detail.settings.shadowed"));
  });
});

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
  test("그룹이 아니면 읽지 않고 빈 문장만 보인다", () => {
    const html = renderToString(<MetricsPanel view={{ kind: "none" }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.metrics.notGroup"));
    expect(html).not.toContain("<dl");
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

const SCREENS: readonly ScreenRowVM[] = [
  { id: "panel", title: "웹 패널", placement: "panel", mode: "native", state: "ok", issues: 0 },
  { id: "status", title: "상태", placement: "status", mode: "app", state: "invalid", issues: 2 },
];

describe("화면 탭 그림", () => {
  test("값이 있으면 화면마다 자리, 모드, 상태 배지와 진단 수를 보인다", () => {
    const html = renderToString(<ScreensPanel read={ready(SCREENS)} />);
    expect(textOf(html)).toContain("웹 패널");
    // 자리와 모드는 시안처럼 글로 보인다(배지 아님)
    expect(badgesOf(html)).toEqual([]);
    expect(textOf(html)).toContain(t("desktop.workbench.placement.panel"));
    expect(textOf(html)).toContain(t("desktop.workbench.uiMode.native"));
    expect(textOf(html)).toContain(t("desktop.workbench.placement.status"));
    expect(textOf(html)).toContain(t("desktop.workbench.uiMode.app"));
    expect(statesOf(html)).toEqual([
      { tone: "success", text: t("desktop.workbench.screenState.ok") },
      { tone: "danger", text: t("desktop.workbench.screenState.invalid") },
    ]);
    expect(textOf(html)).toContain(t("desktop.workbench.screens.issues", { count: 2 }));
    expect(textOf(html).split(t("desktop.workbench.screens.issues", { count: 2 }))).toHaveLength(2);
  });

  test("화면이 없으면 빈 문장만 보인다", () => {
    const html = renderToString(<ScreensPanel read={ready([])} />);
    expect(textOf(html)).toBe(t("desktop.workbench.screens.empty"));
    expect(statesOf(html)).toEqual([]);
  });

  test("읽기가 실패하면 오류 한 줄만 보인다", () => {
    const html = renderToString(<ScreensPanel read={{ kind: "error" }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.load.failed"));
  });

  test("연결이 없고 읽은 값이 없으면 오프라인 한 줄이다", () => {
    const html = renderToString(<ScreensPanel read={{ kind: "offline" }} />);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.offline"));
  });
});

/** 머리에 배지를 두려고 확장 목록을 읽은 상태로 상세를 그린다 */
function headerOf(over: Parameters<typeof entry>[1]): string {
  const row = entry("web", over);
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <ExtDetail
        state={state}
        entry={row}
        tab="overview"
        onTab={() => undefined}
        onBack={() => undefined}
        onToggle={() => undefined}
        onKeepOn={() => undefined}
        onKeepOff={() => undefined}
        onRemove={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

describe("머리 출처 글", () => {
  // 시안 머리 줄은 배지 대신 글로 잇는다: 설치 위치 · 종류 · 버전, 상태 글 뒤에 범위 글
  test("설치 위치와 켜짐 범위를 머리 글로 보이고 배지는 두지 않는다(사용자 설치, 전역)", () => {
    const html = headerOf({ origin: "user", enabledSource: "user" });
    expect(textOf(html)).toContain(t("desktop.workbench.origin.user"));
    expect(textOf(html)).toContain(t("desktop.workbench.scope.global"));
    expect(badgesOf(html)).toEqual([]);
  });

  test("작업 폴더 등급과 이 대화 출처를 보이고, 출처가 없으면 범위 글을 두지 않는다", () => {
    const withThread = headerOf({ origin: "project", enabledSource: "thread" });
    expect(textOf(withThread)).toContain(t("desktop.workbench.origin.project"));
    expect(textOf(withThread)).toContain(t("desktop.workbench.scope.thread"));
    const withoutSource = headerOf({ origin: "builtin" });
    expect(textOf(withoutSource)).toContain(t("desktop.workbench.origin.builtin"));
    expect(textOf(withoutSource)).not.toContain(t("desktop.workbench.scope.global"));
  });

  test("작업 폴더 범위는 wire가 준 출처가 project일 때만 보인다", () => {
    const html = headerOf({ origin: "user", enabledSource: "project" });
    expect(textOf(html)).toContain(t("desktop.workbench.scope.project"));
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

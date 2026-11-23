// 플러그인 상세 "개요" 탭 그림(plugTab, plugWire): 카드가 없을 때와 목적이 없을 때의 글, 엔진 카드의 도구 칸에서 모은 준비 상태의
// 경고와 설치 안내(도구 플러그인 자신, 도구에 기대는 플러그인), 준비 상태가 없으면 구역을 그리지 않는 것을 본다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import type { CardExternalTool, PluginCard } from "@fresnel/contracts/extensions";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { DetailOverview } from "../../../src/views/workbench/detail-overview.tsx";
import { toolReadinessOf, type ToolReadinessVM } from "../../../src/views/workbench/tool-ready.ts";
import { entry, inContexts } from "./support.tsx";

function card(over: Partial<PluginCard> = {}): PluginCard {
  return {
    name: "kit",
    displayName: "킷",
    purpose: "목적",
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...over,
  };
}

/** 개요 탭을 그린 마크업. 프로필 목록은 읽지 않은 상태다 */
function htmlOf(value: PluginCard | null, readiness: ToolReadinessVM | null = null): string {
  const row = entry("kit");
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <DetailOverview
        entry={row}
        card={value}
        readiness={readiness}
        profiles={{ set: null, reload: () => undefined }}
        onRecheck={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

/** 엔진 카드의 도구 칸(`externalTool`) */
function tool(binary: string, over: Partial<CardExternalTool> = {}): CardExternalTool {
  return {
    binary,
    versionArgs: "--version",
    install: { ko: `brew install ${binary}`, en: `brew install ${binary}` },
    bundled: false,
    ...over,
  };
}

const SOPS = card({
  name: "tool-sops",
  externalTool: tool("sops", {
    minVersion: "3.9.0",
    status: { kind: "too_old", found: "3.8.1", required: "3.9.0" },
  }),
});
const RG = card({
  name: "tool-rg",
  externalTool: tool("rg", { status: { kind: "bundled", version: "14.1.1" } }),
});
const GIT = card({ name: "tool-git", externalTool: tool("git", { status: { kind: "missing" } }) });
const WORKSPACE = card({
  name: "cap-workspace",
  dependencies: {
    dependsOn: [
      { from: "cap-workspace", target: "tool-rg", kind: "hard", range: null, problem: null },
      { from: "cap-workspace", target: "tool-git", kind: "soft", range: null, problem: null },
    ],
    dependents: [],
  },
});
const CARDS = new Map([SOPS, RG, GIT, WORKSPACE].map((c) => [c.name, c] as const));
const cardOf = (name: string): PluginCard | null => CARDS.get(name) ?? null;
const readinessOf = (value: PluginCard): ToolReadinessVM | null =>
  toolReadinessOf(value, cardOf, "ko");

/** 줄마다 [상태, 경고 표시, 경고 면, 경고 그림, "선택"] */
function marksOf(html: string): readonly (string | boolean)[][] {
  return html
    .split("<li ")
    .slice(1)
    .map((row) => [
      /data-need="([a-zA-Z]+)"/.exec(row)?.[1] ?? "",
      row.includes("data-warn"),
      row.includes("bg-warning-tint"),
      row.includes('data-icon="TriangleAlert"'),
      row.includes(t("desktop.workbench.detail.ready.optional")),
    ]);
}

describe("개요 탭 그림", () => {
  test("도구 플러그인은 자기 도구 한 줄: 버전이 낮으면 필요한 버전과 지금 버전, 설치 안내와 복사, 다시 확인을 보인다", () => {
    const html = htmlOf(SOPS, readinessOf(SOPS));
    expect(html).toContain(t("desktop.workbench.detail.ready.title"));
    expect(html).toContain(t("desktop.workbench.detail.ready.recheck"));
    expect(html).toContain("sops");
    expect(html).toContain(t("desktop.workbench.detail.ready.tooOld"));
    expect(html).toContain(t("desktop.workbench.detail.ready.minVersion", { min: "3.9.0" }));
    expect(html).toContain(t("desktop.workbench.detail.ready.foundVersion", { found: "3.8.1" }));
    expect(html).toContain("brew install sops");
    expect(html).toContain(t("desktop.workbench.detail.ready.copy"));
    expect(marksOf(html)).toEqual([["tooOld", true, true, true, false]]);
  });

  test("도구에 기대는 플러그인은 기대는 도구마다 한 줄: 약한 의존은 선택이고, 없는 도구는 숨기지 않는 경고다", () => {
    const html = htmlOf(WORKSPACE, readinessOf(WORKSPACE));
    expect(marksOf(html)).toEqual([
      ["bundled", false, false, false, false],
      ["missing", true, true, true, true],
    ]);
    expect(html).toContain(t("desktop.workbench.detail.ready.bundled"));
    expect(html).toContain(t("desktop.workbench.detail.ready.missing"));
    expect(html).toContain("brew install git");
    // 앱에 들어 있는 도구에는 설치 안내가 없다
    expect(html).not.toContain("brew install rg");
  });

  test("점검 값이 아직 없으면 경고 없이 확인 전 글이다", () => {
    const fresh = card({ name: "tool-age", externalTool: tool("age") });
    const html = htmlOf(fresh, readinessOf(fresh));
    expect(marksOf(html)).toEqual([["unchecked", false, false, false, false]]);
    expect(html).toContain(t("desktop.workbench.detail.ready.unchecked"));
    expect(html).not.toContain("brew install age");
  });

  test("준비 상태가 없으면 구역을 그리지 않는다", () => {
    const html = htmlOf(card(), null);
    expect(html).not.toContain(t("desktop.workbench.detail.ready.title"));
    expect(html).not.toContain("brew install");
  });

  test("목적이 없으면 목적 자리에 흐린 한 줄을 보인다", () => {
    expect(htmlOf(card({ purpose: null }))).toContain(
      t("desktop.workbench.detail.overview.noPurpose"),
    );
    expect(htmlOf(card())).not.toContain(t("desktop.workbench.detail.overview.noPurpose"));
  });

  test("카드를 못 읽었으면 하는 일 칸에 한 줄만 보이고 준비 상태도 없다", () => {
    const html = htmlOf(null, null);
    expect(html).toContain(t("desktop.workbench.detail.overview.noCard"));
    expect(html).not.toContain(t("desktop.workbench.detail.ready.title"));
  });
});

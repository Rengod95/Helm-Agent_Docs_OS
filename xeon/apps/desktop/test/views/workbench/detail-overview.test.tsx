// 플러그인 상세 "개요" 탭 그림(plugTab): 카드가 없을 때와 목적이 없을 때의 글, 준비 상태 값이 있을 때의 경고와 설치 안내,
// 값이 없거나 모양이 틀리면 준비 상태 구역을 그리지 않는 것을 본다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import type { PluginCard } from "@fresnel/contracts/extensions";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { DetailOverview } from "../../../src/views/workbench/detail-overview.tsx";
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
function htmlOf(value: PluginCard | null): string {
  const row = entry("kit");
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <DetailOverview
        entry={row}
        card={value}
        profiles={{ set: null, reload: () => undefined }}
        onRecheck={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

// 시험 카드: 준비 상태 필드를 가진 객체를 변수에 담아 넘긴다(객체 리터럴의 초과 속성 검사를 피한다)
const READINESS = {
  needs: [
    {
      tool: "python3",
      state: "tooOld",
      required: true,
      minVersion: "3.11",
      foundVersion: "3.9",
      why: "스크립트를 돌려요",
      install: "brew install python@3.12",
    },
    {
      tool: "rg",
      state: "ready",
      required: false,
      minVersion: null,
      foundVersion: "14.1",
      why: null,
      install: null,
    },
  ],
  checkedAt: null,
};
const withReadiness = { ...card(), toolReadiness: READINESS };
const withBadReadiness = { ...card(), toolReadiness: { needs: "잘못된 모양" } };

describe("개요 탭 그림", () => {
  test("준비 상태 값이 있으면 구역 머리, 버전이 낮은 도구의 경고와 설치 안내, 복사, 다시 확인을 보인다", () => {
    const html = htmlOf(withReadiness);
    expect(html).toContain(t("desktop.workbench.detail.ready.title"));
    expect(html).toContain(t("desktop.workbench.detail.ready.recheck"));
    expect(html).toContain("python3");
    expect(html).toContain(t("desktop.workbench.detail.ready.tooOld"));
    expect(html).toContain(t("desktop.workbench.detail.ready.minVersion", { min: "3.11" }));
    expect(html).toContain(t("desktop.workbench.detail.ready.foundVersion", { found: "3.9" }));
    expect(html).toContain("brew install python@3.12");
    expect(html).toContain(t("desktop.workbench.detail.ready.copy"));
  });

  test("경고 줄은 숨기지 않고 경고 면과 경고 그림으로 그리며, 있는 도구는 경고 없이 준비됨이다", () => {
    const html = htmlOf(withReadiness);
    const rows = html.split("<li ").slice(1);
    const marks = rows.map((row) => [
      /data-need="([a-zA-Z]+)"/.exec(row)?.[1] ?? "",
      row.includes("data-warn"),
      row.includes("bg-warning-tint"),
      row.includes('data-icon="TriangleAlert"'),
    ]);
    expect(marks).toEqual([
      ["tooOld", true, true, true],
      ["ready", false, false, false],
    ]);
    expect(html).toContain(t("desktop.workbench.detail.ready.ready"));
  });

  test("카드에 준비 상태 필드가 없으면 준비 상태 구역을 그리지 않는다", () => {
    const html = htmlOf(card());
    expect(html).not.toContain(t("desktop.workbench.detail.ready.title"));
    expect(html).not.toContain("brew install");
  });

  test("준비 상태 모양이 맞지 않으면 구역을 그리지 않는다", () => {
    expect(htmlOf(withBadReadiness)).not.toContain(t("desktop.workbench.detail.ready.title"));
  });

  test("목적이 없으면 목적 자리에 흐린 한 줄을 보인다", () => {
    expect(htmlOf(card({ purpose: null }))).toContain(
      t("desktop.workbench.detail.overview.noPurpose"),
    );
    expect(htmlOf(card())).not.toContain(t("desktop.workbench.detail.overview.noPurpose"));
  });

  test("카드를 못 읽었으면 하는 일 칸에 한 줄만 보이고 준비 상태도 없다", () => {
    const html = htmlOf(null);
    expect(html).toContain(t("desktop.workbench.detail.overview.noCard"));
    expect(html).not.toContain(t("desktop.workbench.detail.ready.title"));
  });
});

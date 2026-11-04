import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  detailsLoaded,
  healthLoaded,
  listFailed,
  listLoaded,
  ordersLoaded,
  pickGroup,
  pickPlugin,
  setView,
  type WorkbenchView,
} from "@fresnel/client/workbench";
import type { ExtHealthEntry } from "@fresnel/contracts/wire";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { createDesktopRegistry } from "../../../src/views/desktop-registry.tsx";
import { CraftScreen } from "../../../src/views/workbench/craft-screen.tsx";
import { renderWithWindowStub } from "../craft/render-support.tsx";
import { askingEntry, entry, inContexts, liveEngine, screenStore } from "./support.tsx";

/**
 * 개요 화면을 그린다. 캔버스가 첫 그리기 때 창 값을 읽으므로 창 흉내를 씌운다.
 * `live`가 아니면 엔진이 끊긴 것이라 목록 띠 대신 오프라인 글이 앞선다.
 */
function overview(store: WorkbenchStore, live = false): string {
  return renderWithWindowStub(inContexts(<CraftScreen />, store, live ? liveEngine() : undefined));
}

/** 지도 점 버튼마다 이름표(aria-label) 글 */
function dotLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*data-dot="[^"]*"[^>]*>/g)].map(
    (m) => m[0].match(/aria-label="([^"]*)"/)?.[1] ?? "",
  );
}

const VIEWS: readonly WorkbenchView[] = ["orbit", "strata", "link"];

/**
 * 보기 토글(지도·순서·링크)에서 켜진 칸의 값. 같은 모양의 거르기 토글(종류)은 뺀다.
 */
function checkedViews(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*role="radio"[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('aria-checked="true"'))
    .map((tag) => tag.match(/ value="([^"]+)"/)?.[1] ?? "")
    .filter((value) => VIEWS.some((view) => view === value));
}

/** 훅 줄 하나의 마크업(다음 훅 줄 전까지) */
function hookRow(html: string, hook: string): string {
  const start = html.indexOf(`data-hook="${hook}"`);
  if (start === -1) return "";
  const next = html.indexOf("data-hook=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

const failing = (registrationId: string): ExtHealthEntry => ({
  name: registrationId,
  registrationId,
  consecutiveFailures: 2,
  windowFailures: 2,
  windowMs: 60_000,
  autoDisabled: false,
  lastFailureAt: "2026-11-04T10:00:00Z",
  lastError: "timeout while calling the search API",
});

describe("크래프트 개요: 캔버스가 화면을 쓰고 목록 띠가 위에 온다", () => {
  test("목록이 읽히면 지도 점은 플러그인 수만큼이고 이름표는 표시 이름을 쓴다", () => {
    const labels = dotLabels(overview(screenStore()));
    // core-loop, 웹 검색, review(루트)와 review/lint: 플러그인 넷
    expect(labels).toHaveLength(4);
    expect(labels).toContain("core-loop, 켜짐");
    expect(labels).toContain("웹 검색, 켜짐");
  });

  test("자동 꺼진 확장은 위 띠에 알림을 두지 않고, 고른 플러그인 카드에 알림과 다시 켜기를 보인다", () => {
    const autoOff = t("desktop.workbench.autoDisabled", { name: "review" });
    expect(overview(screenStore())).not.toContain(autoOff);
    const html = overview(screenStore((s) => pickGroup(s, "review")));
    expect(html).toContain(autoOff);
    expect(html).toContain(t("desktop.workbench.reenable"));
  });

  test("계속 꺼 둘까요 질문은 고른 카드에 질문과 두 답을 보인다", () => {
    const store = createWorkbenchStore((initial) =>
      pickGroup(listLoaded(initial, [entry("web"), askingEntry()]), "review"),
    );
    const html = overview(store, true);
    expect(html).toContain(t("desktop.workbench.keepOff.question"));
    expect(html).toContain(t("desktop.workbench.keepOff.keepOn"));
    expect(html).toContain(t("desktop.workbench.keepOff.keepOff"));
    expect(html).not.toContain(t("desktop.workbench.reenable"));
  });

  test("토글에는 스토어의 view 하나만 켜져 있고, 캔버스도 같은 보기다", () => {
    for (const view of VIEWS) {
      const html = overview(screenStore((s) => setView(s, view)));
      expect(checkedViews(html)).toEqual([view]);
      expect(html).toContain(`data-craft-mode="${view}"`);
    }
  });

  test("고른 플러그인은 선택 패널에 이름과 장부의 실패 글을 보인다", () => {
    const html = overview(screenStore((s) => healthLoaded(pickPlugin(s, "web"), [failing("web")])));
    expect(html).toContain(t("desktop.craft.orbit.panel.failedPlain", { fails: 2 }));
    expect(html).toContain("timeout while calling the search API");
    expect(dotLabels(html)).toContain("웹 검색, 실패");
  });

  test("순서 보기는 훅 줄에 적용 중인 플러그인 이름을 보인다", () => {
    const html = overview(
      screenStore((s) =>
        ordersLoaded(
          detailsLoaded(setView(s, "strata"), "web", {
            entry: entry("web", { displayName: "웹 검색" }),
            manifest: {},
            hooks: [
              {
                registrationId: "web",
                hook: "tool.call.before",
                budgetClass: "fast",
                budgetMs: 100,
              },
            ],
            bindings: [],
          }),
          { "tool.call.before": ["web"] },
        ),
      ),
    );
    expect(html).toContain('data-craft-mode="strata"');
    expect(hookRow(html, "tool.call.before")).toContain("웹 검색");
  });

  test("연결 보기로 바꿔도 고른 플러그인은 선택 패널에 남는다", () => {
    const html = overview(screenStore((s) => pickPlugin(setView(s, "link"), "web")));
    expect(html).toContain('data-craft-mode="link"');
    expect(checkedViews(html)).toEqual(["link"]);
    // 지도 점은 연결 보기에 없으므로 이름은 고른 플러그인의 패널이나 초점에서 온다
    expect(html).toContain("웹 검색");
  });

  test("목록을 읽는 중이면 읽는 띠만 보이고 캔버스는 그리지 않는다", () => {
    const html = overview(createWorkbenchStore(), true);
    expect(html).toContain(`aria-label="${t("desktop.workbench.loading")}"`);
    expect(html).not.toContain("data-craft-mode");
  });

  test("목록을 못 읽으면 오류 띠와 다시 읽기 단추만 보이고 캔버스는 그리지 않는다", () => {
    const html = overview(
      createWorkbenchStore((s) => listFailed(s)),
      true,
    );
    expect(html).toContain(t("desktop.workbench.error.heading"));
    expect(html).toContain(t("desktop.workbench.error.retry"));
    expect(html).not.toContain("data-craft-mode");
    expect(dotLabels(html)).toEqual([]);
  });

  test("엔진에 닿지 않고 목록도 없으면 오프라인 띠만 보인다", () => {
    const html = overview(createWorkbenchStore());
    expect(html).toContain(t("desktop.workbench.offline"));
    expect(html).not.toContain("data-craft-mode");
  });
});

describe("크래프트 화면 등록", () => {
  test("개요는 크래프트 영역에 nav id로 등록되고, 등록은 한 번씩이라 던지지 않는다", () => {
    expect(() => createDesktopRegistry()).not.toThrow();
    const registry = createDesktopRegistry();
    const overviewDef = registry.screen("overview");
    expect(overviewDef?.area).toBe("workbench");
    expect(overviewDef?.label).toBe("desktop.shell.nav.overview");
    expect(registry.screen("extensions")?.area).toBe("workbench");
    expect(registry.screen("engine")?.area).toBe("workbench");
  });
});

// 버전 탭 그림(§6.24.1): 전체, 대체(기본·사용자 확장), 오류. 그림은 `VersionsPanel`이 `view`대로 그린다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { versionsViewOf, type VersionsView } from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { VersionsPanel } from "../../../src/views/workbench/versions-tab.tsx";

const render = (view: VersionsView, locked = false): string =>
  renderToString(<VersionsPanel view={view} locked={locked} onRollback={() => undefined} />);

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 정의 목록의 값(dd) 글, 그린 순서대로 */
const valuesOf = (html: string): string[] =>
  [...html.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => textOf(m[1] ?? ""));

const history = {
  versions: [
    {
      version: "0.3.0",
      installedAt: "t3",
      source: "user" as const,
      manifestHash: "c",
      stateSchemaVersion: 2,
      current: true,
    },
    {
      version: "0.2.0",
      installedAt: "t2",
      source: "user" as const,
      manifestHash: "b",
      stateSchemaVersion: 1,
      current: false,
    },
  ],
};

describe("버전 탭 그림", () => {
  test("전체: 행마다 버전과 시각을 보이고 되돌리기 단추는 지금 판이 아닌 행에만 있다", () => {
    const view = versionsViewOf(
      { version: "0.3.0", origin: "user" },
      { kind: "ready", result: history },
    );
    const html = render(view);
    expect(textOf(html)).toContain("0.3.0");
    expect(textOf(html)).toContain("0.2.0");
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(textOf(html)).toContain(t("desktop.workbench.versions.rollback"));
    expect(textOf(html)).not.toContain(t("desktop.workbench.versions.noHistory"));
  });

  test("대체(기본 플러그인): 설치본과 앱에 든 번들 버전을 읽기 전용으로 보이고 단추는 없다", () => {
    const html = render({ kind: "fallback", installed: "0.4.1", bundled: "0.4.1" });
    expect(valuesOf(html)).toEqual(["0.4.1", "0.4.1"]);
    expect(html).not.toContain("<button");
    expect(textOf(html)).toContain(t("desktop.workbench.versions.installed"));
    expect(textOf(html)).toContain(t("desktop.workbench.versions.bundled"));
    expect(textOf(html)).toContain(t("desktop.workbench.versions.noHistory"));
    expect(textOf(html)).toContain(t("desktop.workbench.versions.bundledNoRollback"));
    expect(textOf(html)).not.toContain(t("desktop.workbench.versions.userNoRollback"));
  });

  test("대체(사용자 확장): 설치본만 보이고 되돌리기 없음을 말한다. 폴더 열기 단추는 없다", () => {
    const html = render({ kind: "fallback", installed: "0.0.9", bundled: null });
    expect(valuesOf(html)).toEqual(["0.0.9"]);
    expect(html).not.toContain("<button");
    expect(textOf(html)).not.toContain(t("desktop.workbench.versions.bundled"));
    expect(textOf(html)).toContain(t("desktop.workbench.versions.userNoRollback"));
    expect(textOf(html)).not.toContain(t("desktop.workbench.versions.bundledNoRollback"));
  });

  test("오류: 한 줄 오류만 보이고 값과 단추는 없다", () => {
    const html = render({ kind: "error" });
    expect(textOf(html)).toBe(t("desktop.workbench.detail.load.failed"));
    expect(valuesOf(html)).toEqual([]);
    expect(html).not.toContain("<button");
  });
});

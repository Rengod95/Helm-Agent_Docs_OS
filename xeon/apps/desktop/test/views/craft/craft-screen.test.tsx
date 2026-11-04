import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { openDetail, setView } from "@fresnel/client/workbench";
import { FIXTURE_ORDER, buildFixture, type HookOrderPort } from "@fresnel/client/workbench/canvas";
import { createWorkbenchStore, type WorkbenchStore } from "../../../src/state/workbench/index.ts";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { CraftBody } from "../../../src/views/craft/craft-screen.tsx";
import { inStore, renderWithWindowStub } from "./render-support.tsx";

const unused = (): Promise<never> =>
  Promise.reject(new Error("the body test never calls the port"));

const port: HookOrderPort = {
  get: unused,
  set: unused,
  reset: unused,
  preview: unused,
};

function fakeSource(): CraftSource {
  return {
    snapshot: buildFixture(18),
    order: FIXTURE_ORDER,
    setOn: () => Promise.resolve(),
    orderPort: port,
    openBuilder: () => undefined,
    recentRuns: () => Promise.resolve(null),
    scope: { kind: "global" },
  };
}

/** 스토어 시작 상태를 넣고 캔버스 본문을 그린다 */
function renderBody(store: WorkbenchStore): string {
  return renderWithWindowStub(
    inStore(
      <CraftProvider source={fakeSource()}>
        <CraftBody />
      </CraftProvider>,
      store,
    ),
  );
}

describe("캔버스 본문: 보기는 스토어의 view를 따른다", () => {
  test("지도가 기본이고, 세 보기 모두 data-craft-mode에 그 이름이 실린다", () => {
    expect(renderBody(createWorkbenchStore())).toContain('data-craft-mode="orbit"');
    for (const view of ["strata", "link"] as const) {
      const html = renderBody(createWorkbenchStore((s) => setView(s, view)));
      expect(html).toContain(`data-craft-mode="${view}"`);
    }
  });

  test("자세히 보기가 열리면 캔버스 대신 자세히 보기를 그리고, 없는 대상은 찾지 못했다고 쓴다", () => {
    const html = renderBody(createWorkbenchStore((s) => openDetail(s, "ghost")));
    expect(html).not.toContain("data-craft-mode");
    expect(html).toContain(t("desktop.craft.detail.missing.title"));
  });
});

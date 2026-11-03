import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Bug } from "@fresnel/contracts";
import {
  listLoaded,
  openDetail,
  pickSel,
  select,
  setQuery,
  toggleContrib,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import { createWorkbenchStore, WorkbenchStoreContext } from "../../../src/state/workbench/index.ts";
import { CommandsContext } from "../../../src/views/commands.ts";
import { createCanvasSlots } from "../../../src/views/workbench/canvas-slots.ts";
import { CraftScreen } from "../../../src/views/workbench/craft-screen.tsx";
import { EngineScreen } from "../../../src/views/workbench/engine-screen.tsx";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { needsTrustConfirm } from "../../../src/views/workbench/trust-dialog.tsx";
import { harness } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: `${name}#root`, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 2,
    ...over,
  };
}

const ENTRIES = [
  entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
  entry("web", { displayName: "웹 검색" }),
  entry("review", { layer: "L3", isGroup: true, status: "disabled", autoDisabled: true }),
];

function render(
  ui: React.ReactNode,
  prepare: (state: WorkbenchState) => WorkbenchState = (state) => state,
): string {
  const store = createWorkbenchStore((initial) => prepare(listLoaded(initial, ENTRIES)));
  const engine = harness().store;
  return renderToString(
    <EngineStoreContext value={engine.read}>
      <CommandsContext value={fakeCommands()}>
        <WorkbenchStoreContext value={store}>{ui}</WorkbenchStoreContext>
      </CommandsContext>
    </EngineStoreContext>,
  );
}

/** 누름 상태가 켜진 단추의 글(태그는 뺀다) */
function pressedLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)]
    .filter((m) => m[0].includes('aria-pressed="true"'))
    .map((m) => (m[1] ?? "").replace(/<[^>]*>/g, ""));
}

/** 층 목록이 그린 층 이름, 그린 순서대로 */
function sectionLayers(html: string): string[] {
  return [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("크래프트 개요", () => {
  test("머리에 제목과 개수, 보기 셋이 보인다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />);
    expect(html).toContain("크래프트");
    expect(html).toContain("확장 3 · 켜짐 2 · 자동 꺼짐 1");
    for (const view of ["지도", "순서", "링크"]) expect(html).toContain(view);
  });

  test("슬롯이 비어 있으면 층 목록이 보이고 층 순서는 L1, L2, L3다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />);
    expect(html.indexOf("L1")).toBeLessThan(html.indexOf("L2"));
    expect(html.indexOf("L2")).toBeLessThan(html.indexOf("L3"));
    expect(html).toContain("웹 검색");
    expect(html).toContain("1/1 켜짐");
  });

  test("층 목록은 L1, L2, L3 순서로 모두 보이고 층을 고르면 그 층만 보인다", () => {
    expect(sectionLayers(render(<CraftScreen slots={createCanvasSlots()} />))).toEqual([
      "L1",
      "L2",
      "L3",
    ]);
    const layer = render(<CraftScreen slots={createCanvasSlots()} />, (s) =>
      pickSel(s, { k: "layer", id: "L2" }),
    );
    expect(sectionLayers(layer)).toEqual(["L2"]);
  });

  test("구성 요소 거르기는 고른 칸만 눌린 상태로 보이고 글은 옛 문구 키를 쓴다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />, (s) =>
      toggleContrib(toggleContrib(s, "agent"), "hook"),
    );
    // 칸 순서(훅, 스킬, 명령, 도구, MCP, 에이전트, 뷰)대로
    expect(pressedLabels(html)).toEqual(["훅", "보조 에이전트"]);
  });

  test("고른 확장의 행만 눌린 상태로 보인다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />, (s) => select(s, "web"));
    const pressed = pressedLabels(html);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain("웹 검색");
  });

  test("등록된 보기가 있으면 그것이 캔버스로 그려진다", () => {
    const slots = createCanvasSlots();
    slots.register("orbit", () => <p>지도 캔버스</p>);
    const html = render(<CraftScreen slots={slots} />);
    expect(html).toContain("지도 캔버스");
    expect(html).not.toContain("1/1 켜짐");
  });

  test("같은 보기를 두 번 등록하면 Bug다", () => {
    const slots = createCanvasSlots();
    slots.register("link", () => <p>a</p>);
    expect(() => {
      slots.register("link", () => <p>b</p>);
    }).toThrow(Bug);
  });

  test("자동 꺼진 확장은 알림과 다시 켜기 단추를 보인다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />);
    expect(html).toContain("review이 연속 실패로 자동 꺼졌어요");
    expect(html).toContain("다시 켜기");
  });

  test("면제 tier 스위치는 잠기고 이유를 준다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />);
    expect(html).toContain("보안·기본 동작이라 끌 수 없어요");
  });

  test("고른 확장은 선택 패널에 켜짐 스위치와 자세히 보기를 보인다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />, (s) => select(s, "web"));
    expect(html).toContain('aria-label="선택한 확장"');
    expect(html).toContain("자세히 보기");
    expect(html).toContain("훅 2개");
  });

  test("자세히 보기는 캔버스 대신 탭을 그린다", () => {
    const html = render(<CraftScreen slots={createCanvasSlots()} />, (s) => openDetail(s, "web"));
    expect(html).toContain("개요로");
    for (const tab of ["개요", "훅", "버전"]) expect(html).toContain(tab);
    expect(html).not.toContain("1/1 켜짐");
  });

  test("엔진에 연결되지 않고 목록이 없으면 오프라인 띠를 보인다", () => {
    const store = createWorkbenchStore((s) => ({ ...s, list: "error" }));
    const engine = harness().store;
    const html = renderToString(
      <EngineStoreContext value={engine.read}>
        <CommandsContext value={fakeCommands()}>
          <WorkbenchStoreContext value={store}>
            <CraftScreen slots={createCanvasSlots()} />
          </WorkbenchStoreContext>
        </CommandsContext>
      </EngineStoreContext>,
    );
    expect(html).toContain("엔진에 연결되어 있지 않아요");
  });
});

describe("확장·엔진 화면", () => {
  test("확장 화면은 같은 행을 찾기로 거른다", () => {
    const html = render(<ExtensionsScreen />, (s) => setQuery(s, "웹"));
    expect(html).toContain("웹 검색");
    expect(html).not.toContain("core-loop");
  });

  test("찾는 확장이 없으면 빈 상태를 보인다", () => {
    const html = render(<ExtensionsScreen />, (s) => setQuery(s, "zzz"));
    expect(html).toContain("찾는 확장이 없어요");
  });

  test("엔진 화면은 연결 상태와 세 단추를 보인다", () => {
    const html = render(<EngineScreen />);
    expect(html).toContain("연결 상태");
    for (const text of ["다시 연결", "엔진 다시 시작", "진단 복사"]) expect(html).toContain(text);
  });
});

describe("신뢰 확인(O-10)", () => {
  test("user·project 위치만 켜기 전에 묻는다", () => {
    expect(needsTrustConfirm(entry("a", { origin: "user" }))).toBe(true);
    expect(needsTrustConfirm(entry("a", { origin: "project" }))).toBe(true);
    expect(needsTrustConfirm(entry("a", { origin: "builtin" }))).toBe(false);
    expect(needsTrustConfirm(entry("a", { origin: "managed" }))).toBe(false);
  });
});

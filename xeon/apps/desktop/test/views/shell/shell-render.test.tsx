import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import {
  createShellStore,
  ShellStoreContext,
  switchArea,
  updatePlace,
  type ShellModel,
} from "../../../src/state/shell/index.ts";
import { createShellRegistry } from "../../../src/views/shell/registry.ts";
import { PanelExpandButton } from "../../../src/views/shell/screen-header.tsx";
import { Shell } from "../../../src/views/shell/shell.tsx";
import { harness } from "../../state/helpers.ts";

const noop = (): void => {};

function render(
  width: number,
  start: (model: ShellModel) => ShellModel = (model) => model,
  chat: ReactNode = <p>채팅 화면 내용</p>,
): string {
  const store = createShellStore(width, start);
  const registry = createShellRegistry();
  registry.registerScreen({
    id: "chat",
    area: "chat",
    label: "desktop.shell.nav.chat",
    render: () => chat,
  });
  registry.registerEndTab({
    id: "inbox",
    area: "both",
    label: "desktop.shell.nav.inbox",
    icon: <span>i</span>,
    render: () => <p>받은 요청 내용</p>,
  });
  const engine = harness().store;
  return renderToString(
    <EngineStoreContext value={engine.read}>
      <ShellStoreContext value={store}>
        <Shell
          registry={registry}
          mac
          settingsOpen={false}
          onSettingsOpenChange={noop}
          settingsScreen={<p>설정 화면 내용</p>}
          threadList={<p>대화 목록 슬롯</p>}
          statusBar={<footer>상태 표시줄 슬롯</footer>}
          onGoToThread={noop}
        />
      </ShellStoreContext>
    </EngineStoreContext>,
  );
}

describe("Shell slots", () => {
  test("the chat area draws the registered screen, the six chat nav items and the slots", () => {
    const out = render(1400);
    expect(out).toContain("채팅 화면 내용");
    for (const label of ["대화", "받은 요청", "제안", "예약", "연결", "추가 기능"]) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain("개요");
    expect(out).toContain("대화 목록 슬롯");
    expect(out).toContain("상태 표시줄 슬롯");
  });

  test("the stage reserves the end rail width so the rail cannot cover head buttons", () => {
    const out = render(1400);
    expect(out).toMatch(/<main[^>]*class="[^"]*\bpe-10\b/);
  });

  test("a screen id nobody registered shows the not-yet empty state", () => {
    const out = render(1400, (model) => updatePlace(model, { screen: "proposals" }));
    expect(out).toContain("이 화면은 아직 없어요");
    expect(out).not.toContain("채팅 화면 내용");
  });

  test("the workbench area lists six workbench items, no plugin pages item, and no thread list", () => {
    const out = render(1400, (model) => switchArea(model, "workbench"));
    for (const label of ["개요", "확장", "테스트", "성능 측정", "구성", "엔진"]) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain("추가 기능");
    expect(out).not.toContain("대화 목록 슬롯");
  });

  test("compact starts with the start panel closed", () => {
    const out = render(600);
    expect(out).not.toContain("대화 목록 슬롯");
    expect(out).toContain("채팅 화면 내용");
  });

  test("the shell draws no start-panel open button itself; a screen puts PanelExpandButton in its head", () => {
    const label = `aria-label="${t("desktop.shell.start.expand")}"`;
    expect(render(600, (model) => updatePlace(model, { screen: "proposals" }))).not.toContain(
      label,
    );
    expect(render(600)).not.toContain(label);
    expect(render(600, undefined, <PanelExpandButton />)).toContain(label);
    expect(render(1400, undefined, <PanelExpandButton />)).not.toContain(label);
  });
});

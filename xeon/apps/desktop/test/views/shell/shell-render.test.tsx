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
  test("the chat area draws the registered screen, the new-chat row, the three chat nav items and the slots", () => {
    const out = render(1400);
    expect(out).toContain("채팅 화면 내용");
    for (const label of [
      t("desktop.shell.start.newThread"),
      "⌘N",
      "제안",
      "예약",
      "플레이그라운드",
    ]) {
      expect(out).toContain(label);
    }
    expect(out).not.toContain(">연결<");
    expect(out).not.toContain("개요");
    expect(out).toContain("대화 목록 슬롯");
    expect(out).toContain("상태 표시줄 슬롯");
  });

  test("the stage fills to the right edge; only the head and the body after it keep the rail inset", () => {
    const out = render(1400);
    const main = /<main[^>]*>/.exec(out)?.[0] ?? "";
    expect(main).not.toMatch(/\bpe-10\b/);
    expect(main).toContain("data-rail");
    expect(main).toContain("[--shell-rail:3rem]");
  });

  test("the floating bar stands in the vertical middle under the head, not in the head's top right corner (DP-135)", () => {
    const out = render(1400);
    const aside = /<aside[^>]*data-end-rail[^>]*>/.exec(out)?.[0] ?? "";
    const cls = /class="([^"]*)"/.exec(aside)?.[1]?.split(" ") ?? [];
    expect(cls.filter((c) => /^(top-|bottom-|items-|end-)/.test(c))).toEqual([
      "end-3",
      "top-(--shell-header-h)",
      "bottom-0",
      "items-center",
    ]);
  });

  test("a closed start panel stays as a 48px icon rail: new chat, nav icons and settings, no thread list", () => {
    const out = render(1400, (model) => ({ ...model, startOpen: false }));
    const items = [...out.matchAll(/<button[^>]*data-rail-item[^>]*aria-label="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(items).toEqual([
      t("desktop.shell.start.newThread"),
      "제안",
      "예약",
      "플레이그라운드",
      t("desktop.shell.settings"),
    ]);
    expect(out).toContain("w-[calc(3rem+1px)]");
    expect(out).not.toContain("대화 목록 슬롯");
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
    expect(out).not.toContain("플레이그라운드");
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

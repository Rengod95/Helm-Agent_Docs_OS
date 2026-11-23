import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createShellRegistry } from "../../../src/views/shell/registry.ts";
import { Shell } from "../../../src/views/shell/shell.tsx";
import { harness } from "../../state/helpers.ts";

// 내비의 "제안" 줄은 제안 플러그인이 켜져 있을 때만 그리고, 켜면 원래 자리(예약 앞, 등록 순서의 내비 순서)에 돌아온다.

const noop = (): void => {};

function render(proposalsAvailable: boolean): string {
  const store = createShellStore(1400);
  const registry = createShellRegistry();
  registry.registerScreen({
    id: "chat",
    area: "chat",
    label: "desktop.shell.nav.chat",
    render: () => <p>채팅 화면 내용</p>,
  });
  registry.registerScreen({
    id: "proposals",
    area: "chat",
    label: "desktop.shell.nav.proposals",
    useAvailable: () => proposalsAvailable,
    render: () => <p>제안 화면 내용</p>,
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

describe("nav proposals row follows the suggest plugin", () => {
  const proposals = t("desktop.shell.nav.proposals");
  const schedules = t("desktop.shell.nav.schedules");

  test("with suggest on the proposals row is drawn before the schedules row, as before", () => {
    const out = render(true);
    const at = out.indexOf(proposals);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(out.indexOf(schedules));
  });

  test("with suggest off (or not read yet) the proposals row is not drawn, and the other rows stay", () => {
    const out = render(false);
    expect(out).not.toContain(proposals);
    expect(out).toContain(schedules);
    expect(out).toContain(t("desktop.shell.nav.plugins"));
  });

  test("the nav keeps its order after the row comes back", () => {
    const labelsOf = (out: string): readonly string[] =>
      [proposals, schedules, t("desktop.shell.nav.plugins")]
        .filter((label) => out.includes(label))
        .toSorted((a, b) => out.indexOf(a) - out.indexOf(b));
    expect(labelsOf(render(true))).toEqual([proposals, schedules, t("desktop.shell.nav.plugins")]);
    expect(labelsOf(render(false))).toEqual([schedules, t("desktop.shell.nav.plugins")]);
  });
});

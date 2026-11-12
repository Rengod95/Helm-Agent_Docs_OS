import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteScreen } from "../../src/app/remote/use-remote-controller.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { CommandsContext } from "../../src/views/commands.ts";
import type { ConnectionState } from "../../src/views/pages/connection/connection-model.ts";
import {
  ConnectionScreenView,
  type ConnectionScreenViewProps,
} from "../../src/views/pages/connection/connection-view.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { DEV_BOX, localState, remoteOf } from "./hero-fixtures.ts";
import { HANDLERS, RUNNING } from "./reach-fixtures.ts";

// 설정 "원격" 화면 전체(`ConnectionScreenView`)의 서버 렌더. 구역 다섯의 순서와, 이 컴퓨터·다른 컴퓨터·웹·원격 컨트롤러 없음에서
// 무엇이 보이고 숨는지, 서비스 멈추기와 대상 바꾸기 확인 대화 상자의 글을 값으로 본다. 구역 안의 상태별 모양은 구역마다의 시험이 본다.

const SLOT = {
  hero: 'data-slot="connection-hero"',
  computers: 'data-slot="computers-section"',
  keepOnRemote: 'data-slot="keep-on-remote-target"',
  keepOnWeb: 'data-slot="keep-on-web"',
  computersWeb: 'data-slot="computers-web"',
  embedded: 'data-slot="connection-embedded"',
} as const;

/** 서버 렌더의 글 이스케이프(`'`, `&`, `<`, `>`, `"`)를 그대로 따른다 */
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/** 구역 제목 h2 (요약 카드는 제목 없이 aria-label이다) */
function heading(id: Parameters<typeof t>[0]): string {
  return `>${escaped(t(id))}</h2>`;
}

function count(markup: string, part: string): number {
  return markup.split(part).length - 1;
}

/** 다른 기기 접속이 켜져 도는 원격 컨트롤러 */
function remoteOn(): RemoteScreen {
  return remoteOf([], { status: { kind: "ready", value: RUNNING } });
}

function html(
  state: ConnectionState,
  patch: Partial<Omit<ConnectionScreenViewProps, "state">> = {},
): string {
  return renderToStaticMarkup(
    <CommandsContext value={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1400)}>
        <ConnectionScreenView
          state={state}
          engine={{ kind: "running", source: "service", pid: 4211 }}
          locale="ko"
          handlers={HANDLERS}
          inline
          {...patch}
        />
      </ShellStoreContext>
    </CommandsContext>,
  );
}

/** 다른 컴퓨터(dev-box)에 붙어 상태를 읽은 화면 상태 */
function onRemote(): ConnectionState {
  return localState({
    list: { kind: "ready" },
    items: [DEV_BOX],
    engineTarget: { kind: "remote", entry: DEV_BOX },
  });
}

describe("the remote settings screen draws its five sections in order", () => {
  test("hero, keep-on, other computers, phone and browser, connected devices, then the diagnostics copy", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: remoteOn() });
    const at = [
      markup.indexOf(SLOT.hero),
      markup.indexOf(heading("desktop.connection.keepOn.title")),
      markup.indexOf(SLOT.computers),
      markup.indexOf(heading("desktop.connection.reach.title")),
      markup.indexOf(heading("desktop.connection.devices.title")),
      markup.indexOf(`>${escaped(t("desktop.connection.status.copyDiagnostics"))}</button>`),
    ];
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at.toSorted((a, b) => a - b)).toEqual(at);
    expect(count(markup, SLOT.hero)).toBe(1);
    expect(count(markup, SLOT.computers)).toBe(1);
  });

  test("the full screen has its own title, and the embedded one draws only the body", () => {
    const state = localState({ list: { kind: "ready" } });
    const full = html(state, { remote: remoteOn() });
    expect(full).toContain(`>${escaped(t("desktop.connection.title"))}</h1>`);
    expect(full).not.toContain(SLOT.embedded);
    const embedded = html(state, { remote: remoteOn(), embedded: true });
    expect(embedded).toContain(SLOT.embedded);
    expect(embedded).not.toContain(`>${escaped(t("desktop.connection.title"))}</h1>`);
    expect(embedded.indexOf(SLOT.hero)).toBeGreaterThan(embedded.indexOf(SLOT.embedded));
  });
});

describe("what each target shows and hides", () => {
  test("on this computer with access off, the devices section is hidden and the add button is there", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: remoteOf([]) });
    expect(markup).toContain(heading("desktop.connection.keepOn.title"));
    expect(markup).toContain(heading("desktop.connection.reach.title"));
    expect(markup).not.toContain(heading("desktop.connection.devices.title"));
    expect(markup).toContain(`${escaped(t("desktop.connection.computers.add"))}</button>`);
    expect(markup).not.toContain(SLOT.keepOnRemote);
    expect(markup).not.toContain(SLOT.keepOnWeb);
    expect(markup).not.toContain(SLOT.computersWeb);
    expect(markup).not.toContain(escaped(t("desktop.connection.reach.elsewhere")));
  });

  test("on this computer with access on, the devices section appears", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: remoteOn() });
    expect(count(markup, heading("desktop.connection.devices.title"))).toBe(1);
  });

  test("on another computer there is no remote controller: keep-on and reach say to come back, devices are hidden", () => {
    const markup = html(onRemote(), { remote: null });
    expect(markup).toContain(SLOT.keepOnRemote);
    // 계속 켜 두기와 휴대폰·브라우저 구역이 같은 글로 "이 컴퓨터로 돌아오면"을 말한다
    expect(count(markup, escaped(t("desktop.connection.reach.elsewhere")))).toBe(2);
    expect(markup).toContain(heading("desktop.connection.reach.title"));
    expect(markup).not.toContain(heading("desktop.connection.devices.title"));
    expect(markup).toContain(`>${escaped(t("desktop.connection.hero.backToLocal"))}</button>`);
    expect(markup).toContain(`${escaped(t("desktop.connection.computers.add"))}</button>`);
  });

  test("on this computer without a controller yet, reach says to come back and devices are hidden", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: null });
    expect(markup).toContain(heading("desktop.connection.keepOn.title"));
    expect(markup).not.toContain(SLOT.keepOnRemote);
    expect(count(markup, escaped(t("desktop.connection.reach.elsewhere")))).toBe(1);
    expect(markup).not.toContain(heading("desktop.connection.devices.title"));
    expect(markup).not.toContain(`>${escaped(t("desktop.connection.hero.backToLocal"))}</button>`);
  });

  test("in the browser, keep-on and adding computers point at the desktop app, and devices stay visible", () => {
    const markup = html(localState({ list: { kind: "ready" } }), {
      remote: remoteOf([]),
      web: true,
    });
    expect(markup).toContain(SLOT.keepOnWeb);
    expect(markup).toContain(SLOT.computersWeb);
    expect(markup).toContain(escaped(t("desktop.connection.computers.webOnly")));
    expect(markup).not.toContain(`${escaped(t("desktop.connection.computers.add"))}</button>`);
    expect(count(markup, heading("desktop.connection.devices.title"))).toBe(1);
  });
});

describe("the stop confirmation", () => {
  test("it names the connections that will drop and shows the live turns", () => {
    const state = localState({ list: { kind: "ready" }, stopConfirm: true });
    const markup = html(state, { remote: remoteOn() });
    expect(markup).toContain(escaped(t("desktop.connection.stopDialog.title")));
    // `snapshotOf`는 연결 2개, 진행 중 턴 1개다
    expect(markup).toContain(escaped(t("desktop.connection.stopDialog.body", { count: 2 })));
    expect(markup).toMatch(
      new RegExp(
        `>${escaped(t("desktop.connection.status.liveTurns"))}</dt><dd[^>]*><span[^>]*>1</span></dd>`,
      ),
    );
    expect(markup).toContain(`>${escaped(t("desktop.connection.stopDialog.keep"))}</button>`);
    expect(markup).toContain(`>${escaped(t("desktop.connection.stopDialog.confirm"))}</button>`);
  });

  test("it is not drawn while closed", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: remoteOn() });
    expect(markup).not.toContain(escaped(t("desktop.connection.stopDialog.title")));
  });
});

describe("the switch confirmation", () => {
  test("it lists only the things that are going on: live turns and a service that keeps running", () => {
    const state = localState({
      list: { kind: "ready" },
      items: [DEV_BOX],
      switchAsk: {
        choice: { kind: "remote", entry: DEV_BOX },
        impact: { liveTurns: 2, waitingApprovals: 0, keepsRunning: true },
      },
    });
    const markup = html(state, { remote: remoteOn() });
    expect(markup).toContain(escaped(t("desktop.connection.switch.title")));
    expect(markup).toContain(escaped(t("desktop.connection.switch.body.turns", { count: 2 })));
    expect(markup).toContain(escaped(t("desktop.connection.switch.body.keepsRunning")));
    expect(markup).not.toContain(
      escaped(t("desktop.connection.switch.body.approvals", { count: 0 })),
    );
    expect(markup).toContain(`>${escaped(t("desktop.connection.switch.cancel"))}</button>`);
    expect(markup).toContain(`>${escaped(t("desktop.connection.switch.confirm"))}</button>`);
  });

  test("waiting approvals get their own line, and a service that stops says nothing more", () => {
    const state = localState({
      list: { kind: "ready" },
      switchAsk: {
        choice: { kind: "local" },
        impact: { liveTurns: 0, waitingApprovals: 3, keepsRunning: false },
      },
    });
    const markup = html(state, { remote: remoteOn() });
    expect(markup).toContain(escaped(t("desktop.connection.switch.body.approvals", { count: 3 })));
    expect(markup).not.toContain(escaped(t("desktop.connection.switch.body.turns", { count: 0 })));
    expect(markup).not.toContain(escaped(t("desktop.connection.switch.body.keepsRunning")));
  });

  test("it is not drawn while there is nothing to confirm", () => {
    const markup = html(localState({ list: { kind: "ready" } }), { remote: remoteOn() });
    expect(markup).not.toContain(escaped(t("desktop.connection.switch.title")));
  });
});

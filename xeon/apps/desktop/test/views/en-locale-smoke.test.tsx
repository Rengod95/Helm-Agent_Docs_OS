import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  ConnectionScreenView,
  type ConnectionScreenHandlers,
} from "../../src/views/pages/connection/connection-view.tsx";
import { setupRequiredText } from "../../src/views/setup-needed.ts";

// `l4.ui.locale=en` 데스크톱 스모크(T-I18N, Y15). 창을 띄우지 않고 서버 렌더로 본다: 로케일이 en이면 화면 문장이 영어 카탈로그에서 나오고
// 한글이 하나도 없어야 한다. 시험 프로세스는 ko로 시작하므로(scripts/test-preload.ts) 끝나면 되돌린다.

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const NOOP = (): void => {};
const handlers: ConnectionScreenHandlers = {
  query: NOOP,
  connect: NOOP,
  retry: NOOP,
  backToLocal: NOOP,
  openForm: NOOP,
  closeForm: NOOP,
  formChange: NOOP,
  submitForm: NOOP,
  removeAsk: NOOP,
  removeCancel: NOOP,
  removeConfirm: NOOP,
  renameOpen: NOOP,
  renameField: NOOP,
  renameSubmit: NOOP,
  renameCancel: NOOP,
  dismissNotice: NOOP,
  confirmStop: NOOP,
  restart: NOOP,
  copyDiagnostics: NOOP,
  setServiceMode: NOOP,
  startLocalService: NOOP,
  stopLocalService: NOOP,
  setRemoteRespond: NOOP,
  setStopConfirm: NOOP,
  openExtensions: NOOP,
  retryClients: NOOP,
};

function connectionHtml(locale: Locale): string {
  const loaded = connectionReducer(INITIAL_CONNECTION_STATE, {
    type: "targetsChanged",
    items: [],
    notice: null,
    added: false,
  });
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <ConnectionScreenView state={loaded} engine={null} locale={locale} handlers={handlers} />
    </ShellStoreContext>,
  );
}

describe("desktop render with ui.locale=en", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("en");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("the connection screen renders English sentences and no Hangul", () => {
    const markup = connectionHtml("en");
    expect(markup).toContain("This computer (in app)");
    expect(markup).toContain("Add host");
    expect(markup).toContain("No remote hosts added yet.");
    expect(markup).not.toMatch(HANGUL);
  });

  test("the connected clients list renders English sentences and no Hangul", () => {
    const withClients = connectionReducer(
      connectionReducer(INITIAL_CONNECTION_STATE, {
        type: "statusLoaded",
        snapshot: {
          host: {
            mode: "service",
            pid: 4211,
            startedAt: "2026-11-04T01:00:00.000Z",
            connections: 2,
            liveTurns: 0,
            idleShutdownAt: null,
          },
          service: {
            kind: "running",
            pid: 4211,
            version: "1.2.0",
            startedAt: 1_700_000_000_000,
            attached: true,
          },
          serviceEnabled: true,
          restartPending: false,
          remoteAllowRespond: true,
        },
      }),
      {
        type: "clientsLoaded",
        clients: [
          {
            connectionId: "c-1",
            transport: "stdio",
            name: "fresnel-cli",
            version: "1.2.0",
            writeThreads: 2,
            observedThreads: 1,
            self: true,
          },
          {
            connectionId: "c-2",
            transport: "socket",
            writeThreads: 0,
            observedThreads: 3,
            self: false,
          },
        ],
      },
    );
    const markup = renderToString(
      <ShellStoreContext value={createShellStore(1400)}>
        <ConnectionScreenView state={withClients} engine={null} locale="en" handlers={handlers} />
      </ShellStoreContext>,
    );
    expect(markup).toContain("Connected clients");
    expect(markup).toContain("This app, Service connection");
    expect(markup).not.toMatch(HANGUL);
  });

  test("the same screen renders Korean when the locale is ko", () => {
    setActiveLocale("ko");
    const markup = connectionHtml("ko");
    expect(markup).toContain("이 컴퓨터(앱 안)");
    expect(markup).toContain("추가한 원격 호스트가 없어요.");
  });

  test("a .ts-built sentence follows the locale too", () => {
    expect(renderToString(<p>{setupRequiredText()}</p>)).not.toMatch(HANGUL);
  });
});

import { describe, expect, test } from "bun:test";
import type { TargetEntry } from "@fresnel/client";
import type { HostClientView } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  ConnectionScreenView,
  type ConnectionScreenHandlers,
} from "../../src/views/pages/connection/connection-view.tsx";

// 연결 화면의 서버 렌더. 상태는 reducer로 만들고 동작 핸들러는 아무것도 하지 않는 것으로 둔다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 connection-model.test.ts가 본다).

const NOOP = (): void => {};
const handlers: ConnectionScreenHandlers = {
  select: NOOP,
  query: NOOP,
  connect: NOOP,
  retry: NOOP,
  backToLocal: NOOP,
  remove: NOOP,
  openForm: NOOP,
  closeForm: NOOP,
  formField: NOOP,
  submitForm: NOOP,
  dismissNotice: NOOP,
  confirmStop: NOOP,
  restart: NOOP,
  copyDiagnostics: NOOP,
  setServiceMode: NOOP,
  setRemoteRespond: NOOP,
  setStopConfirm: NOOP,
  openExtensions: NOOP,
  retryClients: NOOP,
};

function stateAfter(...actions: readonly ConnectionAction[]): ConnectionState {
  return actions.reduce(connectionReducer, INITIAL_CONNECTION_STATE);
}

function html(state: ConnectionState): string {
  return renderToString(
    <ConnectionScreenView state={state} engine={null} locale="ko" handlers={handlers} />,
  );
}

function targets(count: number): TargetEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `box-${i}`,
    address: `unix:/run/box${i}.sock`,
  }));
}

describe("connection screen server render", () => {
  test("a remote row shows its address under the name, with the full address as the tooltip", () => {
    const loaded = stateAfter({
      type: "targetsChanged",
      items: [{ id: "b1", label: "build-box", address: "ssh://me@build/run/fresnel.sock" }],
      notice: null,
      added: null,
    });
    const markup = html(loaded);
    expect(markup).toContain(
      '<span class="min-w-0 truncate font-mono text-ui-sm font-normal text-text-tertiary" title="ssh://me@build/run/fresnel.sock">ssh://me@build/run/fresnel.sock</span>',
    );
    // 주소는 tooltip과 글에 한 번씩만 나온다(이 기기 줄에는 주소가 없다)
    expect(markup.split("ssh://me@build/run/fresnel.sock").length - 1).toBe(2);
  });

  test("an empty target list that has loaded says there are no remote targets and offers adding one", () => {
    const loaded = stateAfter({
      type: "targetsChanged",
      items: [],
      notice: null,
      added: null,
    });
    const markup = html(loaded);
    expect(markup).toContain("원격 대상이 없어요");
    expect(markup).toContain("원격 대상 추가");
    expect(markup).toContain("이 컴퓨터(앱 안)");
    expect(markup).not.toContain('type="search"');
    expect(markup).not.toContain("대상을 읽고 있어요");
  });

  test("a list that is still loading says so and does not claim the list is empty", () => {
    const markup = html(INITIAL_CONNECTION_STATE);
    expect(markup).toContain("대상을 읽고 있어요");
    expect(markup).not.toContain("원격 대상이 없어요");
  });

  test("past the threshold the list shows the search box", () => {
    const long = stateAfter({
      type: "targetsChanged",
      items: targets(21),
      notice: null,
      added: null,
    });
    expect(html(long)).toContain('type="search"');
    const short = stateAfter({
      type: "targetsChanged",
      items: targets(20),
      notice: null,
      added: null,
    });
    expect(html(short)).not.toContain('type="search"');
  });

  test("a non-loopback address in the add form shows the SSH tunnel or private network guidance", () => {
    const refused = stateAfter(
      { type: "targetsChanged", items: [], notice: null, added: null },
      { type: "formOpened" },
      { type: "formFailed", errors: { label: false, address: "non_loopback" } },
    );
    expect(html(refused)).toContain("SSH 터널이나 사설망을 써요");
  });

  test("the remote answer row says what it does, and an engine that does not report the setting says it cannot be changed", () => {
    const host = {
      mode: "service" as const,
      pid: 4211,
      startedAt: "2026-11-04T01:00:00.000Z",
      connections: 2,
      liveTurns: 1,
      idleShutdownAt: null,
    };
    const allowed = stateAfter({
      type: "statusLoaded",
      snapshot: { host, serviceEnabled: true, restartPending: false, remoteAllowRespond: true },
    });
    const allowedMarkup = html(allowed);
    expect(allowedMarkup).toContain("원격 응답 허용");
    expect(allowedMarkup).toContain("꺼져 있으면 원격 연결에서는 승인 요청에 답할 수 없어요.");
    expect(allowedMarkup).not.toContain("아직 알리지 않아서");
    const unknown = stateAfter({
      type: "statusLoaded",
      snapshot: { host, serviceEnabled: true, restartPending: false, remoteAllowRespond: null },
    });
    expect(html(unknown)).toContain(
      "은 이 엔진이 아직 알리지 않아서 바꿀 수 없어요. 위 서비스 모드 스위치와는 따로예요.",
    );
  });
});

describe("the connected clients row in the status list", () => {
  const STATUS: ConnectionAction = {
    type: "statusLoaded",
    snapshot: {
      host: {
        mode: "service",
        pid: 4211,
        startedAt: "2026-11-04T01:00:00.000Z",
        connections: 2,
        liveTurns: 1,
        idleShutdownAt: null,
      },
      serviceEnabled: true,
      restartPending: false,
      remoteAllowRespond: true,
    },
  };
  const NAMED: HostClientView = {
    connectionId: "c-1",
    transport: "stdio",
    name: "fresnel-cli",
    version: "1.2.0",
    writeThreads: 2,
    observedThreads: 1,
    self: false,
  };
  const BARE: HostClientView = {
    connectionId: "c-2",
    transport: "socket",
    writeThreads: 0,
    observedThreads: 3,
    self: true,
  };

  test("the row names each client, and a client without a name shows its transport", () => {
    const markup = html(stateAfter(STATUS, { type: "clientsLoaded", clients: [NAMED, BARE] }));
    expect(markup).toContain("연결된 클라이언트");
    expect(markup).toContain("fresnel-cli, 이 앱");
    const unnamed = html(
      stateAfter(STATUS, {
        type: "clientsLoaded",
        clients: [{ ...BARE, self: false }],
      }),
    );
    expect(unnamed).toContain("서비스 연결");
    expect(unnamed).not.toContain("이 앱");
  });

  test("only the client that is this app gets the this-app name", () => {
    const both = html(stateAfter(STATUS, { type: "clientsLoaded", clients: [NAMED, BARE] }));
    expect(both.split("이 앱").length - 1).toBe(1);
    const named = html(stateAfter(STATUS, { type: "clientsLoaded", clients: [NAMED] }));
    expect(named).not.toContain("이 앱");
  });

  test("an empty list says there are no connected clients in the row's value", () => {
    const markup = html(stateAfter(STATUS, { type: "clientsLoaded", clients: [] }));
    expect(markup).toContain("연결된 클라이언트");
    expect(markup).toContain(">없어요<");
    expect(markup).not.toContain("fresnel-cli");
  });

  test("while the list is read it says so and does not claim the list is empty", () => {
    const markup = html(stateAfter(STATUS));
    expect(markup).toContain("연결된 클라이언트를 읽고 있어요.");
    expect(markup).not.toContain(">없어요<");
  });

  test("a failed read shows a small alert with a retry button and keeps the status rows", () => {
    const markup = html(stateAfter(STATUS, { type: "clientsFailed", reason: "failed" }));
    expect(markup).toContain("클라이언트 목록을 읽지 못했어요");
    expect(markup).toContain("다시 시도");
    expect(markup).toContain("지금 대상");
    expect(markup).toContain("상태");
    expect(markup).not.toContain(">없어요<");
  });

  test("an engine without the method hides the row and keeps the status rows", () => {
    const markup = html(stateAfter(STATUS, { type: "clientsFailed", reason: "unsupported" }));
    expect(markup).not.toContain("연결된 클라이언트");
    expect(markup).not.toContain("클라이언트 목록을 읽지 못했어요");
    expect(markup).toContain("상태");
  });

  test("offline hides the row, and the status card shows its offline alert", () => {
    const markup = html(
      stateAfter(
        { type: "statusFailed", reason: "offline" },
        { type: "clientsFailed", reason: "offline" },
      ),
    );
    expect(markup).not.toContain("연결된 클라이언트");
    expect(markup).toContain("엔진에 연결되어 있지 않아요");
  });

  test("the info icon explains what the row shows", () => {
    const markup = html(stateAfter(STATUS, { type: "clientsLoaded", clients: [NAMED] }));
    expect(markup).toContain(
      "이 엔진에 붙어 있는 앱과 도구예요. 쓰기 중인 대화 수와 보기만 하는 대화 수를 보여줘요.",
    );
  });
});

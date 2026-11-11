import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { err, ok, type Result } from "@fresnel/contracts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import { createFakeRemoteAdapter, FAKE_NOW } from "../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteStatus } from "../../src/app/remote/remote-types.ts";
import type { CommandError, ConnectionSnapshot, ServiceCard } from "../../src/views/commands.ts";
import { ConnectionScreen } from "../../src/views/pages/connection/connection-screen.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 연결 화면을 통째로 올려 실행 방식 카드를 DOM에서 누른다. 백그라운드 카드는 `startLocalService`를 부르고(컨트롤러의 `selectMode`),
// 실패하면 실행 방식 줄에 실패 문장과 다시 시도가 남는다. 다른 기기 접속 섹션은 외부 접근이 켜졌을 때만 보인다.
// 이 시험이 쓰는 전역 설정은 connection-server.test.tsx와 같다(linkedom DOM을 전역에 올리고 끝나면 되돌린다).

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  for (const key of GLOBAL_KEYS) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof GLOBAL_KEYS)[number], unknown> = {
    window,
    document,
    navigator: window.navigator,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
});

afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

const HOST: ConnectionSnapshot["host"] = {
  mode: "service",
  pid: 4211,
  startedAt: "2026-11-04T01:00:00.000Z",
  connections: 0,
  liveTurns: 0,
  idleShutdownAt: null,
  safeMode: false,
};

const RUNNING: ServiceCard = {
  kind: "running",
  pid: 4321,
  version: "1.2.3",
  startedAt: 1_700_000_000_000,
  attached: true,
};
const OFF: ServiceCard = { kind: "stopped", reason: "no registration" };

/** 원격 접속이 켜진 상태. 다른 기기 접속 섹션과 페어링 단추가 이것으로 보인다 */
const REMOTE_ON: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: "ab12".repeat(16),
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

/**
 * 연결 화면을 올린다. 상태 읽기는 `service`를 돌려주고, 시작과 멈추기는 `answer`가 정한 결과를 돌려준다.
 * 부른 명령은 `calls`에 남는다. `remote`가 주는 외부 접근 상태가 실행 방식의 셋째 카드를 정한다.
 */
async function mountScreen(
  service: ServiceCard,
  options: { readonly answer?: Result<null, CommandError>; readonly remote?: RemoteStatus } = {},
) {
  const answer = options.answer ?? ok(null);
  const calls: string[] = [];
  const base = fakeCommands();
  // 엔진이 서비스에 붙었는지는 호스트 모드가 알린다. 서비스가 떠 있을 때만 서비스에 붙는다
  const snapshot: ConnectionSnapshot = {
    host: { ...HOST, mode: service.kind === "running" ? "service" : "in-process" },
    service,
    restartPending: false,
    remoteAllowRespond: true,
  };
  const commands = fakeCommands({
    remote: createFakeRemoteAdapter({
      now: () => FAKE_NOW,
      ...(options.remote === undefined ? {} : { status: options.remote }),
    }),
    connection: {
      ...base.connection,
      targets: () => Promise.resolve(ok([])),
      load: () => Promise.resolve(ok(snapshot)),
      clients: () => Promise.resolve(err({ kind: "unsupported" })),
      serviceAutostart: () =>
        Promise.resolve(
          ok({ supported: true, registered: true, active: true, linger: null, platform: "darwin" }),
        ),
      startLocalService: () => {
        calls.push("start");
        return Promise.resolve(answer);
      },
      stopLocalService: () => {
        calls.push("stop");
        return Promise.resolve(answer);
      },
    },
  });
  const h = openedHarness();
  const ui = createUiStore();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ShellStoreContext value={createShellStore(1280)}>
        <Providers engine={h.store.read} ui={ui.read} commands={commands}>
          <ConnectionScreen />
        </Providers>
      </ShellStoreContext>,
    );
  });
  await settle();
  const press = async (element: Element): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await settle();
  };
  const cleanup = async (): Promise<void> => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, calls, press, cleanup };
}

/** 화면이 읽기와 명령의 결과를 그릴 시간을 준다 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** 글이 정확히 `label`인 단추. 실행 방식 줄과 진단의 단추를 찾는다 */
function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
}

/** 실행 방식 카드 하나. 제목 글로 찾는다(카드의 제목은 `b` 요소다) */
function cardTitled(container: HTMLElement, title: string): HTMLElement | undefined {
  const titleNode = Array.from(container.querySelectorAll('[data-slot="choice-group-title"]')).find(
    (node) => node.textContent === title,
  );
  return titleNode?.closest('[role="radio"]') ?? undefined;
}

describe("the run mode cards start and fail the local service", () => {
  test("choosing the background card while the service is off starts it once", async () => {
    const screen = await mountScreen(OFF);
    const background = cardTitled(screen.container, "백그라운드");
    if (background === undefined) throw new Error("no background card");
    await screen.press(background);
    expect(screen.calls).toEqual(["start"]);
    await screen.cleanup();
  });

  test("a start that fails says so, and the retry starts it again with the same card", async () => {
    const screen = await mountScreen(OFF, { answer: err({ kind: "failed" }) });
    const background = cardTitled(screen.container, "백그라운드");
    if (background === undefined) throw new Error("no background card");
    await screen.press(background);
    expect(screen.calls).toEqual(["start"]);
    expect(screen.container.textContent).toContain(
      "서비스를 켜지 못했어요. 설정은 다시 꺼짐으로 돌렸어요.",
    );
    const retry = buttonNamed(screen.container, "다시 시도");
    if (retry === undefined) throw new Error("no retry button");
    await screen.press(retry);
    expect(screen.calls).toEqual(["start", "start"]);
    await screen.cleanup();
  });

  test("the stop button and the service line show only for a background mode, and stop is open while the service runs", async () => {
    const running = await mountScreen(RUNNING);
    expect(buttonNamed(running.container, "서비스 멈추기")?.disabled).toBe(false);
    expect(running.container.textContent).toContain("실행 중 · v1.2.3 · pid 4321 · 앱이 붙어 있음");
    await running.cleanup();
    const off = await mountScreen(OFF);
    expect(buttonNamed(off.container, "서비스 멈추기")).toBeUndefined();
    // 앱 안에서일 때는 서비스 상태 줄을 보이지 않는다
    expect(off.container.textContent).not.toContain("꺼짐 · no registration");
    await off.cleanup();
  });
});

describe("the other device access section shows only while external access is on", () => {
  test("with external access off the pairing button is not drawn", async () => {
    const screen = await mountScreen(RUNNING);
    expect(buttonNamed(screen.container, "기기 연결하기")).toBeUndefined();
    const service = cardTitled(screen.container, "백그라운드");
    expect(service?.getAttribute("aria-checked")).toBe("true");
    await screen.cleanup();
  });

  test("with external access on the third card is the checked one and the pairing button shows", async () => {
    const screen = await mountScreen(RUNNING, { remote: REMOTE_ON });
    const remote = cardTitled(screen.container, "백그라운드 + 다른 기기");
    expect(remote?.getAttribute("aria-checked")).toBe("true");
    expect(buttonNamed(screen.container, "기기 연결하기")).toBeDefined();
    await screen.cleanup();
  });
});

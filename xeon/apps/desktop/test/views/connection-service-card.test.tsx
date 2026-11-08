import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { err, ok, type Result } from "@fresnel/contracts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { CommandError, ConnectionSnapshot, ServiceCard } from "../../src/views/commands.ts";
import { ConnectionScreen } from "../../src/views/pages/connection/connection-screen.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 연결 화면의 이 기기 서비스 카드를 DOM에서 누른다. 시작은 `startLocalService`, 멈추기는 `stopLocalService`를 부르고,
// 실패하면 카드에 한 줄이 남는다. 원격 대상의 `host.shutdown`과 같은 자리에 있는 확인 대화 상자는 따로 본다.
// 이 시험이 쓰는 전역 설정은 approval-gone-card.test.tsx와 같다(linkedom DOM을 전역에 올리고 끝나면 되돌린다).

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

/** 연결 화면을 올린다. 상태 읽기는 `snapshot`을 돌려주고, 시작과 멈추기는 `answer`가 정한 결과를 돌려준다. 부른 명령은 `calls`에 남는다 */
async function mountCard(service: ServiceCard, answer: Result<null, CommandError> = ok(null)) {
  const calls: string[] = [];
  const base = fakeCommands();
  const snapshot: ConnectionSnapshot = {
    host: HOST,
    service,
    serviceEnabled: true,
    restartPending: false,
    remoteAllowRespond: true,
  };
  const commands = fakeCommands({
    connection: {
      ...base.connection,
      targets: () => Promise.resolve(ok([])),
      load: () => Promise.resolve(ok(snapshot)),
      clients: () => Promise.resolve(err({ kind: "unsupported" })),
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
  const press = async (label: string): Promise<void> => {
    const button = buttonNamed(container, label);
    await act(async () => {
      button?.dispatchEvent(new window.Event("click", { bubbles: true }));
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

/** 글이 정확히 `label`인 단추. 카드의 시작과 멈추기 단추를 찾는다 */
function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
}

describe("the local service card buttons in the DOM", () => {
  test("start calls startLocalService once, and the stopped service's stop button is locked", async () => {
    const card = await mountCard(OFF);
    expect(buttonNamed(card.container, "멈추기")?.disabled).toBe(true);
    await card.press("시작");
    expect(card.calls).toEqual(["start"]);
    await card.cleanup();
  });

  test("stop calls stopLocalService once, and the running service's start button is locked", async () => {
    const card = await mountCard(RUNNING);
    expect(buttonNamed(card.container, "시작")?.disabled).toBe(true);
    await card.press("멈추기");
    expect(card.calls).toEqual(["stop"]);
    await card.cleanup();
  });

  test("a start that fails leaves its line on the card and calls nothing else", async () => {
    const card = await mountCard(OFF, err({ kind: "failed" }));
    await card.press("시작");
    expect(card.calls).toEqual(["start"]);
    expect(card.container.textContent).toContain(
      "서비스를 켜지 못했어요. 설정은 다시 꺼짐으로 돌렸어요.",
    );
    await card.cleanup();
  });
});

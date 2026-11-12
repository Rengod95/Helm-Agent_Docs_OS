import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { t } from "@fresnel/client/i18n";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { err, ok } from "@fresnel/contracts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { ConnectionSnapshot } from "../../src/views/commands.ts";
import { ConnectionScreen } from "../../src/views/pages/connection/connection-screen.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 설정 "원격" 화면에서 엔진 다시 시작을 누르는 흐름을 linkedom DOM에서 본다. 살아 있는 엔진은 셸이 확인(`confirmed`)을 요구하므로
// 단추는 확인 대화 상자를 먼저 열고 확인 없이는 셸에 아무것도 보내지 않는다. 대화 상자는 linkedom에서 열 수 없어 확인 뒤의 `confirmed` 전송은
// `restart-confirm-dialog`의 시험이 맡는다. 이 시험이 쓰는 전역 설정은 host-address-field.test.tsx와 같다.

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Event",
  "CustomEvent",
  "getComputedStyle",
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
    HTMLFormElement: window.HTMLFormElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    getComputedStyle: () => ({ getPropertyValue: () => "", display: "", animationName: "none" }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
  // 분절 단추(Radix)가 숨은 input의 `checked` 설정자를 찾는다. linkedom에는 없어서 빈 설정자를 채운다
  const inputPrototype = window.HTMLInputElement.prototype;
  if (Object.getOwnPropertyDescriptor(inputPrototype, "checked") === undefined) {
    Object.defineProperty(inputPrototype, "checked", {
      configurable: true,
      get: () => false,
      set: () => {},
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

const SNAPSHOT: ConnectionSnapshot = {
  host: {
    mode: "in-process",
    pid: 4211,
    startedAt: "2026-11-10T09:39:00.000Z",
    connections: 0,
    liveTurns: 0,
    idleShutdownAt: null,
    safeMode: false,
  },
  service: { kind: "unknown" },
  restartPending: true,
  remoteAllowRespond: null,
};

/** 셸에 보낸 엔진 재시작 옵션 */
const restarts: unknown[] = [];

/** 화면이 읽기와 명령의 결과를 그릴 시간을 준다 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

function buttonWithText(container: Element, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
}

describe("engine restart on a live engine", () => {
  test("the restart button asks first and sends nothing until it is confirmed", async () => {
    restarts.length = 0;
    const base = fakeCommands();
    const commands = fakeCommands({
      restartEngine: (options) => {
        restarts.push(options ?? null);
        return Promise.resolve(true);
      },
      connection: {
        ...base.connection,
        targets: () => Promise.resolve(ok([])),
        load: () => Promise.resolve(ok(SNAPSHOT)),
        clients: () => Promise.resolve(err({ kind: "unsupported" })),
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
    const restart = buttonWithText(container, t("desktop.connection.keepOn.service.restart"));
    expect(restart).toBeDefined();
    await act(async () => {
      restart?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await settle();
    expect(restarts).toEqual([]);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { TargetEntry } from "@fresnel/client";
import { err, ok } from "@fresnel/contracts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { ConnectionSnapshot, ConnectTarget } from "../../src/views/commands.ts";
import { ConnectionScreen } from "../../src/views/pages/connection/connection-screen.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// "호스트" 섹션을 linkedom DOM에서 누른다. 행의 "연결"은 그 행의 호스트를 셸에 넘기고, 진행 중이면 다른 행을 잠근다.
// 추가 칸은 빈 채로 제출하면 칸별 문장을 보이고 아무것도 저장하지 않는다. 칸에 글을 치는 흐름은 linkedom에서 보낼 수 없어
// (host-address-field.test.tsx의 한계와 같다) `host-address.test.ts`의 값 시험이 맡는다. 이름 바꾸기와 삭제 확인은 메뉴와
// 대화 상자라 linkedom에서 열 수 없어 `connection-model.test.ts`의 값 시험이 맡는다.
// 이 시험이 쓰는 전역 설정은 host-address-field.test.tsx와 같다(끝나면 되돌린다).

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

const BUILD: TargetEntry = {
  id: "a",
  label: "build-box",
  address: "ssh://me@build/run/fresnel.sock",
};
const MINI: TargetEntry = {
  id: "b",
  label: "mac-mini",
  address: "unix:/run/user/501/fresnel.sock",
};

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
  restartPending: false,
  remoteAllowRespond: null,
};

interface Mounted {
  readonly container: HTMLElement;
  /** 셸에 넘긴 대상 바꾸기 인자 */
  readonly retargets: ConnectTarget[];
  /** 저장하려고 넘긴 목록 */
  readonly saves: (readonly TargetEntry[])[];
  readonly press: (text: string) => Promise<void>;
  readonly submit: (form: Element) => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

/** 연결 화면을 올린다. 호스트 목록은 BUILD와 MINI이고, 상태는 이 기기가 실행 중이라고 읽는다 */
async function mountScreen(): Promise<Mounted> {
  const retargets: ConnectTarget[] = [];
  const saves: (readonly TargetEntry[])[] = [];
  const base = fakeCommands();
  const commands = fakeCommands({
    connection: {
      ...base.connection,
      targets: () => Promise.resolve(ok([BUILD, MINI])),
      saveTargets: (list) => {
        saves.push(list);
        return Promise.resolve(ok(null));
      },
      retarget: (target) => {
        retargets.push(target);
        return Promise.resolve(ok(null));
      },
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
  const press = async (text: string): Promise<void> => {
    await act(async () => {
      buttonWithText(container, text).dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await settle();
  };
  const submit = async (form: Element): Promise<void> => {
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  };
  const cleanup = async (): Promise<void> => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, retargets, saves, press, submit, cleanup };
}

/** 화면이 읽기와 명령의 결과를 그릴 시간을 준다 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** 글이 정확히 `text`인 단추 */
function buttonWithText(container: Element, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

/** 글이 "연결"인 단추들. 행 순서대로다(이 기기 행은 지금 호스트라 단추가 없다) */
function connectButtons(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent === "연결",
  );
}

describe("the host rows connect and lock", () => {
  test("a row's connect hands that host to the shell as its address and label", async () => {
    const screen = await mountScreen();
    const [buildConnect] = connectButtons(screen.container);
    await act(async () => {
      buildConnect?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await settle();
    expect(screen.retargets).toEqual([
      { kind: "remote", address: BUILD.address, label: BUILD.label },
    ]);
    await screen.cleanup();
  });

  test("while a connect is going the other rows' connect buttons are locked", async () => {
    const screen = await mountScreen();
    const [buildConnect] = connectButtons(screen.container);
    await act(async () => {
      buildConnect?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    await settle();
    // build-box는 붙는 중이라 단추가 없고, 이 기기 행(이제 지금 호스트가 아니다)과 mac-mini 행의 단추가 잠긴다
    expect(connectButtons(screen.container).map((button) => button.disabled)).toEqual([true, true]);
    await screen.cleanup();
  });

  test("the host the engine is on is the card, not a list row; the other hosts keep their connect buttons", async () => {
    const screen = await mountScreen();
    // 이 컴퓨터는 위 카드의 제목으로만 보이고 목록 행으로는 다시 나오지 않는다
    expect(screen.container.textContent).toContain("이 컴퓨터(앱 안)");
    expect(screen.container.textContent).not.toContain("연결됨");
    expect(connectButtons(screen.container).map((button) => button.disabled)).toEqual([
      false,
      false,
    ]);
    await screen.cleanup();
  });
});

describe("the host rows show their kind and address", () => {
  test("a remote row shows its kind badge and its address under the name", async () => {
    const screen = await mountScreen();
    const spans = Array.from(screen.container.querySelectorAll("span"));
    expect(spans.some((span) => span.textContent === "SSH")).toBe(true);
    expect(spans.some((span) => span.textContent === "이 컴퓨터")).toBe(true);
    const address = screen.container.querySelector(`[title="${BUILD.address}"]`);
    expect(address?.textContent).toBe(BUILD.address);
    await screen.cleanup();
  });

  test("each remote row has its more menu named for that host, and this computer has none", async () => {
    const screen = await mountScreen();
    const labels = Array.from(screen.container.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toContain("build-box 더보기");
    expect(labels).toContain("mac-mini 더보기");
    expect(labels).not.toContain("이 컴퓨터(앱 안) 더보기");
    await screen.cleanup();
  });

  test("the current host card is titled with this computer's name", async () => {
    const screen = await mountScreen();
    expect(screen.container.querySelector("h3")?.textContent).toBe("이 컴퓨터(앱 안)");
    await screen.cleanup();
  });
});

describe("the add card", () => {
  test("submitting it empty shows each required field's sentence and saves nothing", async () => {
    const screen = await mountScreen();
    await screen.press("호스트 추가");
    const form = screen.container.querySelector("form");
    if (form === null) throw new Error("no add form");
    await screen.submit(form);
    expect(screen.container.textContent).toContain("호스트를 넣어요.");
    expect(screen.container.textContent).toContain("서비스 경로를 넣어요.");
    expect(screen.saves).toEqual([]);
    await screen.cleanup();
  });
});

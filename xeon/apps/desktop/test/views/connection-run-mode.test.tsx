import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { RemoteNotice, RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import type { ServerMode } from "../../src/app/remote/remote-model.ts";
import { FAKE_FINGERPRINT } from "../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteActions } from "../../src/app/remote/use-remote-controller.ts";
import type { RemoteStatus } from "../../src/app/remote/remote-types.ts";
import type { ServiceAutostart } from "../../src/transport/ipc.ts";
import type { ServiceCard } from "../../src/views/commands.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  RunModeSection,
  type RunModeProps,
} from "../../src/views/pages/connection/connection-run-mode.tsx";

// "실행 방식" 섹션의 그림을 linkedom DOM에 올려 본다. 카드는 `data-value`와 `aria-checked`로, 단추와 스위치는 누름으로 본다.
// 고르기와 서비스 멈추기와 다시 시작은 기록 묶음에 받은 순서대로 남는다. 대화 상자는 `inline`으로 제자리에 그린다.
// 이 시험이 쓰는 전역 설정은 connection-server.test.tsx와 같다(끝나면 되돌린다).

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
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
});

afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

/** 기록된 동작 한 번. 이름과 인자를 남긴다 */
interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** 동작 묶음과 그 기록. 섹션이 부른 동작을 `calls`에 받은 순서대로 쌓는다 */
function recorder(): { readonly actions: RemoteActions; readonly calls: Call[] } {
  const calls: Call[] = [];
  const actions: RemoteActions = {
    selectMode: (mode, serviceRunning) => {
      calls.push({ name: "selectMode", args: [mode, serviceRunning] });
      return Promise.resolve();
    },
    confirmRemote: () => {
      calls.push({ name: "confirmRemote", args: [] });
      return Promise.resolve();
    },
    cancelConfirm: () => {
      calls.push({ name: "cancelConfirm", args: [] });
    },
    retryEnable: () => {
      calls.push({ name: "retryEnable", args: [] });
      return Promise.resolve();
    },
    issuePairing: () => {
      calls.push({ name: "issuePairing", args: [] });
      return Promise.resolve();
    },
    revoke: (target) => {
      calls.push({ name: "revoke", args: [target] });
      return Promise.resolve();
    },
    reloadStatus: () => {
      calls.push({ name: "reloadStatus", args: [] });
      return Promise.resolve();
    },
    reloadDevices: () => {
      calls.push({ name: "reloadDevices", args: [] });
      return Promise.resolve();
    },
    requestAutostart: (enabled) => {
      calls.push({ name: "requestAutostart", args: [enabled] });
      return Promise.resolve();
    },
    confirmAutostart: () => {
      calls.push({ name: "confirmAutostart", args: [] });
      return Promise.resolve();
    },
    cancelAutostartConfirm: () => {
      calls.push({ name: "cancelAutostartConfirm", args: [] });
    },
    reloadAutostart: () => {
      calls.push({ name: "reloadAutostart", args: [] });
      return Promise.resolve();
    },
  };
  return { actions, calls };
}

const RUNNING: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: FAKE_FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

const AUTOSTART_ON: ServiceAutostart = {
  supported: true,
  registered: true,
  active: true,
  linger: null,
  platform: "darwin",
};

const READY: RemoteScreenState = {
  status: { kind: "ready", value: RUNNING },
  devices: { kind: "ready", value: [] },
  pairing: { kind: "none" },
  confirmOpen: false,
  busy: "none",
  notice: null,
  autostart: { kind: "ready", value: AUTOSTART_ON },
  autostartConfirmOpen: false,
  autostartLinger: false,
};

const RUNNING_CARD: ServiceCard = {
  kind: "running",
  pid: 4321,
  version: "1.2.3",
  startedAt: 1_700_000_000_000,
  attached: true,
};
const STOPPED_CARD: ServiceCard = { kind: "stopped", reason: "no registration" };

/** 화면 상태. 이 기기 서비스 카드와 다시 시작 대기를 정한다. 원격 응답은 허용이다 */
function screenState(service: ServiceCard, restartPending = false): ConnectionState {
  const actions: readonly ConnectionAction[] = [
    {
      type: "statusLoaded",
      snapshot: {
        host: {
          mode: "service",
          pid: 4211,
          startedAt: "2026-11-04T01:00:00.000Z",
          connections: 0,
          liveTurns: 0,
          idleShutdownAt: null,
          safeMode: false,
        },
        service,
        restartPending,
        remoteAllowRespond: true,
      },
    },
  ];
  return actions.reduce(connectionReducer, INITIAL_CONNECTION_STATE);
}

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  await mounted.splice(0).reduce<Promise<void>>(async (previous, unmount) => {
    await previous;
    await unmount();
  }, Promise.resolve());
});

interface Harness {
  readonly mode?: ServerMode;
  readonly state?: ConnectionState;
  readonly remote?: Partial<RemoteScreenState>;
  readonly lastChoice?: ServerMode | null;
  readonly notice?: RemoteNotice | null;
}

/** 섹션을 DOM에 올린다. 고르기와 다시 시작과 서비스 멈추기 확인은 `calls`에 받은 순서대로 남긴다 */
async function mount(harness: Harness = {}): Promise<{
  readonly container: HTMLElement;
  readonly calls: Call[];
}> {
  const rec = recorder();
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const props: RunModeProps = {
    mode: harness.mode ?? "off",
    state: harness.state ?? screenState(STOPPED_CARD),
    remote: { ...READY, notice: harness.notice ?? null, ...harness.remote },
    actions: rec.actions,
    lastChoice: harness.lastChoice ?? null,
    choose: (mode) => {
      rec.calls.push({ name: "choose", args: [mode] });
    },
    handlers: {
      restart: () => {
        rec.calls.push({ name: "restart", args: [] });
      },
      setStopConfirm: (open) => {
        rec.calls.push({ name: "setStopConfirm", args: [open] });
      },
    },
    inline: true,
  };
  await act(async () => {
    root.render(<RunModeSection {...props} />);
  });
  mounted.push(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  return { container, calls: rec.calls };
}

/** 글이 맞는 단추들(정확히 같은 글). 대화 상자 단추도 문서 순서대로 든다 */
function buttonsNamed(container: Element, text: string): Element[] {
  return Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent.trim() === text,
  );
}

function buttonNamed(container: Element, text: string): Element {
  const found = buttonsNamed(container, text)[0];
  if (found === undefined) throw new Error(`no button named ${text}`);
  return found;
}

/** 실행 방식 카드 하나. `data-value`로 찾는다 */
function cardOf(container: Element, mode: ServerMode): Element {
  const found = container.querySelector(`[role="radio"][data-value="${mode}"]`);
  if (found === null) throw new Error(`no card ${mode}`);
  return found;
}

const AUTOSTART_LABEL = "컴퓨터에 로그인하면 자동으로 시작";
function autostartSwitchOf(container: Element): Element {
  const found = container.querySelector(`[role="switch"][aria-label="${AUTOSTART_LABEL}"]`);
  if (found === null) throw new Error("no autostart switch");
  return found;
}

async function press(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function textOf(container: Element): string {
  return container.textContent;
}

describe("the three run mode cards", () => {
  test("the cards keep their order, and the card of the current mode is the checked one", async () => {
    const view = await mount({ mode: "service" });
    const text = textOf(view.container);
    expect(text.indexOf("앱 안에서")).toBeLessThan(text.indexOf("백그라운드 + 다른 기기"));
    expect(cardOf(view.container, "off").getAttribute("aria-checked")).toBe("false");
    expect(cardOf(view.container, "service").getAttribute("aria-checked")).toBe("true");
    expect(cardOf(view.container, "service+remote").getAttribute("aria-checked")).toBe("false");
  });

  test("a card press chooses that mode and nothing else", async () => {
    const view = await mount({ mode: "off" });
    await press(cardOf(view.container, "service+remote"));
    expect(view.calls).toEqual([{ name: "choose", args: ["service+remote"] }]);
  });

  test("while a write runs the cards are locked", async () => {
    const view = await mount({ mode: "off", remote: { busy: "enabling" } });
    expect(cardOf(view.container, "service").hasAttribute("disabled")).toBe(true);
    await press(cardOf(view.container, "service"));
    expect(view.calls).toEqual([]);
  });

  test("a restart need shows its warning alert, and its button restarts the engine", async () => {
    const view = await mount({ mode: "service", state: screenState(RUNNING_CARD, true) });
    expect(textOf(view.container)).toContain(
      "재시작이 필요해요. 엔진을 다시 시작하면 설정이 적용돼요.",
    );
    await press(buttonNamed(view.container, "엔진 다시 시작"));
    expect(view.calls).toEqual([{ name: "restart", args: [] }]);
  });

  test("without a restart need the warning alert does not show", async () => {
    const view = await mount({ mode: "service" });
    expect(textOf(view.container)).not.toContain("재시작이 필요해요");
  });
});

describe("the background lines under the cards", () => {
  test("off shows no service line, no autostart switch, and no stop button", async () => {
    const view = await mount({ mode: "off" });
    expect(textOf(view.container)).not.toContain("자동 시작");
    expect(buttonsNamed(view.container, "서비스 멈추기").length).toBe(0);
    expect(view.container.querySelector('[role="switch"]')).toBeNull();
  });

  test("a running service says its version, pid and that the app is attached", async () => {
    const view = await mount({ mode: "service", state: screenState(RUNNING_CARD) });
    expect(textOf(view.container)).toContain("실행 중 · v1.2.3 · pid 4321 · 앱이 붙어 있음");
  });

  test("a stopped service says it is off with its reason, and a card that could not be read says so", async () => {
    const off = await mount({ mode: "service", state: screenState(STOPPED_CARD) });
    expect(textOf(off.container)).toContain("꺼짐 · no registration");
    const unknown = await mount({
      mode: "service",
      state: screenState({ kind: "unknown" }),
    });
    expect(textOf(unknown.container)).toContain("상태를 읽지 못했어요");
  });

  test("stop is open only while the service runs, and a press asks for the stop confirm", async () => {
    const running = await mount({ mode: "service", state: screenState(RUNNING_CARD) });
    expect(buttonNamed(running.container, "서비스 멈추기").hasAttribute("disabled")).toBe(false);
    await press(buttonNamed(running.container, "서비스 멈추기"));
    expect(running.calls).toEqual([{ name: "setStopConfirm", args: [true] }]);
    const off = await mount({ mode: "service", state: screenState(STOPPED_CARD) });
    expect(buttonNamed(off.container, "서비스 멈추기").hasAttribute("disabled")).toBe(true);
  });
});

describe("the failure lines of a run mode choice", () => {
  test("a failed start says the service could not start, and its retry chooses the same mode again", async () => {
    const view = await mount({
      mode: "off",
      lastChoice: "service",
      notice: { kind: "serviceFailed", code: null },
    });
    expect(textOf(view.container)).toContain(
      "서비스를 켜지 못했어요. 설정은 다시 꺼짐으로 돌렸어요.",
    );
    await press(buttonNamed(view.container, "다시 시도"));
    expect(view.calls).toEqual([{ name: "choose", args: ["service"] }]);
  });

  test("a failed stop says the service could not stop, and its retry chooses the off mode again", async () => {
    const view = await mount({
      mode: "service",
      lastChoice: "off",
      state: screenState(RUNNING_CARD),
      notice: { kind: "serviceFailed", code: null },
    });
    expect(textOf(view.container)).toContain("서비스를 멈추지 못했어요. 다시 해 봐요.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(view.calls.at(-1)).toEqual({ name: "choose", args: ["off"] });
  });

  test("a failed enable or disable says so, with no retry", async () => {
    const view = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      notice: { kind: "enableFailed", code: null },
    });
    expect(textOf(view.container)).toContain("다른 기기 접속을 켜지 못했어요. 다시 해 봐요.");
    expect(buttonsNamed(view.container, "다시 시도").length).toBe(0);
  });
});

describe("the login autostart switch", () => {
  test("it shows the registration, and turning it off writes at once", async () => {
    const view = await mount({ mode: "service", state: screenState(RUNNING_CARD) });
    expect(autostartSwitchOf(view.container).getAttribute("aria-checked")).toBe("true");
    await press(autostartSwitchOf(view.container));
    expect(view.calls).toEqual([{ name: "requestAutostart", args: [false] }]);
  });

  test("turning it on only asks: the confirm opens, and its enable button confirms while cancel closes it", async () => {
    const off = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { autostart: { kind: "ready", value: { ...AUTOSTART_ON, registered: false } } },
    });
    await press(autostartSwitchOf(off.container));
    expect(off.calls).toEqual([{ name: "requestAutostart", args: [true] }]);
    const open = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { autostartConfirmOpen: true },
    });
    expect(textOf(open.container)).toContain("자동 시작 켜기 확인");
    await press(buttonNamed(open.container, "켜기"));
    await press(buttonNamed(open.container, "취소"));
    expect(open.calls).toEqual([
      { name: "confirmAutostart", args: [] },
      { name: "cancelAutostartConfirm", args: [] },
    ]);
  });

  test("on an unsupported platform the switch is locked and the reason shows", async () => {
    const view = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: {
        autostart: {
          kind: "ready",
          value: { ...AUTOSTART_ON, supported: false, registered: false, platform: "win32" },
        },
      },
    });
    expect(autostartSwitchOf(view.container).hasAttribute("disabled")).toBe(true);
    expect(textOf(view.container)).toContain("이 플랫폼에서는 자동 시작을 지원하지 않아요.");
  });

  test("a failed read shows its line, and its retry reloads the setting", async () => {
    const view = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { autostart: { kind: "failed", error: { kind: "failed", message: null } } },
    });
    expect(textOf(view.container)).toContain("자동 시작 상태를 읽지 못했어요.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(view.calls).toEqual([{ name: "reloadAutostart", args: [] }]);
  });

  test("a failed write shows one line with only the closed code, and the linger hint shows its command once", async () => {
    const failed = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      notice: { kind: "autostartFailed", code: "autostart_failed" },
    });
    expect(textOf(failed.container)).toContain(
      "자동 시작을 바꾸지 못했어요(autostart_failed). 다시 해 봐요.",
    );
    const linger = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { autostartLinger: true },
    });
    expect(textOf(linger.container).split("loginctl enable-linger").length - 1).toBe(1);
  });
});

describe("the enable confirm opened from the cards", () => {
  test("it shows the https addresses and the full fingerprint but not the loopback address, and its buttons confirm or cancel", async () => {
    const view = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { confirmOpen: true },
    });
    const text = textOf(view.container);
    expect(text).toContain("https://192.168.0.10:47443");
    expect(text).not.toContain("http://127.0.0.1:47100");
    expect(text).toContain("인증서 지문 AB:12:AB:12");
  });

  test("the enable button calls confirmRemote and cancel calls cancelConfirm", async () => {
    const rec = recorder();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunModeSection
          mode="service"
          state={screenState(RUNNING_CARD)}
          remote={{ ...READY, confirmOpen: true }}
          actions={rec.actions}
          lastChoice={null}
          choose={() => {}}
          handlers={{ restart: () => {}, setStopConfirm: () => {} }}
          inline
        />,
      );
    });
    mounted.push(async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
    await press(buttonNamed(container, "다른 기기 접속 켜기"));
    await press(buttonNamed(container, "취소"));
    expect(rec.calls.map((call) => call.name)).toEqual(["confirmRemote", "cancelConfirm"]);
  });
});

describe("the status line of the background mode", () => {
  test("while the status is read a background mode says so, and no status line shows in off", async () => {
    const reading = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: { status: { kind: "loading" } },
    });
    expect(textOf(reading.container)).toContain("상태를 읽고 있어요.");
    const off = await mount({ mode: "off", remote: { status: { kind: "loading" } } });
    expect(textOf(off.container)).not.toContain("상태를 읽고 있어요.");
  });

  test("an engine without external access says so in a neutral line, and its retry reloads the status", async () => {
    const view = await mount({
      mode: "service",
      state: screenState(RUNNING_CARD),
      remote: {
        status: { kind: "failed", error: { kind: "unsupported" } },
      },
    });
    expect(textOf(view.container)).toContain("이 엔진은 다른 기기 접속을 아직 지원하지 않아요.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(view.calls).toEqual([{ name: "reloadStatus", args: [] }]);
  });
});

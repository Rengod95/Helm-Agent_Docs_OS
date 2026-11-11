import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import { FAKE_FINGERPRINT, FAKE_NOW } from "../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteActions } from "../../src/app/remote/use-remote-controller.ts";
import type { RemoteDevice, RemoteStatus } from "../../src/app/remote/remote-types.ts";
import type { ServiceAutostart } from "../../src/transport/ipc.ts";
import type { ServiceCard } from "../../src/views/commands.ts";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  RemoteAccessSection,
  type RemoteAccessProps,
} from "../../src/views/pages/connection/connection-server.tsx";

// "다른 기기 접속" 섹션의 그림을 linkedom DOM에 올려 본다. 보이는 글은 `textContent`로, 단추와 스위치의 누름은 DOM 이벤트로 본다.
// 대화 상자는 `inline`으로 제자리에 그린다(포털은 이 시험 환경에 없다). 누름이 부른 동작은 기록 묶음에 받은 순서대로 남는다.
// 이 시험이 쓰는 전역 설정은 connection-run-mode.test.tsx와 같다(끝나면 되돌린다).

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
    // Radix는 전역 `Event`와 `CustomEvent`로 포커스 신호를 보낸다. linkedom의 노드가 받으려면 같은 클래스여야 한다
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    // 부재 있는 자리(Radix Presence)가 계산된 스타일을 읽는다. 이 시험에서는 애니메이션이 없다
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

/** 시험의 실행 중 상태. 접속 주소는 https 한 호스트와 루프백 하나다 */
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

/** 지문을 콜론 대문자 쌍으로 쓴 값. 소문자 `ab12`를 열여섯 번 이은 지문이라 `AB:12`가 열여섯 번 나온다 */
const FINGERPRINT_TEXT = Array.from({ length: 16 }, () => "AB:12").join(":");

const PHONE: RemoteDevice = {
  id: "d1",
  name: "Pixel",
  kind: "web",
  createdAt: FAKE_NOW - 3_600_000,
  lastSeenAt: FAKE_NOW - 10_000,
  address: "192.168.0.21",
};
const LAPTOP: RemoteDevice = {
  id: "d2",
  name: "Studio",
  kind: "desktop",
  createdAt: FAKE_NOW - 7_200_000,
  lastSeenAt: FAKE_NOW - 180_000,
  address: null,
};

/** 지원하고 등록된 로그인 자동 시작 상태. 시험 기본값은 이것이다 */
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

function stateWith(patch: Partial<RemoteScreenState>): RemoteScreenState {
  return { ...READY, ...patch };
}

/** 화면 상태. 외부 접근 섹션은 원격 응답 설정 값과 잠금만 읽는다 */
function screenState(allow: boolean | null = true): ConnectionState {
  const service: ServiceCard = {
    kind: "running",
    pid: 4321,
    version: "1.2.3",
    startedAt: 1,
    attached: true,
  };
  return [
    {
      type: "statusLoaded" as const,
      snapshot: {
        host: {
          mode: "service" as const,
          pid: 4211,
          startedAt: "2026-11-04T01:00:00.000Z",
          connections: 0,
          liveTurns: 0,
          idleShutdownAt: null,
          safeMode: false,
        },
        service,
        restartPending: false,
        remoteAllowRespond: allow,
      },
    },
  ].reduce(connectionReducer, INITIAL_CONNECTION_STATE);
}

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  // 떼어 내는 순서대로 하나씩 기다린다(act가 겹치지 않게)
  await mounted.splice(0).reduce<Promise<void>>(async (previous, unmount) => {
    await previous;
    await unmount();
  }, Promise.resolve());
});

/** 섹션을 DOM에 올린다. 끝나면 `afterEach`가 떼어 낸다 */
async function mount(props: RemoteMountProps = {}): Promise<{
  readonly container: HTMLElement;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<RemoteAccessSection {...baseProps(props)} />);
  });
  mounted.push(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  return { container };
}

/** 섹션 시험의 입력. `remote`는 외부 접근 상태 전체 가운데 바꿀 칸만 준다 */
type RemoteMountProps = Omit<Partial<RemoteAccessProps>, "remote"> & {
  readonly remote?: Partial<RemoteScreenState>;
};

function baseProps(props: RemoteMountProps): RemoteAccessProps {
  const { remote, ...rest } = props;
  return {
    status: RUNNING,
    state: screenState(),
    remote: stateWith(remote ?? {}),
    actions: recorder().actions,
    nowMs: FAKE_NOW,
    locale: "ko",
    copy: () => {},
    setRemoteRespond: () => {},
    inline: true,
    ...rest,
  };
}

/** 글이 맞는 단추들(정확히 같은 글). 대화 상자 단추도 문서 순서대로 든다 */
function buttonsNamed(container: Element, text: string): Element[] {
  return Array.from(container.querySelectorAll("button")).filter(
    (button) => button.textContent.trim() === text,
  );
}

/** 글이 맞는 단추 하나. 없으면 시험이 실패하도록 던진다 */
function buttonNamed(container: Element, text: string): Element {
  return buttonAt(container, text, 0);
}

/** 글이 맞는 단추 가운데 `index`번째(문서 순서). 없으면 시험이 실패하도록 던진다 */
function buttonAt(container: Element, text: string, index: number): Element {
  const found = buttonsNamed(container, text).at(index);
  if (found === undefined) throw new Error(`no button named ${text} at ${index}`);
  return found;
}

/** 다른 기기에서 승인에 답하기 스위치. 글이 붙은 줄의 `aria-labelledby`가 가리키는 스위치다 */
function respondSwitchOf(container: Element): Element {
  const found = Array.from(container.querySelectorAll('[role="switch"]')).find((sw) => {
    const id = sw.getAttribute("aria-labelledby");
    return (
      id !== null &&
      container.querySelector(`[id="${id}"]`)?.textContent.trim() === "다른 기기에서 승인에 답하기"
    );
  });
  if (found === undefined) throw new Error("no respond switch");
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

describe("the status rows at the top of the remote section", () => {
  test("the state, every access address and the fingerprint preview show, with the certificate source", async () => {
    const view = await mount();
    const text = textOf(view.container);
    expect(text).toContain("실행 중");
    expect(text).toContain("https://192.168.0.10:47443");
    expect(text).toContain("http://127.0.0.1:47100");
    // 지문은 앞 네 쌍(여덟 조각)만 보이고 나머지는 펼쳐야 보인다
    expect(text).toContain("AB:12:AB:12:AB:12:AB:12…");
    expect(text).not.toContain(FINGERPRINT_TEXT);
    expect(text).toContain("자체 서명");
  });

  test("copying an address hands its exact text to copy", async () => {
    const copied: string[] = [];
    const view = await mount({ copy: (text) => copied.push(text) });
    await press(buttonAt(view.container, "복사", 0));
    expect(copied).toEqual(["https://192.168.0.10:47443"]);
  });

  test("expanding the fingerprint shows all of it in two lines, and copy hands over the whole fingerprint", async () => {
    const copied: string[] = [];
    const view = await mount({ copy: (text) => copied.push(text) });
    await press(buttonNamed(view.container, "펼치기"));
    // 펼친 두 줄을 이으면 지문 전체다
    expect(textOf(view.container)).toContain(FINGERPRINT_TEXT);
    expect(buttonsNamed(view.container, "접기").length).toBe(1);
    // 지문의 복사는 주소 복사 두 개 뒤에 온다. 펼쳤어도 복사는 전체를 쓴다
    await press(buttonAt(view.container, "복사", 2));
    expect(copied).toEqual([FINGERPRINT_TEXT]);
  });

  test("a starting engine shows its state and no fingerprint yet, and no pairing or device block", async () => {
    const view = await mount({
      status: {
        ...RUNNING,
        state: "starting",
        fingerprint: null,
        tlsPort: null,
        loopbackPort: null,
        hosts: [],
      },
    });
    const text = textOf(view.container);
    expect(text).toContain("시작하는 중");
    expect(text).toContain("아직 없어요");
    expect(text).not.toContain("기기 연결하기");
    expect(text).not.toContain("연결된 기기");
  });

  test("a status error shows its message in a danger alert, and its retry calls retryEnable", async () => {
    const rec = recorder();
    const view = await mount({
      status: {
        ...RUNNING,
        state: "failed",
        error: { kind: "failed", message: "포트를 열지 못했어요" },
      },
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("포트를 열지 못했어요");
    expect(view.container.querySelector('[data-tone="danger"]')).not.toBeNull();
    await press(buttonNamed(view.container, "다시 시도"));
    expect(rec.calls).toEqual([{ name: "retryEnable", args: [] }]);
  });

  test("the web notifications row says it is off on a self-signed address", async () => {
    const view = await mount();
    expect(textOf(view.container)).toContain("웹 알림");
    expect(textOf(view.container)).toContain("이 주소에서는 꺼져 있어요.");
  });
});

describe("pairing and devices", () => {
  test("none: the create button is solid and calls issuePairing", async () => {
    const rec = recorder();
    const view = await mount({ actions: rec.actions });
    await press(buttonNamed(view.container, "기기 연결하기"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });

  test("issued: the code and the remaining time at nowMs (exact M:SS)", async () => {
    const view = await mount({
      remote: {
        pairing: { kind: "issued", code: { code: "123456", expiresAt: FAKE_NOW + 245_000 } },
      },
    });
    const text = textOf(view.container);
    expect(text).toContain("123456");
    expect(text).toContain("남은 시간 4:05");
  });

  test("issued and expired: 만료됨 and 다시 만들기 calls issuePairing", async () => {
    const rec = recorder();
    const view = await mount({
      remote: { pairing: { kind: "issued", code: { code: "123456", expiresAt: FAKE_NOW - 1 } } },
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("만료됨");
    expect(textOf(view.container)).not.toContain("남은 시간");
    await press(buttonNamed(view.container, "다시 만들기"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });

  test("the code's copy hands over the exact code", async () => {
    const copied: string[] = [];
    const view = await mount({
      remote: {
        pairing: { kind: "issued", code: { code: "123456", expiresAt: FAKE_NOW + 60_000 } },
      },
      copy: (text) => copied.push(text),
    });
    // 주소 복사 두 개와 지문 복사 한 개 뒤에 코드의 복사가 있다
    await press(buttonAt(view.container, "복사", 3));
    expect(copied).toEqual(["123456"]);
  });

  test("issuing: a busy button that says 만드는 중", async () => {
    const view = await mount({ remote: { pairing: { kind: "issuing" } } });
    expect(textOf(view.container)).toContain("만드는 중");
  });

  test("failed with remote-off says external access must be on, and another error says the code could not be made", async () => {
    const off = await mount({
      remote: { pairing: { kind: "failed", error: { kind: "remote-off" } } },
    });
    expect(textOf(off.container)).toContain("다른 기기 접속을 켜야 연결 코드를 만들 수 있어요.");
    const rec = recorder();
    const other = await mount({
      remote: { pairing: { kind: "failed", error: { kind: "bad-reply" } } },
      actions: rec.actions,
    });
    expect(textOf(other.container)).toContain("연결 코드를 만들지 못했어요. 다시 해 봐요.");
    await press(buttonNamed(other.container, "기기 연결하기"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });

  test("a device's 끊기 opens its confirm, and confirming revokes that id only", async () => {
    const rec = recorder();
    const view = await mount({
      remote: { devices: { kind: "ready", value: [PHONE, LAPTOP] } },
      actions: rec.actions,
    });
    // 행의 끊기 단추가 먼저 있고, 열린 대화 상자의 끊기는 문서 끝에 있다
    await press(buttonNamed(view.container, "끊기"));
    expect(textOf(view.container)).toContain("기기 연결 끊기 확인");
    expect(textOf(view.container)).toContain("Pixel 기기의 연결을 끊어요.");
    expect(rec.calls).toEqual([]);
    const confirm = buttonsNamed(view.container, "끊기").at(-1);
    if (confirm === undefined) throw new Error("no confirm button");
    await press(confirm);
    expect(rec.calls).toEqual([{ name: "revoke", args: [{ id: "d1" }] }]);
  });

  test("모두 끊기 opens its confirm, and confirming revokes every device", async () => {
    const rec = recorder();
    const view = await mount({
      remote: { devices: { kind: "ready", value: [PHONE, LAPTOP] } },
      actions: rec.actions,
    });
    await press(buttonNamed(view.container, "모두 끊기"));
    expect(textOf(view.container)).toContain("기기 모두 끊기 확인");
    expect(textOf(view.container)).toContain("연결된 기기 2대의 연결을 모두 끊어요.");
    const confirm = buttonsNamed(view.container, "끊기").at(-1);
    if (confirm === undefined) throw new Error("no confirm button");
    await press(confirm);
    expect(rec.calls).toEqual([{ name: "revoke", args: [{ all: true }] }]);
  });

  test("devices loading shows a skeleton with screen-reader text; failed shows the line and a retry that reloads", async () => {
    const loading = await mount({ remote: { devices: { kind: "loading" } } });
    expect(loading.container.querySelector('[role="status"]')).not.toBeNull();
    expect(textOf(loading.container)).toContain("기기 목록을 읽고 있어요.");
    const rec = recorder();
    const failed = await mount({
      remote: { devices: { kind: "failed", error: { kind: "failed", message: null } } },
      actions: rec.actions,
    });
    expect(textOf(failed.container)).toContain("기기 목록을 읽지 못했어요.");
    await press(buttonNamed(failed.container, "다시 시도"));
    expect(rec.calls).toEqual([{ name: "reloadDevices", args: [] }]);
  });

  test("no devices says so, and a failed revoke shows its sentence", async () => {
    const empty = await mount();
    expect(textOf(empty.container)).toContain("연결된 기기가 없어요. 기기 연결하기로 추가해요.");
    const failed = await mount({ remote: { notice: { kind: "revokeFailed", code: null } } });
    expect(textOf(failed.container)).toContain("기기 연결을 끊지 못했어요. 다시 해 봐요.");
  });
});

describe("the respond switch", () => {
  test("the switch shows the allowed value, and toggling it calls setRemoteRespond with the new value", async () => {
    const sent: boolean[] = [];
    const view = await mount({
      state: screenState(true),
      setRemoteRespond: (enabled) => sent.push(enabled),
    });
    expect(respondSwitchOf(view.container).getAttribute("aria-checked")).toBe("true");
    await press(respondSwitchOf(view.container));
    expect(sent).toEqual([false]);
  });

  test("an engine that does not report the setting locks the switch and says it cannot be changed", async () => {
    const view = await mount({ state: screenState(null) });
    expect(respondSwitchOf(view.container).hasAttribute("disabled")).toBe(true);
    expect(textOf(view.container)).toContain(
      "이 엔진은 이 설정을 아직 알리지 않아서 바꿀 수 없어요.",
    );
  });

  test("the switch row names what it does", async () => {
    const view = await mount();
    expect(textOf(view.container)).toContain("다른 기기에서 승인에 답하기");
  });
});

describe("the enable confirm lives in the run mode section", () => {
  test("an open enable confirm is not drawn here", async () => {
    const view = await mount({ remote: { confirmOpen: true } });
    expect(view.container.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull();
  });
});

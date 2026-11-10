import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import {
  FAKE_FINGERPRINT,
  FAKE_NOW,
  FAKE_OFF_STATUS,
} from "../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteActions } from "../../src/app/remote/use-remote-controller.ts";
import type { RemoteDevice, RemoteError, RemoteStatus } from "../../src/app/remote/remote-types.ts";
import {
  ServerModeSection,
  type ServerModeSectionProps,
} from "../../src/views/pages/connection/connection-server.tsx";

// 서버 모드 섹션의 그림을 linkedom DOM에 올려 본다. 보이는 글은 `textContent`로, 라디오의 선택과 단추의 누름은 DOM 이벤트로 본다.
// 대화 상자는 `inline`으로 제자리에 그린다(포털은 이 시험 환경에 없다). 누름이 부른 동작은 기록 동작 묶음에 남는다.
// 이 시험이 쓰는 전역 설정은 connection-service-card.test.tsx와 같다(끝나면 되돌린다).

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

/** 동작 묶음과 그 기록. 화면이 부른 동작을 `calls`에 받은 순서대로 쌓는다 */
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
  };
  return { actions, calls };
}

/** 클립보드에 쓴 글을 모은다 */
function copyRecorder(): { readonly copy: (text: string) => void; readonly texts: string[] } {
  const texts: string[] = [];
  return {
    copy: (text) => {
      texts.push(text);
    },
    texts,
  };
}

/** 시험의 실행 중 상태. 접속 주소는 https 두 호스트 대신 한 호스트와 루프백 하나다 */
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
const TABLET: RemoteDevice = {
  id: "d3",
  name: "Tablet",
  kind: "web",
  createdAt: FAKE_NOW - 300_000,
  lastSeenAt: null,
  address: "10.0.0.5",
};

const READY: RemoteScreenState = {
  status: { kind: "ready", value: RUNNING },
  devices: { kind: "ready", value: [] },
  pairing: { kind: "none" },
  confirmOpen: false,
  busy: "none",
  notice: null,
};

function stateWith(patch: Partial<RemoteScreenState>): RemoteScreenState {
  return { ...READY, ...patch };
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
async function mount(props: Partial<ServerModeSectionProps> = {}): Promise<{
  readonly container: HTMLElement;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<ServerModeSection {...baseProps(props)} />);
  });
  mounted.push(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  return { container };
}

function baseProps(props: Partial<ServerModeSectionProps>): ServerModeSectionProps {
  return {
    state: READY,
    serviceRunning: false,
    nowMs: FAKE_NOW,
    locale: "ko",
    actions: recorder().actions,
    copy: () => {},
    inline: true,
    ...props,
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
  const found = buttonsNamed(container, text)[0];
  if (found === undefined) throw new Error(`no button named ${text}`);
  return found;
}

/** 라디오의 글은 감싸는 `label`에 있다(단추 자체는 비어 있다). 그 글이 맞는 라디오를 고른다 */
function radioNamed(container: Element, text: string): Element {
  const found = Array.from(container.querySelectorAll('[role="radio"]')).find((radio) => {
    const label = radio.closest("label");
    return label !== null && label.textContent.trim() === text;
  });
  if (found === undefined) throw new Error(`no radio named ${text}`);
  return found;
}

/** 열린 대화 상자의 글. 제자리에 그린 상자(inline) 하나를 읽는다 */
function dialogTextOf(container: Element): string {
  const dialog = container.querySelector('[role="alertdialog"], [role="dialog"]');
  if (dialog === null) throw new Error("no dialog is open");
  return dialog.textContent;
}

async function press(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function textOf(container: Element): string {
  return container.textContent;
}

describe("ServerModeSection modes", () => {
  test("off: the Off radio is checked and no status rows or pairing show", async () => {
    const view = await mount({
      state: stateWith({ status: { kind: "ready", value: FAKE_OFF_STATUS } }),
      serviceRunning: false,
    });
    expect(radioNamed(view.container, "끄기").getAttribute("aria-checked")).toBe("true");
    expect(radioNamed(view.container, "서비스").getAttribute("aria-checked")).toBe("false");
    expect(textOf(view.container)).not.toContain("접속 주소");
    expect(textOf(view.container)).not.toContain("페어링 코드 만들기");
  });

  test("service: with the engine running and external access off, the Service radio is checked", async () => {
    const view = await mount({
      state: stateWith({ status: { kind: "ready", value: FAKE_OFF_STATUS } }),
      serviceRunning: true,
    });
    expect(radioNamed(view.container, "서비스").getAttribute("aria-checked")).toBe("true");
    expect(radioNamed(view.container, "끄기").getAttribute("aria-checked")).toBe("false");
  });

  test("service plus remote: URLs, fingerprint, certificate, push and devices show", async () => {
    const view = await mount({
      state: stateWith({
        devices: { kind: "ready", value: [TABLET, PHONE, LAPTOP] },
      }),
      serviceRunning: true,
    });
    const text = textOf(view.container);
    expect(radioNamed(view.container, "서비스 + 외부 접근").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(text).toContain("https://192.168.0.10:47443");
    expect(text).toContain("http://127.0.0.1:47100");
    expect(text).toContain(FINGERPRINT_TEXT);
    expect(text).toContain("자체 서명");
    // 자체 서명 주소에서는 서비스가 푸시를 보낼 수 있어도 화면은 "꺼져 있어요"로 보인다(브라우저가 구독을 허용하지 않는다)
    expect(text).toContain("이 주소에서는 꺼져 있어요.");
    expect(text).not.toContain("사용 가능");
    // 기기는 최근 연결 순이다: Pixel(방금), Studio(3분 전), Tablet(접속한 적 없음)
    expect(text).toContain("Pixel");
    expect(text).toContain("웹 브라우저 · 방금");
    expect(text).toContain("데스크톱 · 3분 전");
    expect(text).toContain("웹 브라우저 · 접속한 적 없음");
    expect(text).toContain("주소 없음");
    expect(text.indexOf("Pixel")).toBeLessThan(text.indexOf("Studio"));
    expect(text.indexOf("Studio")).toBeLessThan(text.indexOf("Tablet"));
    expect(text).toContain("기기를 잃어버렸다면 바로 폐기해 주세요.");
  });

  test("starting: the status shows 시작하는 중, no fingerprint yet, and no pairing button", async () => {
    const view = await mount({
      state: stateWith({
        status: {
          kind: "ready",
          value: {
            ...RUNNING,
            state: "starting",
            loopbackPort: null,
            tlsPort: null,
            hosts: [],
            fingerprint: null,
            certSource: null,
            pushAvailable: false,
          },
        },
      }),
      serviceRunning: true,
    });
    const text = textOf(view.container);
    expect(text).toContain("시작하는 중");
    expect(text).toContain("생성 전");
    expect(text).toContain("이 주소에서는 꺼져 있어요.");
    expect(text).not.toContain("페어링 코드 만들기");
    expect(text).not.toContain("연결된 기기");
  });

  test("failed with an error message: the message shows in a danger alert and retry calls retryEnable", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({
        status: {
          kind: "ready",
          value: {
            ...RUNNING,
            state: "failed",
            loopbackPort: null,
            tlsPort: null,
            hosts: [],
            fingerprint: null,
            error: { kind: "bind", message: "포트 47443을 열지 못했다." },
          },
        },
      }),
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("포트 47443을 열지 못했다.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(rec.calls).toEqual([{ name: "retryEnable", args: [] }]);
  });
});

describe("ServerModeSection states", () => {
  test("status loading: a skeleton with screen-reader text and no rows", async () => {
    const view = await mount({ state: stateWith({ status: { kind: "loading" } }) });
    const status = view.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("상태를 읽고 있어요.");
    expect(textOf(view.container)).not.toContain("접속 주소");
  });

  test("status failed with the unsupported shape: a calm neutral line and retry calls reloadStatus", async () => {
    const rec = recorder();
    const unsupported: RemoteError = { kind: "unsupported" };
    const view = await mount({
      state: stateWith({ status: { kind: "failed", error: unsupported } }),
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain(
      "이 엔진은 외부 접근을 아직 지원하지 않아요. 끄기와 서비스는 그대로 쓸 수 있어요.",
    );
    expect(textOf(view.container)).not.toContain("외부 접근 상태를 읽지 못했어요.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(rec.calls).toEqual([{ name: "reloadStatus", args: [] }]);
  });

  test("status failed with a message: a danger line that says the status could not be read", async () => {
    const view = await mount({
      state: stateWith({
        status: { kind: "failed", error: { kind: "failed", message: "연결이 끊겼다." } },
      }),
    });
    expect(textOf(view.container)).toContain("외부 접근 상태를 읽지 못했어요.");
    expect(textOf(view.container)).not.toContain("아직 지원하지 않는다");
  });

  test("devices loading: a skeleton with screen-reader text", async () => {
    const view = await mount({
      state: stateWith({ devices: { kind: "loading" } }),
      serviceRunning: true,
    });
    const statuses = Array.from(view.container.querySelectorAll('[role="status"]'));
    expect(statuses.some((el) => el.textContent.includes("기기 목록을 읽고 있어요."))).toBe(true);
  });

  test("devices failed: the line and retry calls reloadDevices", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ devices: { kind: "failed", error: { kind: "failed", message: null } } }),
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("기기 목록을 읽지 못했어요.");
    await press(buttonNamed(view.container, "다시 시도"));
    expect(rec.calls).toEqual([{ name: "reloadDevices", args: [] }]);
  });

  test("devices empty: says no device is paired and offers adding one", async () => {
    const view = await mount({ state: stateWith({ devices: { kind: "ready", value: [] } }) });
    const text = textOf(view.container);
    expect(text).toContain("연결된 기기가 없어요. 페어링 코드로 기기를 추가해요.");
    expect(buttonsNamed(view.container, "모두 폐기")).toHaveLength(0);
  });
});

describe("ServerModeSection pairing", () => {
  test("issued: the code and the remaining time at nowMs (exact M:SS)", async () => {
    const view = await mount({
      state: stateWith({
        pairing: {
          kind: "issued",
          code: { code: "123456", expiresAt: FAKE_NOW + 245_000 },
        },
      }),
    });
    const text = textOf(view.container);
    expect(text).toContain("123456");
    expect(text).toContain("남은 시간 4:05");
  });

  test("issued and expired: 만료됨 and 다시 발급 calls issuePairing", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({
        pairing: { kind: "issued", code: { code: "123456", expiresAt: FAKE_NOW - 1 } },
      }),
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("만료됨");
    expect(textOf(view.container)).not.toContain("남은 시간");
    await press(buttonNamed(view.container, "다시 발급"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });

  test("issuing: a busy button that says 만드는 중", async () => {
    const view = await mount({ state: stateWith({ pairing: { kind: "issuing" } }) });
    expect(textOf(view.container)).toContain("만드는 중");
  });

  test("failed with remote-off: says external access must be on", async () => {
    const view = await mount({
      state: stateWith({ pairing: { kind: "failed", error: { kind: "remote-off" } } }),
    });
    expect(textOf(view.container)).toContain("외부 접근을 켜야 페어링 코드를 만들 수 있어요.");
  });

  test("failed with another error: a generic line and the create button calls issuePairing", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ pairing: { kind: "failed", error: { kind: "bad-reply" } } }),
      actions: rec.actions,
    });
    expect(textOf(view.container)).toContain("페어링 코드를 만들지 못했어요. 다시 해 봐요.");
    await press(buttonNamed(view.container, "페어링 코드 만들기"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });

  test("none: the create button calls issuePairing", async () => {
    const rec = recorder();
    const view = await mount({ actions: rec.actions });
    await press(buttonNamed(view.container, "페어링 코드 만들기"));
    expect(rec.calls).toEqual([{ name: "issuePairing", args: [] }]);
  });
});

describe("ServerModeSection confirm and dialogs", () => {
  test("the enable confirm has the visible warning, the https URL, and the fingerprint, but not the loopback URL", async () => {
    const view = await mount({ state: stateWith({ confirmOpen: true }), serviceRunning: false });
    const text = dialogTextOf(view.container);
    expect(text).toContain("외부 접근 켜기 확인");
    expect(text).toContain("연결을 인증받은 기기는 이 컴퓨터의 계정으로 도구를 실행할 수 있어요.");
    expect(text).toContain("https://192.168.0.10:47443");
    // 루프백 주소는 이 기기 안에서만 쓰므로 확인 글에 없다(본문의 접속 주소 줄에는 있다)
    expect(text).not.toContain("http://127.0.0.1:47100");
    expect(text).toContain(`인증서 지문 ${FINGERPRINT_TEXT}`);
  });

  test("the enable confirm without a fingerprint says the fingerprint is made at first start", async () => {
    const view = await mount({
      state: stateWith({
        confirmOpen: true,
        status: { kind: "ready", value: { ...FAKE_OFF_STATUS } },
      }),
    });
    const text = textOf(view.container);
    expect(text).toContain("지문은 처음 시작할 때 만들어져요.");
    expect(text).toContain("주소는 서비스가 시작한 뒤에 나타나요.");
  });

  test("the confirm button calls only confirmRemote", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ confirmOpen: true }),
      actions: rec.actions,
    });
    await press(buttonNamed(view.container, "외부 접근 켜기"));
    expect(rec.calls).toEqual([{ name: "confirmRemote", args: [] }]);
  });

  test("the cancel button calls only cancelConfirm", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ confirmOpen: true }),
      actions: rec.actions,
    });
    await press(buttonNamed(view.container, "취소"));
    expect(rec.calls).toEqual([{ name: "cancelConfirm", args: [] }]);
  });

  test("a device's 폐기 opens its confirm, and confirming revokes that id only", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ devices: { kind: "ready", value: [PHONE, LAPTOP] } }),
      serviceRunning: true,
      actions: rec.actions,
    });
    // 행의 폐기 단추가 먼저 있고, 열린 대화 상자의 폐기는 문서 끝에 있다
    await press(buttonNamed(view.container, "폐기"));
    expect(textOf(view.container)).toContain("이 기기 폐기 확인");
    expect(textOf(view.container)).toContain("Pixel 기기의 연결을 끊어요.");
    expect(rec.calls).toEqual([]);
    const confirm = buttonsNamed(view.container, "폐기").at(-1);
    if (confirm === undefined) throw new Error("no confirm button");
    await press(confirm);
    expect(rec.calls).toEqual([{ name: "revoke", args: [{ id: "d1" }] }]);
  });

  test("모두 폐기 opens its confirm, and confirming revokes every device", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ devices: { kind: "ready", value: [PHONE, LAPTOP] } }),
      serviceRunning: true,
      actions: rec.actions,
    });
    await press(buttonNamed(view.container, "모두 폐기"));
    expect(textOf(view.container)).toContain("기기 모두 폐기 확인");
    expect(textOf(view.container)).toContain("연결된 기기 2대의 연결을 모두 끊어요.");
    const confirm = buttonsNamed(view.container, "폐기").at(-1);
    if (confirm === undefined) throw new Error("no confirm button");
    await press(confirm);
    expect(rec.calls).toEqual([{ name: "revoke", args: [{ all: true }] }]);
  });
});

describe("ServerModeSection notices and writes", () => {
  test("each notice kind shows its own sentence", async () => {
    const cases: ReadonlyArray<readonly [RemoteScreenState["notice"], string]> = [
      [{ kind: "enableFailed" }, "외부 접근을 켜지 못했어요. 다시 해 봐요."],
      [{ kind: "disableFailed" }, "외부 접근을 끄지 못했어요. 다시 해 봐요."],
      [{ kind: "serviceFailed" }, "서비스를 켜거나 끄지 못했어요. 다시 해 봐요."],
      [{ kind: "revokeFailed" }, "기기를 폐기하지 못했어요. 다시 해 봐요."],
    ];
    // 한 번에 하나씩 올린다. 겹친 `act`는 React의 act 범위를 어긋나게 해 뒤의 시험을 망친다
    await cases.reduce<Promise<void>>(async (previous, [notice, sentence]) => {
      await previous;
      const view = await mount({ state: stateWith({ notice }) });
      expect(textOf(view.container)).toContain(sentence);
    }, Promise.resolve());
  });

  test("clicking a mode radio calls selectMode with that mode and the service state", async () => {
    const rec = recorder();
    const view = await mount({
      state: stateWith({ status: { kind: "ready", value: FAKE_OFF_STATUS } }),
      serviceRunning: true,
      actions: rec.actions,
    });
    await press(radioNamed(view.container, "서비스 + 외부 접근"));
    expect(rec.calls).toEqual([{ name: "selectMode", args: ["service+remote", true] }]);
  });

  test("the mode radios are disabled while a write runs", async () => {
    const view = await mount({ state: stateWith({ busy: "enabling" }) });
    for (const label of ["끄기", "서비스", "서비스 + 외부 접근"]) {
      expect(radioNamed(view.container, label).hasAttribute("disabled")).toBe(true);
    }
  });

  test("copying the first access URL hands its exact text to copy", async () => {
    const copied = copyRecorder();
    const view = await mount({ copy: copied.copy });
    await press(buttonNamed(view.container, "복사"));
    expect(copied.texts).toEqual(["https://192.168.0.10:47443"]);
  });
});

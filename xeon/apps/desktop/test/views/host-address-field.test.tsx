import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { t } from "@fresnel/client/i18n";
import {
  HostAddressField,
  type HostAddressFieldProps,
} from "../../src/views/pages/connection/host-address-field.tsx";
import type {
  HostFieldError,
  HostFormValue,
} from "../../src/views/pages/connection/host-address.ts";

// 추가 칸 그림을 linkedom DOM에 올린다. 칸 글과 미리보기, 방식 라디오, 오류 자리를 값으로 비교한다.
// 한계: react-dom은 DOM이 없는 채로 적재돼서 input 이벤트 지원이 꺼져 있고, linkedom에서는 React의 입력 바뀜을
// 시험 본문에서 보낼 방법이 없다. 그래서 칸에 글을 치는 흐름(붙여넣기로 칸 채우기, 입력할 때 미리보기가 따라오기)은
// 이 시험이 아니라 `host-address.test.ts`의 `fieldsOfAddress`·`composeAddress` 값 시험이 맡는다.
// 방식 고르기(클릭), Enter 제출(폼 submit), 취소, 오류 자리는 여기서 DOM으로 본다.
// 이 시험이 쓰는 전역 설정은 connection-server.test.tsx와 같다(끝나면 되돌린다).

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
    // 라디오 묶음(Radix)은 폼 안에서 `instanceof HTMLFormElement`를 확인한다
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
  // Radix 라디오 묶음은 폼 안에서 숨은 input의 `checked` 설정자를 찾는다. linkedom의 input에는 그 설정자가 없어서
  // 빈 설정자를 채운다. 이 input 종류는 이 시험의 linkedom 창에만 있으므로 되돌리지 않는다
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

const PIN = "ab".repeat(32);

const EMPTY_SSH: HostFormValue = {
  label: "",
  fields: { kind: "ssh", user: "", host: "", port: "", socket: "" },
};

interface Options {
  readonly initial?: HostFormValue;
  readonly errors?: readonly HostFieldError[];
  readonly busy?: boolean;
}

interface Mounted {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly submits: number[];
  readonly cancels: number[];
}

/** 칸 값을 가진 그림. 방식 고르기 클릭이 칸을 바꾸도록 바뀐 값을 다시 넘긴다 */
function Harness({
  initial,
  ...rest
}: Omit<HostAddressFieldProps, "value" | "onChange"> & {
  readonly initial: HostFormValue;
}): ReactNode {
  const [value, setValue] = useState(initial);
  return <HostAddressField {...rest} value={value} onChange={setValue} />;
}

async function mount(options: Options = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const submits: number[] = [];
  const cancels: number[] = [];
  await act(async () => {
    root.render(
      <Harness
        initial={options.initial ?? EMPTY_SSH}
        errors={options.errors ?? []}
        busy={options.busy ?? false}
        onSubmit={() => {
          submits.push(1);
        }}
        onCancel={() => {
          cancels.push(1);
        }}
      />,
    );
  });
  return { container, root, submits, cancels };
}

async function unmount(view: Mounted): Promise<void> {
  await act(async () => {
    view.root.unmount();
  });
}

/** 라벨 글이 맞는 칸(`data-slot="field"`)을 찾는다. 라벨 뒤에는 필수·선택 표시가 붙을 수 있어 앞부분으로 맞춘다 */
function fieldLabeled(container: Element, label: string): Element {
  const found = Array.from(container.querySelectorAll('[data-slot="field"]')).find(
    (field) =>
      field.querySelector('[data-slot="field-label"]')?.textContent.startsWith(label) === true,
  );
  if (found === undefined) throw new Error(`no field labeled ${label}`);
  return found;
}

function inputLabeled(container: Element, label: string): HTMLInputElement {
  const input = fieldLabeled(container, label).querySelector("input");
  if (input === null) throw new Error(`no input in ${label}`);
  return input;
}

/** 연결 방식 고르기 칸의 라디오 하나. 글이 정확히 맞아야 한다 */
function kindRadio(container: Element, text: string): Element {
  const found = Array.from(container.querySelectorAll('[role="radio"]')).find(
    (radio) => radio.textContent.trim() === text,
  );
  if (found === undefined) throw new Error(`no kind radio ${text}`);
  return found;
}

function buttonNamed(container: Element, text: string): Element {
  const found = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent.trim() === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

function previewOf(container: Element): string {
  const preview = container.querySelector('[aria-live="polite"]');
  if (preview === null) throw new Error("no preview");
  return preview.textContent;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

describe("HostAddressField", () => {
  test("칸 값이 있으면 방식 라디오와 칸 글이 그 값을 보인다", async () => {
    const view = await mount({
      initial: {
        label: "",
        fields: { kind: "wss", address: "example.com:9443", pin: PIN },
      },
    });
    expect(kindRadio(view.container, "웹 주소").getAttribute("aria-checked")).toBe("true");
    expect(kindRadio(view.container, "SSH").getAttribute("aria-checked")).toBe("false");
    expect(inputLabeled(view.container, "웹 주소").value).toBe("example.com:9443");
    expect(inputLabeled(view.container, "인증서 지문").value).toBe(PIN);
    await unmount(view);
  });

  test("ssh 칸 값을 조립한 저장될 주소를 미리보기에 보인다", async () => {
    const view = await mount({
      initial: {
        label: "",
        fields: { kind: "ssh", user: "me", host: "box", port: "2222", socket: "/run/x.sock" },
      },
    });
    expect(previewOf(view.container)).toBe("ssh://me@box:2222/run/x.sock");
    await unmount(view);
  });

  test("칸이 비었으면 미리보기에 채우라는 안내가 보인다", async () => {
    const view = await mount();
    expect(previewOf(view.container)).toBe(t("desktop.connection.host.preview.empty"));
    await unmount(view);
  });

  test("방식을 고르면 칸은 그 방식의 빈 칸이 되고 이름 칸은 남는다", async () => {
    const view = await mount({
      initial: {
        label: "운영",
        fields: { kind: "ssh", user: "", host: "box", port: "", socket: "/run/x.sock" },
      },
    });
    await click(kindRadio(view.container, "이 컴퓨터 포트"));
    expect(kindRadio(view.container, "이 컴퓨터 포트").getAttribute("aria-checked")).toBe("true");
    expect(inputLabeled(view.container, "포트").value).toBe("");
    expect(inputLabeled(view.container, "이름").value).toBe("운영");
    expect(previewOf(view.container)).toBe(t("desktop.connection.host.preview.empty"));
    await unmount(view);
  });

  test("이름 칸을 비우면 호스트 이름이 placeholder로 보인다", async () => {
    const view = await mount({
      initial: {
        label: "",
        fields: { kind: "ssh", user: "", host: "box", port: "", socket: "/run/x.sock" },
      },
    });
    expect(inputLabeled(view.container, "이름").getAttribute("placeholder")).toBe("box");
    await unmount(view);
  });

  test("폼을 제출하면(Enter) onSubmit이 한 번 불린다", async () => {
    const view = await mount();
    const form = view.container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(view.submits).toEqual([1]);
    await unmount(view);
  });

  test("취소 단추는 onCancel을 부른다", async () => {
    const view = await mount();
    await click(buttonNamed(view.container, t("desktop.connection.form.discard")));
    expect(view.cancels).toEqual([1]);
    await unmount(view);
  });

  test("칸 오류는 그 칸 아래에 보이고 다른 칸에는 없다", async () => {
    const view = await mount({
      initial: {
        label: "",
        fields: { kind: "ssh", user: "", host: "box", port: "", socket: "run/x.sock" },
      },
      errors: [{ field: "socket", reason: "relative_path" }],
    });
    const error = fieldLabeled(view.container, "서비스 경로").querySelector(
      '[data-slot="field-error"]',
    );
    expect(error?.textContent).toBe(t("desktop.connection.address.relativePath"));
    const hostError = fieldLabeled(view.container, "호스트").querySelector(
      '[data-slot="field-error"]',
    );
    expect(hostError).toBeNull();
    await unmount(view);
  });

  test("칸 밖의 오류(같은 주소)는 미리보기 아래에 보인다", async () => {
    const view = await mount({
      initial: { label: "", fields: { kind: "tcp", port: "7000" } },
      errors: [{ field: "target", reason: "duplicate" }],
    });
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(t("desktop.connection.address.duplicate"));
    await unmount(view);
  });

  test("오류가 없으면 칸 오류 자리가 하나도 없다", async () => {
    const view = await mount({
      initial: { label: "", fields: { kind: "tcp", port: "7000" } },
    });
    expect(view.container.querySelector('[data-slot="field-error"]')).toBeNull();
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    await unmount(view);
  });
});

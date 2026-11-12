import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { SecretKeyStatusResult } from "@fresnel/contracts/wire";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  keyStoreViewOf,
  type KeyStoreView,
  type KeyWhere,
} from "../../src/views/pages/secrets/key-store-model.ts";
import { KeyStoreRow } from "../../src/views/pages/secrets/key-store-row.tsx";

// 열쇠 보관 줄의 선택이 옮기기를 정확한 방식으로 부르는지 본다. 방식 단추를 누르면 `onChoose`가 그 방식으로 한 번 불린다.
// 이미 고른 방식이나 원격(읽기 전용)이면 아무것도 부르지 않는다. linkedom DOM에 올린다(confirm-host-dom.test.tsx와 같은 방식).

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLFormElement",
  "HTMLButtonElement",
  "HTMLInputElement",
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
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBAL_KEYS) {
    Object.defineProperty(globalThis, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
  Object.assign(window, {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    matchMedia: () => ({ matches: false }),
  });
});

afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

/** 가짜 위치. 실제 경로가 아니다 */
const STATUS: SecretKeyStatusResult = {
  source: "keychain",
  in: "keychain",
  filePath: "/fake/fresnel/secrets/age/keys.txt",
  keychainUsable: true,
  fallbackUnconfirmed: false,
  fileMissing: false,
};

function viewOf(remote: boolean): KeyStoreView {
  return keyStoreViewOf({
    read: { kind: "ready", status: STATUS },
    move: { kind: "idle" },
    remote,
    live: true,
  });
}

/** 방식 단추(라디오) 가운데 이름이 맞는 것 */
function choiceOf(container: Element, label: string): Element | null {
  return (
    [...container.querySelectorAll('[role="radio"]')].find((el) =>
      el.textContent.includes(label),
    ) ?? null
  );
}

async function mount(
  view: KeyStoreView,
  onChoose: (to: KeyWhere) => void,
): Promise<{
  readonly container: HTMLElement;
  readonly unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<KeyStoreRow view={view} onChoose={onChoose} />);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

describe("the key store line's choice", () => {
  test("picking the other way calls the choice with that way, once", async () => {
    const chosen: KeyWhere[] = [];
    const mounted = await mount(viewOf(false), (to) => {
      chosen.push(to);
    });
    const file = choiceOf(mounted.container, t("desktop.secrets.keyStore.file"));
    expect(file === null).toBe(false);
    if (file !== null) await click(file);
    expect(chosen).toEqual(["file"]);
    await mounted.unmount();
  });

  test("picking the way that is already chosen calls nothing", async () => {
    const chosen: KeyWhere[] = [];
    const mounted = await mount(viewOf(false), (to) => {
      chosen.push(to);
    });
    const keychain = choiceOf(mounted.container, t("desktop.secrets.keyStore.keychain"));
    expect(keychain === null).toBe(false);
    if (keychain !== null) await click(keychain);
    expect(chosen).toEqual([]);
    await mounted.unmount();
  });

  test("a remote line is read-only: picking the other way calls nothing", async () => {
    const chosen: KeyWhere[] = [];
    const mounted = await mount(viewOf(true), (to) => {
      chosen.push(to);
    });
    const file = choiceOf(mounted.container, t("desktop.secrets.keyStore.file"));
    if (file !== null) await click(file);
    expect(chosen).toEqual([]);
    await mounted.unmount();
  });
});

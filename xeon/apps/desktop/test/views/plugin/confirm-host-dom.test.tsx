import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ConfirmRequest } from "@fresnel/client/views/app";
import { ConfirmHost, createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";

// 확인 줄은 셸 포털에 뜬다. 끝 영역 패널은 문서의 pointerdown으로 "바깥 누름 닫기"를 하므로, 줄 안의 누름이 문서까지 번지면
// 허용을 누르는 순간 패널이 닫히고 열린 확인이 거부로 끝난다(탐구 시작 단추가 아무 일도 안 하던 원인). linkedom DOM에 올려 본다.

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
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

const REQUEST: ConfirmRequest = {
  kind: "command",
  extension: "helm",
  trust: "user",
  action: "/helm",
  label: undefined,
  paramsSummary: 'args="start 부동소수"',
  approval: false,
};

describe("ConfirmHost in a DOM", () => {
  test("a press inside the confirm line does not reach the document", async () => {
    const queue = createConfirmQueue();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ConfirmHost queue={queue} />);
    });
    await act(async () => {
      void queue.request(REQUEST);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // linkedom은 caustic 대화상자의 포털을 그리지 않는다. 줄을 감싼 자리(포털 안 누름이 React 트리로 올라오는 곳)에 직접 누름을 보낸다
    const line = container.querySelector(".contents");
    expect(line === null).toBe(false);
    const reached: string[] = [];
    document.addEventListener("pointerdown", () => reached.push("document"));
    await act(async () => {
      line?.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    });
    expect(reached).toEqual([]);
    await act(async () => root.unmount());
  });
});

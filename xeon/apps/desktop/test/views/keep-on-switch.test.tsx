import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SectionContext } from "../../src/views/pages/connection/connection-sections.ts";
import { KeepOnSection } from "../../src/views/pages/connection/keep-on-section.tsx";
import { contextOf, localState, STOPPED_SERVICE } from "./hero-fixtures.ts";

// "앱을 닫아도 계속 실행" 스위치를 linkedom DOM에서 누른다. 켜기는 컨트롤러 `keepOn(true, 서비스가 도는가)` 뒤 화면 상태를 다시 읽고,
// 끄기는 확인 대화 상자(StopDialog)를 연다(`setStopConfirm(true)`). 전역 설정은 끝나면 되돌린다.

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

/** 구역을 올리고 실행 스위치를 한 번 누른 뒤 내린다 */
async function pressRunSwitch(context: SectionContext): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<KeepOnSection {...context} inline />);
  });
  const label = t("desktop.connection.keepOn.run.label");
  const element = container.querySelector(`[role="switch"][aria-label="${label}"]`);
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

describe("keep-on run switch", () => {
  test("turning on calls keepOn with the service state, then refreshes", async () => {
    const calls: string[] = [];
    await pressRunSwitch(contextOf(calls, { state: localState({ service: STOPPED_SERVICE }) }));
    expect(calls).toEqual(["keepOn:true,false", "refresh"]);
  });

  test("turning off asks first through the stop dialog", async () => {
    const calls: string[] = [];
    await pressRunSwitch(contextOf(calls));
    expect(calls).toEqual(["setStopConfirm:true"]);
  });
});

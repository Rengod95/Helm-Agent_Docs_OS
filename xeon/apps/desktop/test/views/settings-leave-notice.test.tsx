import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useLeaveDiscardNotice } from "../../src/views/pages/settings/settings-leave-notice.ts";

// 설정 화면을 떠날 때 저장하지 않은 초안이 있었으면 한 번 알린다(없으면 알리지 않는다). linkedom DOM에 올려 마운트 해제를 본다.

const GLOBAL_KEYS = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  for (const key of GLOBAL_KEYS) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof GLOBAL_KEYS)[number], unknown> = {
    window,
    document,
    navigator: window.navigator,
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
  for (const [key, descriptor] of saved) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
});

function Probe(props: { readonly count: number; readonly told: number[] }): ReactNode {
  useLeaveDiscardNotice(props.count, (n) => {
    props.told.push(n);
  });
  return null;
}

async function leaveWith(first: number, then: number): Promise<number[]> {
  const told: number[] = [];
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Probe count={first} told={told} />);
  });
  await act(async () => {
    root.render(<Probe count={then} told={told} />);
  });
  await act(async () => {
    root.unmount();
  });
  return told;
}

describe("useLeaveDiscardNotice", () => {
  test("leaving with unsaved drafts tells how many were discarded, using the latest count", async () => {
    expect(await leaveWith(1, 3)).toEqual([3]);
  });

  test("leaving after the drafts were saved or discarded tells nothing", async () => {
    expect(await leaveWith(2, 0)).toEqual([]);
  });
});

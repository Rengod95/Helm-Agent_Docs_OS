import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { VirtualList } from "../../src/views/virtual-list.tsx";

// rtE R-11: 위로 올려 둔 채 다른 대화(첫 행 키가 다른 목록)로 바뀌면 바닥에 다시 붙는다. 같은 대화에서 올려 둔 위치는 건드리지 않는다.
// linkedom에는 레이아웃이 없어 스크롤 영역의 높이는 값으로 정해 준다.

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "Event",
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

function list(keys: readonly string[], ownTailKey: string | null = null) {
  return (
    <VirtualList
      ownTailKey={ownTailKey}
      rows={keys.map((key) => ({ key }))}
      followTail
      label="대화 기록"
      renderRow={(row) => <p>{row.key}</p>}
    />
  );
}

async function scrolledUpThen(
  next: readonly string[],
  ownTailKey: string | null = null,
): Promise<{ top: number; text: string }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(list(["a1", "a2"]));
  });
  const scroller = container.querySelector(".scroller");
  if (scroller === null) throw new Error("scroller missing");
  Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
  await act(async () => {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
  });
  await act(async () => {
    root.render(list(next, ownTailKey));
  });
  const top = scroller.scrollTop;
  const text = container.textContent;
  await act(async () => root.unmount());
  return { top, text };
}

describe("VirtualList follows the tail", () => {
  test("a different list sticks to the bottom again", async () => {
    expect((await scrolledUpThen(["b1", "b2"])).top).toBe(1000);
  });
  test("the same list keeps the position the user scrolled to", async () => {
    const after = await scrolledUpThen(["a1", "a2", "a3"]);
    expect(after.top).toBe(0);
    // 남의 새 출력이면 위치를 지키고 "새 메시지 1" 단추로 알린다
    expect(after.text).toContain("새 메시지 1");
  });
  test("a message I just sent takes the list to the bottom and shows no button", async () => {
    const after = await scrolledUpThen(["a1", "a2", "a3"], "a3");
    expect(after.top).toBe(1000);
    expect(after.text).not.toContain("새 메시지");
  });
});

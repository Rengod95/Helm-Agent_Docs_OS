import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { RadioCardGroup, RadioCardItem } from "../../src/views/pages/connection/radio-card.tsx";

// 3열 선택 카드 그룹을 linkedom DOM에 올린다. 값은 DOM 속성과 `onValueChange` 기록으로 비교한다.
// linkedom은 포커스를 추적하지 않아서, 화살표 키 시험은 `document.activeElement`를 직접 정해 준다(눌린 카드가 포커스라고 본다).
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

/** 지금 포커스된 요소. 화살표 키 시험이 정한다 */
const focus: { current: Element | null } = { current: null };

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
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => focus.current,
  });
});

afterAll(() => {
  Reflect.deleteProperty(document, "activeElement");
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

interface Mounted {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly changes: string[];
}

/** 값을 든 그룹. 고른 값을 다시 넘겨서 다음 키 입력이 지금 고른 카드에서 출발하게 한다 */
function Group({
  initial,
  changes,
}: {
  readonly initial: string;
  readonly changes: string[];
}): ReactNode {
  const [value, setValue] = useState(initial);
  return (
    <RadioCardGroup
      value={value}
      label="연결 방식"
      onValueChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    >
      <RadioCardItem value="a" icon={<span />} title="제목 A" description="설명 A" />
      <RadioCardItem value="b" icon={<span />} title="제목 B" description="설명 B" disabled />
      <RadioCardItem value="c" icon={<span />} title="제목 C" description="설명 C" />
    </RadioCardGroup>
  );
}

/** 카드 세 장을 올린다. `b`가 꺼져 있다. 바뀐 값은 `changes`에 쌓인다 */
async function mountGroup(initial: string): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const changes: string[] = [];
  await act(async () => {
    root.render(<Group initial={initial} changes={changes} />);
  });
  return { container, root, changes };
}

function radioNamed(container: Element, value: string): Element {
  const found = container.querySelector(`[role="radio"][data-value="${value}"]`);
  if (found === null) throw new Error(`no radio ${value}`);
  return found;
}

/** 방향 키를 누른다. 포커스는 `focused`라고 정해 두고 키를 보낸다 */
async function pressKey(focused: Element, key: string): Promise<void> {
  focus.current = focused;
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  await act(async () => {
    focused.dispatchEvent(event);
  });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

describe("RadioCardGroup", () => {
  test("그룹은 라디오 묶음이고 이름은 label이다", async () => {
    const view = await mountGroup("a");
    const group = view.container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("연결 방식");
    await act(async () => {
      view.root.unmount();
    });
  });

  test("고른 카드만 aria-checked가 true다", async () => {
    const view = await mountGroup("c");
    expect(radioNamed(view.container, "a").getAttribute("aria-checked")).toBe("false");
    expect(radioNamed(view.container, "c").getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      view.root.unmount();
    });
  });

  test("카드 글은 제목 다음에 설명이 온다", async () => {
    const view = await mountGroup("a");
    expect(radioNamed(view.container, "a").textContent).toBe("제목 A설명 A");
    await act(async () => {
      view.root.unmount();
    });
  });

  test("오른쪽 화살표는 다음 카드로, 끝에서는 처음 카드로 옮겨 고른다", async () => {
    const view = await mountGroup("a");
    await pressKey(radioNamed(view.container, "a"), "ArrowRight");
    await pressKey(radioNamed(view.container, "c"), "ArrowRight");
    expect(view.changes).toEqual(["c", "a"]);
    await act(async () => {
      view.root.unmount();
    });
  });

  test("왼쪽 화살표는 이전 카드로, 처음에서는 마지막 카드로 옮겨 고른다", async () => {
    const view = await mountGroup("a");
    await pressKey(radioNamed(view.container, "a"), "ArrowLeft");
    expect(view.changes).toEqual(["c"]);
    await act(async () => {
      view.root.unmount();
    });
  });

  test("카드를 누르면 그 카드의 값을 준다", async () => {
    const view = await mountGroup("a");
    await click(radioNamed(view.container, "c"));
    expect(view.changes).toEqual(["c"]);
    await act(async () => {
      view.root.unmount();
    });
  });

  test("꺼진 카드는 누를 수 없다", async () => {
    const view = await mountGroup("a");
    await click(radioNamed(view.container, "b"));
    expect(view.changes).toEqual([]);
    await act(async () => {
      view.root.unmount();
    });
  });
});

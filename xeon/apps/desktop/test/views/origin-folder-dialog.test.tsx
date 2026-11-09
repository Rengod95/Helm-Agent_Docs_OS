import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import {
  OriginFolderDialog,
  type OriginFolderActions,
} from "../../src/views/origin-folder-dialog.tsx";
import type {
  OriginFolderListing,
  OriginFolderState,
} from "../../src/views/origin-folder-picker.ts";

// 서버 폴더 고르기 대화 상자의 그림. 설정은 connection-server.test.tsx와 같다(inline으로 제자리에 그린다).

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

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  await mounted.splice(0).reduce<Promise<void>>(async (previous, unmount) => {
    await previous;
    await unmount();
  }, Promise.resolve());
});

function recorder(): { readonly actions: OriginFolderActions; readonly calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    actions: {
      navigate: (path) => calls.push(["navigate", path]),
      choose: () => calls.push(["choose"]),
      cancel: () => calls.push(["cancel"]),
      retry: () => calls.push(["retry"]),
    },
  };
}

async function mount(state: OriginFolderState, actions: OriginFolderActions): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<OriginFolderDialog state={state} actions={actions} inline />);
  });
  mounted.push(async () => {
    await act(async () => {
      root.unmount();
    });
    // Radix 포커스 범위가 닫을 때 0ms 타이머로 이벤트를 보낸다. 전역을 되돌리기 전에 그 타이머를 지나게 한다
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    container.remove();
  });
  return container;
}

type ReadyListing = Extract<OriginFolderListing, { kind: "ready" }>;

function ready(patch: Partial<Omit<ReadyListing, "kind">> = {}): OriginFolderState {
  return {
    open: true,
    listing: {
      kind: "ready",
      path: "/srv/work",
      parent: "/srv",
      home: "/srv/me",
      entries: [
        { name: "alpha", path: "/srv/work/alpha" },
        { name: "beta", path: "/srv/work/beta" },
      ],
      truncated: false,
      ...patch,
    },
  };
}

function buttonOf(root: HTMLElement, text: string): Element {
  const found = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

describe("서버 폴더 고르기 대화 상자", () => {
  test("목록이 준비되면 경로와 폴더 이름이 보이고 서버 폴더라는 말이 보인다", async () => {
    const root = await mount(ready(), recorder().actions);
    const text = root.textContent;
    expect(text).toContain("서버 폴더 고르기");
    expect(text).toContain("이 기기가 아니라 Fresnel이 실행 중인 서버 컴퓨터의 폴더예요.");
    expect(text).toContain("/srv/work");
    expect(root.querySelectorAll("ul li").length).toBe(2);
    expect([...root.querySelectorAll("ul li")].map((li) => li.textContent.trim())).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("폴더를 누르면 그 경로로, 홈은 null로, 위로는 부모로 간다", async () => {
    const { actions, calls } = recorder();
    const root = await mount(ready(), actions);
    await click(buttonOf(root, "beta"));
    await click(buttonOf(root, "홈"));
    await click(buttonOf(root, "위로"));
    expect(calls).toEqual([
      ["navigate", "/srv/work/beta"],
      ["navigate", null],
      ["navigate", "/srv"],
    ]);
  });

  test("부모가 없으면 위로가 꺼진다", async () => {
    const root = await mount(ready({ parent: null }), recorder().actions);
    expect(buttonOf(root, "위로").hasAttribute("disabled")).toBe(true);
  });

  test("고르기와 취소는 각자의 동작만 부른다", async () => {
    const { actions, calls } = recorder();
    const root = await mount(ready(), actions);
    await click(buttonOf(root, "이 폴더 고르기"));
    await click(buttonOf(root, "취소"));
    expect(calls).toEqual([["choose"], ["cancel"]]);
  });

  test("읽는 중에는 안내 글이 있고 고르기가 꺼진다", async () => {
    const root = await mount(
      { open: true, listing: { kind: "loading", path: null } },
      recorder().actions,
    );
    expect(root.textContent).toContain("폴더 목록을 읽는 중이에요.");
    expect(buttonOf(root, "이 폴더 고르기").hasAttribute("disabled")).toBe(true);
  });

  test("비었으면 하위 폴더가 없다고 알린다", async () => {
    const root = await mount(ready({ entries: [] }), recorder().actions);
    expect(root.textContent).toContain("하위 폴더가 없어요.");
  });

  test("일부만 보이면 경고가 늘 보인다", async () => {
    const root = await mount(ready({ truncated: true }), recorder().actions);
    expect(root.textContent).toContain("폴더가 많아 일부만 보여요.");
  });

  test("실패는 사유별 문장과 다시 시도를 보인다", async () => {
    const { actions, calls } = recorder();
    const root = await mount(
      { open: true, listing: { kind: "failed", reason: "read_failed", path: "/x" } },
      actions,
    );
    expect(root.textContent).toContain("이 폴더를 읽을 수 없어요.");
    await click(buttonOf(root, "다시 시도"));
    expect(calls).toEqual([["retry"]]);
    const other = await mount(
      { open: true, listing: { kind: "failed", reason: "other", path: null } },
      recorder().actions,
    );
    expect(other.textContent).toContain("폴더 목록을 읽지 못했어요.");
  });
});

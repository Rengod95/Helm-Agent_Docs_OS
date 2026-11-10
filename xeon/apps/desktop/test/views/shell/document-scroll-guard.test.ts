import { describe, expect, test } from "bun:test";
import { installDocumentScrollGuard } from "../../../src/views/shell/document-scroll-guard.ts";

// 문서 스크롤 가드는 Document·Window 전체 대신 필요한 면만 받는다. 시험은 그 면을 손으로 쓴 대역으로 채운다.

/** 문서 스크롤 위치(scrollingElement)의 대역 */
function fakeRoot(): { scrollTop: number; scrollLeft: number } {
  return { scrollTop: 0, scrollLeft: 0 };
}

/** 창의 대역. `scroll()`은 스크롤 이벤트가 올라온 것처럼 듣는 함수를 부른다 */
function fakeWindow(): {
  addEventListener(type: "scroll", listener: () => void): void;
  removeEventListener(type: "scroll", listener: () => void): void;
  scroll(): void;
  readonly listeners: Set<() => void>;
} {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    scroll() {
      for (const listener of listeners) listener();
    },
  };
}

describe("installDocumentScrollGuard", () => {
  test("문서가 세로·가로로 움직이면 스크롤 이벤트에서 0으로 되돌린다", () => {
    const root = fakeRoot();
    const win = fakeWindow();
    installDocumentScrollGuard({ scrollingElement: root }, win);
    root.scrollTop = 50;
    root.scrollLeft = 12;
    win.scroll();
    expect(root.scrollTop).toBe(0);
    expect(root.scrollLeft).toBe(0);
  });

  test("0인 채 스크롤 이벤트가 와도 0을 유지하고, 그 뒤의 스크롤도 계속 막는다", () => {
    const root = fakeRoot();
    const win = fakeWindow();
    installDocumentScrollGuard({ scrollingElement: root }, win);
    win.scroll();
    expect(root.scrollTop).toBe(0);
    root.scrollTop = 7;
    win.scroll();
    expect(root.scrollTop).toBe(0);
  });

  test("scrollingElement가 없으면 아무 일도 하지 않는다", () => {
    const win = fakeWindow();
    installDocumentScrollGuard({ scrollingElement: null }, win);
    expect(() => {
      win.scroll();
    }).not.toThrow();
  });

  test("돌려준 함수를 부르면 가드를 떼고, 그 뒤의 스크롤은 되돌리지 않는다", () => {
    const root = fakeRoot();
    const win = fakeWindow();
    const remove = installDocumentScrollGuard({ scrollingElement: root }, win);
    expect(win.listeners.size).toBe(1);
    remove();
    expect(win.listeners.size).toBe(0);
    root.scrollTop = 40;
    win.scroll();
    expect(root.scrollTop).toBe(40);
  });
});

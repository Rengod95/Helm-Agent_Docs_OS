import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { EventId } from "@fresnel/contracts/conversation";
import { createUiStore } from "../../src/state/ui/index.ts";
import { ApprovalQueue } from "../../src/views/approvals.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { approvalRequest, evt, openedHarness, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 응답이 host에 없는 승인(gone)으로 돌아온 카드의 지우기 단추. 누르면 그 승인 id로 dismissApproval이 불린다.
// 클릭은 DOM이 있어야 하므로 linkedom DOM에 올려 본다(item-view.test.tsx와 같은 방식).

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
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

// 다른 시험 파일이 같은 프로세스에서 도므로 올린 전역을 원래대로 돌려 놓는다
afterAll(() => {
  for (const key of GLOBAL_KEYS) {
    const before = saved.get(key);
    if (before === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, before);
  }
});

describe("a gone approval card in the DOM", () => {
  test("the remove button calls dismissApproval with that approval's id, and only that", async () => {
    const h = openedHarness();
    h.store.ingest({ type: "threads", threads: [] });
    h.store.ingest({
      type: "approvals",
      approvals: [{ approvalId: evt(7), seq: 4, request: approvalRequest(thr(1)) }],
    });
    h.store.flush();
    const ui = createUiStore();
    ui.actions.approvalFailed(evt(7), "gone");
    const dismissed: EventId[] = [];
    const commands = fakeCommands({
      dismissApproval: (approvalId) => {
        dismissed.push(approvalId);
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Providers engine={h.store.read} ui={ui.read} commands={commands}>
          <ApprovalQueue />
        </Providers>,
      );
    });
    expect(container.querySelector('[data-failure="gone"]')?.textContent).toContain(
      "더 이상 답할 수 없어요",
    );
    const remove = container.querySelector('[data-action="dismiss"]');
    expect(remove?.textContent).toBe("지우기");
    expect(dismissed).toEqual([]);
    await act(async () => {
      remove?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(dismissed).toEqual([evt(7)]);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

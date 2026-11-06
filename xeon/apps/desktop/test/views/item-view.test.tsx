import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { parseHTML } from "linkedom";
import { renderToString } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { RecordedItem, StreamingRow } from "../../src/views/item-view.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { SUB, delta, itm, openedHarness, recorded, thr, userItem } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 트랜스크립트 한 행의 그림(시안 _chat-rt ItemView). 사용자 글은 말풍선, 어시스턴트 글은 말풍선 없는 글이고
// 역할 이름은 적지 않는다. 도구 결과는 접혀 있고 실패했을 때만 펼쳐진다. 쓰는 중인 글은 파트마다 따로 갱신된다.

type Harness = ReturnType<typeof openedHarness>;

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

/** 지금 스토어 상태로 그린 글 */
function render(node: ReactNode, h: Harness): string {
  return renderToString(
    <Providers
      engine={frozen(h.store.read.getState())}
      ui={createUiStore().read}
      commands={fakeCommands()}
    >
      {node}
    </Providers>,
  );
}

/** 태그와 주석을 떼고 화면에 보이는 글만 남긴다 */
function visibleText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
}

function ingestRecords(h: Harness, records: readonly ItemRecord[]): void {
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 5 + records.length,
    caughtUp: true,
    facts: records.map((record, i) => recorded(6 + i, record)),
  });
  h.store.flush();
}

function assistantItem(n: number, text: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    },
  };
}

function toolResultItem(n: number, toolName: string, text: string, isError: boolean): ItemRecord {
  return {
    itemId: itm(n),
    status: isError ? "failed" : "completed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: `call-${n}`,
      toolName,
      content: [{ type: "text", text }],
      isError,
      timestamp: 0,
    },
  };
}

describe("user and assistant text", () => {
  test("a user message is a bubble with its text and no role label", () => {
    const h = openedHarness();
    ingestRecords(h, [userItem(1, "첫 줄\n둘째 줄")]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(visibleText(html)).toBe("첫 줄\n둘째 줄");
    expect(html).toContain('data-author="user"');
  });

  test("an assistant text is plain prose with no label and no bubble", () => {
    const h = openedHarness();
    ingestRecords(h, [assistantItem(1, "좋아요.\n다음 단계로 갈게요.")]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(visibleText(html)).toBe("좋아요.\n다음 단계로 갈게요.");
    expect(html).not.toContain('data-author="user"');
  });
});

function callingAssistant(n: number, callId: string): ItemRecord {
  const base = assistantItem(n, "");
  if (base.kind !== "assistant") throw new Error("assistantItem builds an assistant item");
  return {
    ...base,
    message: {
      ...base.message,
      content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: "a.ts" } }],
      stopReason: "toolUse",
    },
  };
}

describe("one row per tool call while it runs", () => {
  test("the running execution item draws nothing once the recorded call row is on screen", () => {
    const h = openedHarness();
    ingestRecords(h, [callingAssistant(1, "call-8")]);
    h.store.ingest({
      type: "chunk",
      fact: {
        type: "item.started",
        n: 1,
        threadId: thr(1),
        turnId: null,
        payload: { itemId: itm(8), kind: "toolCall", toolCallId: "call-8", toolName: "read" },
      },
    });
    h.store.flush();
    expect(render(<StreamingRow id={itm(8)} />, h)).toBe("");
    expect(visibleText(render(<RecordedItem id={itm(1)} />, h))).toContain("read");
  });
});

describe("tool results", () => {
  test("a successful result is collapsed by default and its output is not drawn", () => {
    const h = openedHarness();
    ingestRecords(h, [toolResultItem(1, "read", "file body", false)]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("file body");
    expect(visibleText(html)).toBe("read");
  });

  test("a failed result is expanded, shows its error text, and says failed once", () => {
    const h = openedHarness();
    ingestRecords(h, [toolResultItem(1, "bash", "exit 1: boom", true)]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(html).toContain('aria-expanded="true"');
    expect(visibleText(html)).toContain("exit 1: boom");
    const failedWord = t("desktop.item.status.failed");
    expect(visibleText(html).split(failedWord)).toHaveLength(2);
  });
});

function callItem(n: number, resultN: number, name: string): ItemRecord {
  const base = assistantItem(n, "");
  if (base.kind !== "assistant") throw new Error("assistantItem must build an assistant item");
  return {
    ...base,
    message: {
      ...base.message,
      content: [{ type: "toolCall", id: `call-${resultN}`, name, arguments: { path: "a.txt" } }],
      stopReason: "toolUse",
    },
  };
}

describe("one row per tool call", () => {
  test("a denied call shows the denied label on the call row and its result draws nothing", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "bash"),
      toolResultItem(2, "bash", "[fresnel:denied_by_user] The user denied this tool call.", true),
    ]);
    const call = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(call).toContain(t("desktop.item.status.denied"));
    expect(call).toContain(t("desktop.item.denied.body"));
    expect(call).not.toContain("fresnel:denied_by_user");
    expect(call).not.toContain(t("desktop.item.status.failed"));
    expect(render(<RecordedItem id={itm(2)} />, h)).toBe("");
  });

  test("a failed call says failed once with its message and an ok call is not marked failed", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      toolResultItem(2, "read", "[not_found] File not found: missing.txt", true),
      callItem(3, 4, "read"),
      toolResultItem(4, "read", "hello", false),
    ]);
    const failed = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(failed.split(t("desktop.item.status.failed"))).toHaveLength(2);
    expect(failed).toContain("File not found: missing.txt");
    expect(failed).not.toContain("[not_found]");
    const ok = visibleText(render(<RecordedItem id={itm(3)} />, h));
    expect(ok).not.toContain(t("desktop.item.status.failed"));
  });

  test("a call that never got a result in an idle thread is marked interrupted, not done", () => {
    const h = openedHarness();
    ingestRecords(h, [callItem(1, 9, "bash")]);
    const call = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(call).toContain(t("desktop.item.status.interrupted"));
  });
});

function editCallItem(n: number, resultN: number): ItemRecord {
  const base = assistantItem(n, "");
  if (base.kind !== "assistant") throw new Error("assistantItem must build an assistant item");
  return {
    ...base,
    message: {
      ...base.message,
      content: [
        {
          type: "toolCall",
          id: `call-${resultN}`,
          name: "edit",
          arguments: {
            path: "src/a.ts",
            edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
          },
        },
      ],
      stopReason: "toolUse",
    },
  };
}

describe("edit and write rows", () => {
  test("an edit row with a done result shows its path as the detail and draws neither the args JSON nor the diff while folded", () => {
    const h = openedHarness();
    ingestRecords(h, [
      editCallItem(1, 2),
      toolResultItem(2, "edit", "Successfully replaced text in src/a.ts.", false),
    ]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(html).toMatch(/data-slot="tool-call-detail"[^>]*>src\/a\.ts</);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("oldText");
    expect(html).not.toContain("const a = 2;");
  });
});

describe("an expanded edit row in the DOM", () => {
  const GLOBAL_KEYS = [
    "window",
    "document",
    "navigator",
    "Node",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  // 펼치기는 클릭이라 DOM이 있어야 한다. 서버 렌더는 접힌 본문을 그리지 않으므로 linkedom DOM에 올려 본다
  beforeAll(() => {
    const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
    const values: Record<(typeof GLOBAL_KEYS)[number], unknown> = {
      window,
      document,
      navigator: window.navigator,
      Node: window.Node,
      HTMLElement: window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const key of GLOBAL_KEYS) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
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

  test("clicking the row shows the diff lines above the result text, and no args JSON", async () => {
    const h = openedHarness();
    ingestRecords(h, [
      editCallItem(1, 2),
      toolResultItem(2, "edit", "Successfully replaced text in src/a.ts.", false),
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Providers
          engine={frozen(h.store.read.getState())}
          ui={createUiStore().read}
          commands={fakeCommands()}
        >
          <RecordedItem id={itm(1)} />
        </Providers>,
      );
    });
    const header = container.querySelector('[data-slot="tool-call-header"]');
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      header?.dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    const body = container.querySelector('[data-slot="tool-call-body"]')?.textContent ?? "";
    expect(body).toContain("const a = 1;");
    expect(body).toContain("const a = 2;");
    expect(body).toContain("Successfully replaced text in src/a.ts.");
    expect(body).not.toContain("oldText");
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("streaming rows", () => {
  test("a streamed text part shows its latest text while the message is busy", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "chunk",
      fact: {
        type: "item.started",
        n: 1,
        threadId: thr(1),
        turnId: null,
        payload: { itemId: itm(7), kind: "assistant", toolCallId: null, toolName: null },
      },
    });
    h.store.ingest({ type: "chunk", fact: delta(2, "안녕", 7) });
    h.store.flush();
    expect(visibleText(render(<StreamingRow id={itm(7)} />, h))).toBe("안녕");

    h.store.ingest({ type: "chunk", fact: delta(3, "하세요", 7) });
    h.store.flush();
    const html = render(<StreamingRow id={itm(7)} />, h);
    expect(visibleText(html)).toBe("안녕하세요");
    expect(html).toContain('aria-busy="true"');
  });

  test("a streaming tool call is a running tool row with its streamed arguments", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "chunk",
      fact: {
        type: "item.started",
        n: 1,
        threadId: thr(1),
        turnId: null,
        payload: {
          itemId: itm(8),
          kind: "toolCall",
          toolCallId: "call-8",
          toolName: "read",
        },
      },
    });
    h.store.ingest({ type: "chunk", fact: delta(2, "src/mai", 8) });
    h.store.flush();
    const html = render(<StreamingRow id={itm(8)} />, h);
    expect(html).toContain('data-status="running"');
    expect(visibleText(html)).toContain("read");
    expect(visibleText(html)).toContain("src/mai");
    expect(visibleText(html)).toContain(t("desktop.item.toolRunning"));
  });
});

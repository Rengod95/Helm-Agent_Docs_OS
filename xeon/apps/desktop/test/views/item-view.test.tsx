import { NOT_STARTED_TEXT, OUTCOME_UNKNOWN_TEXT } from "@fresnel/contracts/records";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord, JsonObject } from "@fresnel/contracts/conversation";
import { parseHTML } from "linkedom";
import { renderToString } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { OpenExtensionRecordsContext } from "../../src/views/extension-records-link.ts";
import { RecordedItem, StreamingRow } from "../../src/views/item-view.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { setTranscriptDetailValue } from "../../src/views/transcript-detail.ts";
import { emptyPluginUi } from "./plugin/support.tsx";
import {
  SUB,
  approvalRequest,
  delta,
  evt,
  itm,
  summary,
  openedHarness,
  recorded,
  thr,
  userItem,
} from "../state/helpers.ts";
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

/** MCP 도구의 결과: `details`에 서버 이름을 싣는다(cap-mcp `toToolResult`) */
function mcpResultItem(n: number, toolName: string, server: string): ItemRecord {
  const base = toolResultItem(n, toolName, "hi", false);
  if (base.kind !== "toolResult") throw new Error("toolResultItem must build a tool result");
  return { ...base, message: { ...base.message, details: { server, tool: toolName } } };
}

function toolResultItem(
  n: number,
  toolName: string,
  text: string,
  isError: boolean,
  details?: JsonObject,
): ItemRecord {
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
      ...(details === undefined ? {} : { details }),
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

describe("MCP server chip on a tool row", () => {
  test("a result that names its MCP server shows the server name on the row", () => {
    const h = openedHarness();
    ingestRecords(h, [mcpResultItem(1, "echo", "qa")]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(visibleText(html)).toContain("서버 qa");
  });

  test("a result without a server name shows no server chip", () => {
    const h = openedHarness();
    ingestRecords(h, [toolResultItem(1, "read", "file body", false)]);
    const html = render(<RecordedItem id={itm(1)} />, h);
    expect(visibleText(html)).not.toContain("서버 ");
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
      toolResultItem(2, "bash", "The user denied this tool call.", true, {
        code: "denied_by_user",
      }),
    ]);
    const call = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(call).toContain(t("desktop.item.status.denied"));
    expect(call).toContain(t("desktop.item.denied.body"));
    expect(call).not.toContain("denied_by_user");
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

  test("a running call that waits for approval says so and counts no seconds", () => {
    const h = openedHarness();
    // 실행 중이라고 말하려면 엔진이 돌고 있어야 한다(`engineGoneOf`). 엔진이 없으면 도구 행은 "중단됨"이다
    h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
    ingestRecords(h, [callItem(1, 9, "bash"), callItem(2, 10, "bash")]);
    h.store.ingest({ type: "threads", threads: [summary(thr(1), { status: "running" })] });
    const request = approvalRequest(thr(1));
    h.store.ingest({
      type: "approvals",
      approvals: [
        {
          approvalId: evt(7),
          seq: 4,
          request: { ...request, origin: { ...request.origin, toolCallId: "call-9" } },
        },
      ],
    });
    h.store.flush();
    const waiting = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(waiting).toContain(t("desktop.item.toolAwaitingApproval"));
    expect(waiting).not.toContain(t("desktop.item.toolRunning"));
    const other = visibleText(render(<RecordedItem id={itm(2)} />, h));
    expect(other).not.toContain(t("desktop.item.toolAwaitingApproval"));
  });

  test("a call queued behind an earlier call's approval in the same message waits for approval too, and a call in another message does not", () => {
    const h = openedHarness();
    h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
    const base = assistantItem(1, "");
    if (base.kind !== "assistant") throw new Error("assistantItem must build an assistant item");
    const twoCalls: ItemRecord = {
      ...base,
      message: {
        ...base.message,
        content: [
          { type: "toolCall", id: "call-a", name: "echo", arguments: { text: "a" } },
          { type: "toolCall", id: "call-b", name: "write_note", arguments: { text: "b" } },
        ],
        stopReason: "toolUse",
      },
    };
    ingestRecords(h, [twoCalls, callItem(2, 10, "bash")]);
    h.store.ingest({ type: "threads", threads: [summary(thr(1), { status: "running" })] });
    const request = approvalRequest(thr(1));
    h.store.ingest({
      type: "approvals",
      approvals: [
        {
          approvalId: evt(7),
          seq: 4,
          request: { ...request, origin: { ...request.origin, toolCallId: "call-a" } },
        },
      ],
    });
    h.store.flush();
    const waiting = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(waiting.split(t("desktop.item.toolAwaitingApproval"))).toHaveLength(3);
    expect(waiting).not.toContain(t("desktop.item.toolRunning"));
    const other = visibleText(render(<RecordedItem id={itm(2)} />, h));
    expect(other).not.toContain(t("desktop.item.toolAwaitingApproval"));
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
    expect(html).toMatch(/data-slot="tool-call-detail"[^>]*>(?:<[^>]+>)*src\/a\.ts</);
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

function renderWithPlugin(node: ReactNode, h: Harness): string {
  return render(<PluginUiProvider value={emptyPluginUi()}>{node}</PluginUiProvider>, h);
}

function agentCall(n: number, resultN: number): ItemRecord {
  const base = callItem(n, resultN, "agent");
  if (base.kind !== "assistant") throw new Error("assistant item expected");
  return {
    ...base,
    message: {
      ...base.message,
      content: [
        {
          type: "toolCall",
          id: `call-${resultN}`,
          name: "agent",
          arguments: { agent: "explore", task: "이 폴더를 조사해" },
        },
      ],
    },
  };
}

function agentResult(n: number, text: string, status: string, isError: boolean): ItemRecord {
  const base = toolResultItem(n, "agent", text, isError);
  if (base.kind !== "toolResult") throw new Error("toolResult item expected");
  return {
    ...base,
    message: { ...base.message, details: { childThreadId: "thr_child", status } },
  };
}

describe("agent row", () => {
  test("shows the definition name and task as the head and the child report as the result", () => {
    const h = openedHarness();
    ingestRecords(h, [
      agentCall(1, 2),
      agentResult(2, "폴더에는 파일 3개가 있어요.", "completed", false),
    ]);
    const text = visibleText(renderWithPlugin(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain("explore · 이 폴더를 조사해");
    expect(text).toContain("폴더에는 파일 3개가 있어요.");
    expect(text).not.toContain('"agent"');
  });

  test("a stopped subagent says interrupted, not failed", () => {
    const h = openedHarness();
    ingestRecords(h, [
      agentCall(1, 2),
      agentResult(2, "[fresnel:aborted] Subagent aborted", "aborted", true),
    ]);
    const text = visibleText(renderWithPlugin(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(t("desktop.item.status.interrupted"));
    expect(text).not.toContain(t("desktop.item.status.failed"));
    expect(text).not.toContain("Subagent aborted");
  });

  test("an errored subagent says failed with the reason", () => {
    const h = openedHarness();
    ingestRecords(h, [
      agentCall(1, 2),
      agentResult(2, "[fresnel:subagent_error] boom", "error", true),
    ]);
    const text = visibleText(renderWithPlugin(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(t("desktop.item.status.failed"));
    expect(text).toContain("boom");
  });
});

describe("web source chips", () => {
  test("a web_search result draws a chip per source with the domain and title", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "web_search"),
      toolResultItem(
        2,
        "web_search",
        "[s1] Bun (2025-04-30) https://bun.sh/docs\n[s2] Node https://nodejs.org",
        false,
      ),
    ]);
    const html = renderWithPlugin(<RecordedItem id={itm(1)} />, h);
    const text = visibleText(html);
    expect(text).toContain("bun.sh · Bun");
    expect(text).toContain("nodejs.org · Node");
  });

  test("an answer with a link draws a chip for it", () => {
    const h = openedHarness();
    ingestRecords(h, [assistantItem(1, "자세한 것은 https://bun.sh/docs 를 보세요")]);
    const text = visibleText(renderWithPlugin(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain("bun.sh");
  });
});

describe("engine failure texts are shown in Korean (rtE R-10)", () => {
  test("a plan-mode-inactive result shows the catalog sentence, not the English one", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "exit_plan_mode"),
      toolResultItem(2, "exit_plan_mode", "Plan mode is not active.", true),
    ]);
    const text = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(t("desktop.item.planInactive.body"));
    expect(text).not.toContain("Plan mode is not active.");
  });

  test('an interrupted bash result with the body "aborted" shows the catalog sentence', () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "bash"),
      { ...toolResultItem(2, "bash", "aborted", true), status: "interrupted" },
    ]);
    const text = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(t("desktop.item.interrupted.body"));
    expect(text).toContain(t("desktop.item.status.interrupted"));
    expect(text).not.toContain("aborted");
  });

  test("the recovery sentences the engine records are shown in the catalog language, not in English", () => {
    const cases: readonly [string, string][] = [
      [OUTCOME_UNKNOWN_TEXT, t("desktop.item.interrupted.unknown")],
      [NOT_STARTED_TEXT, t("desktop.item.interrupted.notStarted")],
    ];
    for (const [recorded, shown] of cases) {
      const h = openedHarness();
      ingestRecords(h, [
        callItem(1, 2, "bash"),
        { ...toolResultItem(2, "bash", recorded, true), status: "interrupted" },
      ]);
      const text = visibleText(render(<RecordedItem id={itm(1)} />, h));
      expect(text).toContain(shown);
      expect(text).not.toContain("The tool call was interrupted");
    }
  });
});

/** 훅이 막은 호출의 결과 item. 모델에 가는 본문은 `[fresnel:denied_by_extension] …`이고 화면은 details를 읽는다 */
function hookResultItem(n: number, text: string, details: JsonObject): ItemRecord {
  return {
    itemId: itm(n),
    status: "failed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: `call-${n}`,
      toolName: "read",
      content: [{ type: "text", text }],
      details,
      isError: true,
      timestamp: 0,
    },
  };
}

/** 기록 보기 문맥을 준 채 그린다. 누르면 이름을 받는 자리만 있으면 된다 */
function renderWithRecords(node: ReactNode, h: Harness): string {
  return render(
    <OpenExtensionRecordsContext value={() => {}}>{node}</OpenExtensionRecordsContext>,
    h,
  );
}

describe("a hook that stopped a call says which hook and whether it blocked or threw", () => {
  const blocked: JsonObject = {
    code: "denied_by_extension",
    hook: "tool.call.before",
    extension: "guard",
    outcome: "blocked",
    reason: "no reads today",
  };
  const threw: JsonObject = {
    code: "denied_by_extension",
    hook: "tool.call.before",
    extension: "bad-guard",
    outcome: "threw",
    reason: null,
  };

  test("a blocked call shows the hook's blocking reason and the blocked label, not the failed label", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] no reads today", blocked),
    ]);
    const text = visibleText(render(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(
      t("desktop.item.hookDenial.blocked", { extension: "guard", reason: "no reads today" }),
    );
    expect(text).toContain(t("desktop.item.status.hookBlocked"));
    expect(text).not.toContain(t("desktop.item.status.failed"));
    expect(text).not.toContain("fresnel:denied_by_extension");
  });

  test("a threw call shows the error sentence and the records link when a records handler is given", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] extension handler failed", threw),
    ]);
    const html = renderWithRecords(<RecordedItem id={itm(1)} />, h);
    const text = visibleText(html);
    expect(text).toContain(t("desktop.item.hookDenial.threw", { extension: "bad-guard" }));
    expect(text).toContain(t("desktop.item.status.hookThrew"));
    expect(text).not.toContain(t("desktop.item.status.failed"));
    expect(text).toContain(t("desktop.item.hookDenial.records"));
  });

  test("a threw call has no records link without a records handler, and a blocked call never has one", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] extension handler failed", threw),
    ]);
    expect(visibleText(render(<RecordedItem id={itm(1)} />, h))).not.toContain(
      t("desktop.item.hookDenial.records"),
    );
    const other = openedHarness();
    ingestRecords(other, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] no reads today", blocked),
    ]);
    expect(visibleText(renderWithRecords(<RecordedItem id={itm(1)} />, other))).not.toContain(
      t("desktop.item.hookDenial.records"),
    );
  });

  test("a dispatcher failure with no extension name says a hook hit an error and offers no link", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] extension handler failed", {
        code: "denied_by_extension",
        hook: "tool.call.before",
        extension: null,
        outcome: "threw",
        reason: null,
      }),
    ]);
    const text = visibleText(renderWithRecords(<RecordedItem id={itm(1)} />, h));
    expect(text).toContain(t("desktop.item.hookDenial.threwNoName"));
    expect(text).not.toContain(t("desktop.item.hookDenial.records"));
  });

  test("the hook chip is warning-toned and an ordinary failure chip is danger-toned, neither row has a coloured border", () => {
    const h = openedHarness();
    ingestRecords(h, [
      callItem(1, 2, "read"),
      hookResultItem(2, "[fresnel:denied_by_extension] no reads today", blocked),
    ]);
    const hooked = render(<RecordedItem id={itm(1)} />, h);
    expect(hooked).toContain('data-slot="call-chip" data-status="failed" data-tone="warning"');
    expect(hooked).not.toContain("warning-border");

    const plain = openedHarness();
    ingestRecords(plain, [callItem(1, 2, "read"), toolResultItem(2, "read", "boom", true)]);
    const failed = render(<RecordedItem id={itm(1)} />, plain);
    expect(failed).toContain('data-slot="call-chip" data-status="failed" data-tone="danger"');
    expect(failed).not.toContain("warning");
  });
});

/** 생각 블록만 있는 어시스턴트 item */
function thinkingItem(n: number, thinking: string): ItemRecord {
  const base = assistantItem(n, "");
  if (base.kind !== "assistant") throw new Error("assistantItem must build an assistant item");
  return { ...base, message: { ...base.message, content: [{ type: "thinking", thinking }] } };
}

describe("transcript detail setting", () => {
  afterEach(() => {
    setTranscriptDetailValue("full");
  });

  test("full draws the thinking open, and summary folds it to its toggle", () => {
    const h = openedHarness();
    ingestRecords(h, [thinkingItem(1, "조용히 따져 본다")]);
    expect(visibleText(render(<RecordedItem id={itm(1)} />, h))).toContain("조용히 따져 본다");

    setTranscriptDetailValue("summary");
    const folded = render(<RecordedItem id={itm(1)} />, h);
    expect(folded).toContain('aria-expanded="false"');
    expect(visibleText(folded)).not.toContain("조용히 따져 본다");
    expect(visibleText(folded)).toContain(t("desktop.item.thinking"));
  });

  test("hidden draws no thinking and no done tool row, but keeps a failed one", () => {
    const h = openedHarness();
    ingestRecords(h, [
      thinkingItem(1, "숨길 생각"),
      callItem(2, 3, "read"),
      toolResultItem(3, "read", "file body", false),
      callItem(4, 5, "bash"),
      toolResultItem(5, "bash", "exit 1: boom", true),
    ]);
    setTranscriptDetailValue("hidden");
    expect(visibleText(render(<RecordedItem id={itm(1)} />, h))).toBe("");
    expect(visibleText(render(<RecordedItem id={itm(2)} />, h))).toBe("");
    expect(visibleText(render(<RecordedItem id={itm(4)} />, h))).toContain("exit 1: boom");
  });
});

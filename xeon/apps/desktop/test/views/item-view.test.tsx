import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
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

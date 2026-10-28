import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@xeon/contracts/conversation";
import { renderToString } from "react-dom/server";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { RecordedItem } from "../../src/views/item-view.tsx";
import { Transcript } from "../../src/views/transcript.tsx";
import { SUB, evt, itm, openedHarness, recorded, thr, trn } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

function custom(n: number, display: boolean): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType: "x.knowledge.context",
      content: "ctx",
      display,
      details: null,
      timestamp: 0,
    },
  };
}

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function render(node: React.ReactNode, h: ReturnType<typeof openedHarness>): string {
  const ui = createUiStore();
  return renderToString(
    <Providers engine={frozen(h.store.read.getState())} ui={ui.read} commands={fakeCommands()}>
      {node}
    </Providers>,
  );
}

describe("custom items", () => {
  test("display:false is not rendered, display:true is", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 7,
      caughtUp: true,
      facts: [recorded(6, custom(1, false)), recorded(7, custom(2, true))],
    });
    h.store.flush();
    expect(render(<RecordedItem id={itm(1)} />, h)).toBe("");
    expect(render(<RecordedItem id={itm(2)} />, h)).toContain("확장");
  });
});

function assistant(n: number, status: ItemRecord["status"], text: string | null): ItemRecord {
  return {
    itemId: itm(n),
    status,
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: text === null ? [] : [{ type: "text", text }],
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
      stopReason: "error",
      timestamp: 0,
    },
  };
}

function system(n: number): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "system",
    message: {
      role: "system",
      content: "You are Xeon, a helpful coding assistant.",
      timestamp: 0,
    },
  };
}

describe("model-only and failed items", () => {
  test("the system prompt item and an empty failed assistant item are not drawn; a failed one with content is", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 8,
      caughtUp: true,
      facts: [
        recorded(6, system(1)),
        recorded(7, assistant(2, "failed", null)),
        recorded(8, assistant(3, "failed", "partial answer")),
      ],
    });
    h.store.flush();
    expect(render(<RecordedItem id={itm(1)} />, h)).toBe("");
    expect(render(<RecordedItem id={itm(2)} />, h)).toBe("");
    const partial = render(<RecordedItem id={itm(3)} />, h);
    expect(partial).toContain("partial answer");
    expect(partial).toContain("실패");
  });

  test("the failure is drawn once: the alert shows it and the empty failed item does not repeat it", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 7,
      caughtUp: true,
      facts: [
        recorded(6, assistant(2, "failed", null)),
        {
          type: "turn.completed",
          seq: 7,
          eventId: evt(7),
          threadId: thr(1),
          turnId: trn(1),
          at: "t",
          payload: {
            status: "failed",
            stepCount: 0,
            usage: null,
            error:
              "model_unavailable: model_not_found: model anthropic/claude-sonnet-5.5 is not in the catalog",
          },
        },
      ],
    });
    h.store.flush();
    const shown = render(<Transcript />, h);
    expect(shown.match(/role="alert"/g)?.length).toBe(1);
    expect(shown.match(/실패/g)).toBeNull();
    expect(shown).toContain("anthropic/claude-sonnet-5.5 is not in the catalog");
  });
});

describe("turn failure", () => {
  test("a failed turn shows its error in the transcript until the next turn starts", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "turn.completed",
          seq: 6,
          eventId: evt(6),
          threadId: thr(1),
          turnId: trn(1),
          at: "t",
          payload: { status: "failed", stepCount: 0, usage: null, error: "missing api key" },
        },
      ],
    });
    h.store.flush();
    const shown = render(<Transcript />, h);
    expect(shown).toContain("missing api key");
    expect(shown).toContain('role="alert"');
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 6,
      to: 7,
      caughtUp: true,
      facts: [
        {
          type: "turn.started",
          seq: 7,
          eventId: evt(7),
          threadId: thr(1),
          turnId: trn(2),
          at: "t",
        },
      ],
    });
    h.store.flush();
    expect(render(<Transcript />, h)).not.toContain("missing api key");
  });
});

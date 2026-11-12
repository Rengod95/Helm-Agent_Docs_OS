import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { renderToString } from "react-dom/server";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { RecordedItem } from "../../src/views/item-view.tsx";
import { Transcript } from "../../src/views/transcript.tsx";
import { SUB, evt, itm, openedHarness, recorded, thr, trn } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";
import { emptyPluginUi } from "./plugin/support.tsx";

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
  // 빈 대화의 폴더 고르기(DP-70)가 새 대화 흐름을 쓰므로 셸 스토어도 준다
  return renderToString(
    <ShellStoreContext value={createShellStore(1280)}>
      <Providers engine={frozen(h.store.read.getState())} ui={ui.read} commands={fakeCommands()}>
        <PluginUiProvider value={emptyPluginUi()}>{node}</PluginUiProvider>
      </Providers>
    </ShellStoreContext>,
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
    // 카드가 없는 확장 기록은 본문 글을 보인다. 종류 이름과 역할 이름 "확장"은 그리지 않는다
    const html = render(<RecordedItem id={itm(2)} />, h);
    expect(html).toContain("ctx");
    expect(html).not.toContain("x.knowledge.context");
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
      content: "You are Fresnel, a helpful coding assistant.",
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
    // 원문은 "자세히" 뒤에 있고 줄에는 한국어 문장과 모델 바꾸기 단추가 보인다
    expect(shown).toContain("모델을 찾지 못했어요");
    expect(shown).toContain("모델 바꾸기");
    // 원문은 정보 아이콘의 숨은 설명(낭독기용)에만 한 번 있고, 보이는 줄에는 없다
    expect(shown.split("is not in the catalog").length - 1).toBe(1);
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
          payload: { status: "failed", stepCount: 0, usage: null, error: "401 invalid x-api-key" },
        },
      ],
    });
    h.store.flush();
    const shown = render(<Transcript />, h);
    // 제공자가 키를 거절한 줄(401)이고 단추는 키 바꾸기다. 제공자 이름은 대화의 모델에 따라 붙는다
    expect(shown).toContain("이 키를 받지 않았어요(401)");
    expect(shown).toContain("키 바꾸기");
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
    expect(render(<Transcript />, h)).not.toContain("이 키를 받지 않았어요(401)");
  });
});

import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { DurableFact, MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { ThreadList } from "../../src/views/thread-list.tsx";
import { unsentRowOf } from "../../src/views/turn-failure-model.ts";
import { evt, STORE, SUB, summary, thr, trn } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

// 첫 답이 오기 전에 실패한 대화("안녕")와 같은 제목의 정상 대화. 실패는 거울의 turn.completed로 넣는다
function mirror(): EngineMirror {
  const failed: DurableFact = {
    type: "turn.completed",
    seq: 6,
    eventId: evt(6),
    threadId: thr(2),
    turnId: trn(1),
    at: "t",
    payload: { status: "failed", stepCount: 0, usage: null, error: "403 permission_error" },
  };
  const inputs: MirrorInput[] = [
    { type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } },
    { type: "subscribed", sub: SUB, storeId: STORE, start: 5, live: true, from: "head" },
    {
      type: "threads",
      threads: [summary(thr(1), { title: "안녕" }), summary(thr(2), { title: "안녕" })],
    },
    { type: "batch", sub: SUB, from: 5, to: 6, caughtUp: true, facts: [failed] },
  ];
  return inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR);
}

function html(): string {
  const ui = frozen<UiState>(createUiStore().read.getState());
  return renderToString(
    <Providers engine={frozen(mirror())} ui={ui} commands={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1280)}>
        <ThreadList />
      </ShellStoreContext>
    </Providers>,
  );
}

describe("unsent row judgment", () => {
  test("only a failed last turn marks the row, and an unknown failure marks nothing", () => {
    expect(unsentRowOf(null)).toBe(false);
    expect(unsentRowOf("403 permission_error")).toBe(true);
  });
});

describe("sidebar unsent mark", () => {
  test("only the thread whose last turn failed gets the danger status and the secondary word", () => {
    const out = html();
    // 실패한 줄 하나만 실패 상태 점을 단다
    expect(out.match(/data-status="failed"/g)?.length).toBe(1);
    // 보조 글은 줄 오른쪽 글 하나와 상태의 화면 낭독 글, 툴팁 한 번씩이다
    expect(out.match(/보내지 못한 대화/g)?.length).toBe(3);
  });
});

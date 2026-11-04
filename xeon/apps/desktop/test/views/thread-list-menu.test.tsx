import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { ThreadList } from "../../src/views/thread-list.tsx";
import { InboxApprovals } from "../../src/views/approvals.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { harness, summary, thr } from "../state/helpers.ts";

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function mirror(): EngineMirror {
  const h = harness();
  h.store.ingest({
    type: "threads",
    threads: [
      summary(thr(1), { title: "첫 대화" }),
      summary(thr(2), { title: "닫은 대화", status: "closed" }),
    ],
  });
  h.store.flush();
  return h.store.read.getState();
}

function html(node: React.ReactNode): string {
  const ui = frozen<UiState>(createUiStore().read.getState());
  return renderToString(
    <Providers engine={frozen(mirror())} ui={ui} commands={fakeCommands()}>
      {node}
    </Providers>,
  );
}

describe("thread list row menu", () => {
  test("every row has a menu button named after its conversation", () => {
    const out = html(<ThreadList />);
    expect(out).toContain("첫 대화 메뉴");
    expect(out).toContain("닫은 대화 메뉴");
  });
});

describe("inbox notices", () => {
  test("the inbox shows the approvals empty line and the notices section while loading", () => {
    const out = html(<InboxApprovals />);
    expect(out).toContain("기다리는 요청이 없어요");
    expect(out).toContain("알림");
  });
});

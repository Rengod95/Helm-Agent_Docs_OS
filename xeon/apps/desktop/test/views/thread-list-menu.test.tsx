import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { ThreadList } from "../../src/views/thread-list.tsx";
import { InboxApprovals } from "../../src/views/approvals.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { harness, summary, thr } from "../state/helpers.ts";

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

const LONG_TITLE = "긴".repeat(200);

function mirror(): EngineMirror {
  const h = harness();
  h.store.ingest({
    type: "threads",
    threads: [
      summary(thr(1), { title: "첫 대화" }),
      summary(thr(2), { title: "닫은 대화", status: "closed" }),
      summary(thr(3), { title: LONG_TITLE }),
      summary(thr(4), {
        title: "하위 조사",
        spawnedBy: { threadId: thr(1), kind: "subagent" },
      }),
      summary(thr(5), {
        title: "검토 대화",
        spawnedBy: { threadId: thr(1), kind: "internal" },
      }),
    ],
  });
  h.store.flush();
  return h.store.read.getState();
}

function html(node: React.ReactNode): string {
  const ui = frozen<UiState>(createUiStore().read.getState());
  return renderToString(
    <Providers engine={frozen(mirror())} ui={ui} commands={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1280)}>{node}</ShellStoreContext>
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

describe("thread list alignment and search field (DP-136, DP-138)", () => {
  test("the row menu cell rises by the row gap so it shares the row's vertical center and ends 3px in", () => {
    const out = html(<ThreadList />);
    const cell = /<li data-row-menu[^>]*class="([^"]*)"/.exec(out)?.[1]?.split(" ") ?? [];
    expect(
      cell.filter((c) => c.startsWith("-mt-") || c.startsWith("pe-") || c.startsWith("h-")),
    ).toEqual(["-mt-[calc(var(--spacing-control-md)+1px)]", "h-control-md", "pe-0.75"]);
  });

  test("the search field is the 32px md size, like the nav rows", () => {
    const out = html(<ThreadList />);
    const field = /<div data-slot="input" data-size="([a-z]+)"/.exec(out)?.[1];
    expect(field).toBe("md");
  });
});

describe("thread list internal and sub conversations", () => {
  test("the internal conversation is not listed and the sub conversation is marked as one", () => {
    const out = html(<ThreadList />);
    expect(out).not.toContain("검토 대화");
    expect(out).toContain("하위 조사");
    expect(out).toContain("하위</");
  });
});

describe("thread list long titles", () => {
  test("a 200 character title keeps the whole title as tooltip and the list column cannot grow", () => {
    const out = html(<ThreadList />);
    expect(out).toContain(`title="${LONG_TITLE}"`);
    expect(out).toContain("grid-cols-[minmax(0,1fr)]");
    expect(out).toContain("min-w-0 flex-1 truncate");
  });
});

describe("inbox notices", () => {
  test("the inbox shows the approvals empty line and the notices section while loading", () => {
    const out = html(<InboxApprovals />);
    expect(out).toContain("기다리는 요청이 없어요");
    expect(out).toContain("알림");
  });
});

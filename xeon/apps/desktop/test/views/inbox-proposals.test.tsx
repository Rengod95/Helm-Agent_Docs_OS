import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { InboxApprovals, type InboxFilter } from "../../src/views/approvals.tsx";
import { ProposalPendingContext } from "../../src/views/proposal-pending-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 받은 요청의 제안 줄(P-03). 대기 제안이 있고 거르기가 "모두"일 때만 맨 위에 한 줄 선다.
// 수는 문맥으로 준다(연결과 주기 읽기는 서버 렌더가 돌리지 않는다). 문장은 `t()`로 비교한다.

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function emptyMirror(): EngineMirror {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [] });
  h.store.flush();
  return h.store.read.getState();
}

function html(filter: InboxFilter, pending: number): string {
  const node: ReactNode = (
    <Providers engine={frozen(emptyMirror())} ui={createUiStore().read} commands={fakeCommands()}>
      <ProposalPendingContext value={{ count: pending, refresh: () => {} }}>
        <ShellStoreContext value={createShellStore(1400)}>
          <InboxApprovals show={filter} />
        </ShellStoreContext>
      </ProposalPendingContext>
    </Providers>
  );
  return renderToString(node);
}

describe("inbox proposal row", () => {
  test("shows one row with the pending count above the approvals when the filter is all", () => {
    const page = html("all", 3);
    const title = t("desktop.inbox.proposals.waiting", { count: 3 });
    const open = t("desktop.inbox.proposals.open");
    expect(page.split(title).length - 1).toEqual(1);
    expect(page.split(open).length - 1).toEqual(1);
    expect(page.indexOf(title)).toBeLessThan(page.indexOf(t("desktop.approvals.inbox.empty")));
  });

  test("is absent when no proposal is pending", () => {
    const page = html("all", 0);
    expect(page).not.toContain(t("desktop.inbox.proposals.waiting", { count: 0 }));
    expect(page).not.toContain(t("desktop.inbox.proposals.open"));
    expect(page).toContain(t("desktop.approvals.inbox.empty"));
  });

  test("is absent under the approvals and notices filters", () => {
    for (const filter of ["approvals", "notices"] as const) {
      const page = html(filter, 3);
      expect(page).not.toContain(t("desktop.inbox.proposals.waiting", { count: 3 }));
      expect(page).not.toContain(t("desktop.inbox.proposals.open"));
    }
  });
});

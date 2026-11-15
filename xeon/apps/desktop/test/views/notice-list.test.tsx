import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { Notice } from "@fresnel/contracts/capabilities";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createUiStore } from "../../src/state/ui/store.ts";
import { NoticeListView } from "../../src/views/notices.tsx";
import { noticeItemsOf, type NoticeEntry } from "../../src/views/notices-model.ts";
import { Providers } from "../../src/views/providers.tsx";
import { GoToThreadContext } from "../../src/views/thread-link.ts";
import { openedHarness, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 알림 목록(DP-214~216). 서버 렌더로 레일의 줄 모양, 날짜 머리, 할 일 카드의 단추 하나, 더 보기를 값으로 본다.

const NOW = new Date(2026, 10, 15, 15, 0).getTime();
const MIN = 60_000;
const AUTH =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

function entry(
  seq: number,
  kind: Notice["kind"],
  minutesAgo: number,
  body: string | null = null,
): NoticeEntry {
  return {
    notice: {
      kind,
      title: "t",
      body,
      seq,
      sourceType: "turn.completed",
      createdAt: NOW - minutesAgo * MIN,
    },
    threadId: thr(1),
  };
}

function render(entries: readonly NoticeEntry[], shown: number): string {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [summary(thr(1), { title: "결제 모듈" })] });
  h.store.flush();
  const items = noticeItemsOf(entries, {
    now: NOW,
    marks: { read: new Set(), dismissed: new Set() },
    waitingThreads: new Set(),
  });
  const node: ReactNode = (
    <Providers engine={h.store.read} ui={createUiStore().read} commands={fakeCommands()}>
      <GoToThreadContext value={() => {}}>
        <NoticeListView items={items} now={NOW} shown={shown} onMore={() => {}} />
      </GoToThreadContext>
    </Providers>
  );
  return renderToString(node);
}

const shapesOf = (html: string): readonly string[] =>
  [...html.matchAll(/class="notice-rail-row" data-shape="([a-z]+)"/g)].map((m) => m[1] ?? "");

describe("notice list", () => {
  test("hangs day heads, an error card and lines on one rail", () => {
    const html = render(
      [
        entry(5, "error", 2, AUTH),
        entry(4, "error", 3, AUTH),
        entry(3, "completed", 10),
        entry(2, "completed", 60 * 24),
      ],
      20,
    );
    expect(shapesOf(html)).toEqual(["day", "card", "line", "day", "line"]);
    expect([
      html.includes(t("desktop.notices.day.today")),
      html.includes(t("desktop.notices.day.yesterday")),
      html.includes(t("desktop.notices.repeat.error", { count: 2 })),
      html.split(t("desktop.turnFailure.action.changeKey")).length - 1,
      html.split(`aria-label="${t("desktop.notices.dismiss")}"`).length - 1,
      html.includes(t("desktop.notices.more")),
    ]).toEqual([true, true, true, 1, 3, false]);
  });

  test("draws the first page only and offers more at the end", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      entry(100 - i, "completed", i * 2 + 1, `b${i}`),
    );
    const html = render(many, 20);
    expect([
      shapesOf(html).filter((s) => s === "line").length,
      html.includes(t("desktop.notices.more")),
    ]).toEqual([20, true]);
  });
});

import { describe, expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext, type EngineMirror } from "../../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import {
  SAMPLE_PROFILES,
  manyItems,
  sampleItems,
} from "../../../src/views/craft/review/testing/review-samples.ts";
import type { ReviewData, ReviewLoad } from "../../../src/views/craft/review/review-source.ts";
import { ReviewView, type ReviewLayout } from "../../../src/views/craft/review/review-view.tsx";
import { harness } from "../../state/helpers.ts";

// 리뷰 화면 두 판(가: 목록 + 자세히, 나: 펼치는 카드)의 정적 마크업. 낭독기가 읽을 이름과 역할, 늘 보이는 코드 실행 안내,
// 상태(비었음·불러오는 중·실패·끊김·관리자 잠금)를 값으로 본다. 효과는 돌지 않으므로 파일 본문은 읽지 않는다.

function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function dataOf(load: ReviewLoad): ReviewData {
  return {
    load,
    reload: () => undefined,
    file: () => Promise.resolve(err({ kind: "unsupported" })),
    decide: (_itemId, _decision) => Promise.resolve(err({ kind: "offline" })),
  };
}

function ready(
  items: readonly ReviewItem[],
  managedOff: readonly string[] = [],
  offline = false,
): ReviewLoad {
  return {
    status: "ready",
    items,
    profiles: SAMPLE_PROFILES,
    managedOff: new Set(managedOff),
    offline,
  };
}

function render(load: ReviewLoad, layout: ReviewLayout): string {
  const node: ReactNode = (
    <EngineStoreContext value={frozenStore(harness().store.read.getState())}>
      <ShellStoreContext value={createShellStore(1440)}>
        <ReviewView data={dataOf(load)} layout={layout} />
      </ShellStoreContext>
    </EngineStoreContext>
  );
  return renderToString(node);
}

/** 정적 마크업에서 태그 하나의 속성 값들(순서대로) */
function attrs(html: string, name: string): readonly string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");
}

/** 결정한 뒤의 같은 항목(새 값) */
function approvedCopy(item: ReviewItem): ReviewItem {
  return { ...item, state: "approved" };
}

const ITEMS = sampleItems();
const PENDING = ITEMS.filter((item) => item.state === "pending").length;
const LINT = ITEMS.filter((item) => item.itemId === "rvw_sample_lint");

describe("layout A: list beside the detail", () => {
  const html = render(ready(ITEMS), "split");

  test("the list is a named navigation with one current row per pending item", () => {
    expect(html).toContain('aria-label="기다리는 리뷰"');
    expect(attrs(html, "aria-current").filter((v) => v === "page")).toEqual(["page"]);
    expect(html.match(/data-review-row=/g)?.length ?? 0).toBe(PENDING);
  });

  test("a code plugin's detail shows its sections, and the code notice is a note, not a tooltip", () => {
    const one = render(ready(LINT), "split");
    expect(attrs(one, "data-section")).toEqual([
      "runs",
      "does",
      "files",
      "risk",
      "source",
      "after",
    ]);
    expect(one).toContain('role="note"');
    expect(one).toContain("코드를 직접 실행해요");
  });

  test("approve and reject are real buttons with their names", () => {
    expect(html).toMatch(/<button[^>]*>[^<]*승인<\/button>|>승인</);
    expect(html).toContain(">거절<");
  });
});

describe("layout B: cards that expand", () => {
  const html = render(ready(ITEMS), "cards");

  test("each pending item is an article, the first is expanded and the rest say they are collapsed", () => {
    expect(html.match(/<article/g)?.length ?? 0).toBe(PENDING);
    // 카드를 펴고 접는 단추만(aria-controls가 있는 단추). 펼친 카드 안의 고르기 칸도 aria-expanded를 가진다
    const toggles = [...html.matchAll(/<button[^>]*aria-controls="[^"]*"[^>]*>/g)].map((m) => m[0]);
    const expanded = toggles.flatMap((tag) => attrs(tag, "aria-expanded"));
    expect(expanded.filter((v) => v === "true")).toEqual(["true"]);
    expect(expanded.filter((v) => v === "false")).toHaveLength(PENDING - 1);
  });

  test("collapsed cards still show the code notice for code plugins", () => {
    const codeCards = ITEMS.filter(
      (item) => item.state === "pending" && (item.card.runs.code || item.card.does.inject?.scripts),
    ).length;
    expect(html.match(/role="note"/g)?.length ?? 0).toBeGreaterThanOrEqual(codeCards > 0 ? 1 : 0);
  });
});

describe("states", () => {
  test("empty says there is nothing waiting and shows no list", () => {
    const html = render(ready([]), "split");
    expect(html).toContain("기다리는 리뷰가 없어요");
    expect(html).not.toContain("data-review-row");
  });

  test("loading, failed and offline each have their own band", () => {
    expect(render({ status: "loading" }, "split")).toContain("리뷰를 읽는 중");
    expect(render({ status: "failed" }, "split")).toContain('role="alert"');
    expect(render({ status: "offline" }, "cards")).toContain(
      "엔진과 연결이 끊겨 리뷰를 읽지 못해요",
    );
  });

  test("an admin-locked plugin says so in the detail", () => {
    const html = render(ready(LINT, ["lint-guard"]), "split");
    expect(html).toContain("관리자가 이 플러그인을 막아 두었어요");
  });

  test("thirty items render thirty rows", () => {
    const many = manyItems();
    const html = render(ready(many), "split");
    expect(html.match(/data-review-row=/g)?.length ?? 0).toBe(
      many.filter((item) => item.state === "pending").length,
    );
  });

  test("a decided item keeps no decide buttons", () => {
    const decided = ITEMS.map(approvedCopy);
    const html = render(ready(decided), "split");
    expect(html).not.toContain(">거절<");
  });
});

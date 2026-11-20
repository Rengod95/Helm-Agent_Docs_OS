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
import type { DetailArrange } from "../../../src/views/craft/review/review-detail.tsx";
import { issueText } from "../../../src/views/craft/review/review-judge.tsx";
import { ReviewView } from "../../../src/views/craft/review/review-view.tsx";
import { harness } from "../../state/helpers.ts";

// 리뷰 화면(목록 + 요약 띠와 두 열의 자세히)의 정적 마크업. 낭독기가 읽을 이름과 역할, 늘 보이는 코드 실행 안내, 열마다 섹션 순서,
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

function render(load: ReviewLoad, arrange: DetailArrange = "band"): string {
  const node: ReactNode = (
    <EngineStoreContext value={frozenStore(harness().store.read.getState())}>
      <ShellStoreContext value={createShellStore(1440)}>
        <ReviewView data={dataOf(load)} arrange={arrange} />
      </ShellStoreContext>
    </EngineStoreContext>
  );
  return renderToString(node);
}

/** 정적 마크업에서 태그 하나의 속성 값들(순서대로) */
function attrs(html: string, name: string): readonly string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");
}

const ITEMS = sampleItems();
const PENDING = ITEMS.filter((item) => item.state === "pending").length;
const LINT = ITEMS.filter((item) => item.itemId === "rvw_sample_lint");

/** 섹션 표지가 어느 열에 있는지: 판단 열(`rv-judge`)이 시작하기 전이면 읽는 열이다 */
function columnsOf(html: string): {
  readonly read: readonly string[];
  readonly judge: readonly string[];
} {
  const split = html.indexOf('class="rv-judge"');
  return {
    read: attrs(html.slice(0, split), "data-section"),
    judge: attrs(html.slice(split), "data-section"),
  };
}

const LINT_HTML = render(ready(LINT));

describe("list beside the detail", () => {
  const html = render(ready(ITEMS));

  test("the list is a named navigation with one current row per pending item", () => {
    expect(html).toContain('aria-label="기다리는 리뷰"');
    expect(attrs(html, "aria-current").filter((v) => v === "page")).toEqual(["page"]);
    expect(html.match(/data-review-row=/g)?.length ?? 0).toBe(PENDING);
  });

  test("the detail is not a card: the reading column reads, the judging column decides", () => {
    expect(LINT_HTML).toContain('class="rv-detail"');
    expect(LINT_HTML).not.toContain("rounded-xl bg-surface-base p-4");
    expect(columnsOf(LINT_HTML)).toEqual({
      read: ["about", "how", "runs", "files"],
      judge: ["risk", "source"],
    });
    expect(LINT_HTML).toContain('aria-label="판단할 것"');
  });

  test("the code notice is a note in the judging column, never behind an icon", () => {
    expect(LINT_HTML).toContain('role="note"');
    expect(LINT_HTML).toContain("코드를 직접 실행해요");
    expect(LINT_HTML.indexOf('role="note"')).toBeGreaterThan(LINT_HTML.indexOf('class="rv-judge"'));
  });

  test("how it works uses the canvas words: 작동 방식 and 시점 / 입력 / 영향 / 출력", () => {
    expect(LINT_HTML).toContain(">작동 방식<");
    for (const word of ["시점", "입력", "영향", "출력"]) expect(LINT_HTML).toContain(`>${word}<`);
    expect(LINT_HTML).not.toContain("tool.call.before");
  });

  test("the version shows in the summary, and an update shows the step from the last approved one", () => {
    expect(LINT_HTML).toMatch(/data-slot="review-version"[^>]*>0\.3\.0</);
    const fetch = render(ready(ITEMS.filter((item) => item.name === "web-fetch-plus")));
    expect(fetch).toMatch(/data-slot="review-version"[^>]*>1\.4\.0 → 1\.5\.0</);
    expect(html).not.toContain("엔진이 알려 주지 않아요");
  });

  test("no restart guidance and no keep-only default: a new item from a folder asks where to add it", () => {
    expect(LINT_HTML).not.toContain("다시 시작");
    expect(LINT_HTML).toContain("넣을 곳을 고르세요");
    const approve = [...LINT_HTML.matchAll(/<button[^>]*aria-keyshortcuts="a"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(approve).toHaveLength(1);
    expect(approve[0]).toContain("disabled");
  });

  test("approve and reject are real buttons with their names", () => {
    expect(html).toMatch(/>승인</);
    expect(html).toContain(">거절<");
  });

  test("the dev comparison layouts keep the same sections", () => {
    for (const arrange of ["rail", "stack"] as const) {
      const one = render(ready(LINT), arrange);
      expect(one).toContain(`data-arrange="${arrange}"`);
      expect(attrs(one, "data-section")).toEqual([
        "about",
        "how",
        "runs",
        "files",
        "risk",
        "source",
      ]);
    }
  });
});

describe("profile rejection reasons", () => {
  test("the engine's issues read as sentences with profile titles", () => {
    expect(
      issueText(
        {
          code: "plugin_unknown",
          severity: "error",
          profile: "default",
          plugin: "helm",
          other: null,
          key: null,
        },
        SAMPLE_PROFILES,
      ),
    ).toBe("‘기본’ 프로필이 이 기기에 없는 ‘helm’ 플러그인을 가리켜요.");
    expect(
      issueText(
        {
          code: "brand_new",
          severity: null,
          profile: "common",
          plugin: null,
          other: null,
          key: null,
        },
        SAMPLE_PROFILES,
      ),
    ).toBe("‘베이스’ 프로필을 검사하다 걸린 곳이 있어요.");
  });
});

describe("states", () => {
  test("empty says there is nothing waiting and shows no list", () => {
    const html = render(ready([]));
    expect(html).toContain("기다리는 리뷰가 없어요");
    expect(html).not.toContain("data-review-row");
  });

  test("loading, failed and offline each have their own band", () => {
    expect(render({ status: "loading" })).toContain("리뷰를 읽는 중");
    expect(render({ status: "failed" })).toContain('role="alert"');
    expect(render({ status: "offline" })).toContain("엔진과 연결이 끊겨 리뷰를 읽지 못해요");
  });

  test("an admin-locked plugin says so in the judging column", () => {
    const html = render(ready(LINT, ["lint-guard"]));
    expect(html).toContain("관리자가 이 플러그인을 막아 두었어요");
  });

  test("thirty items render thirty rows", () => {
    const many = manyItems();
    const html = render(ready(many));
    expect(html.match(/data-review-row=/g)?.length ?? 0).toBe(
      many.filter((item) => item.state === "pending").length,
    );
  });

  test("a stale offline list locks the decision", () => {
    const html = render(ready(LINT, [], true));
    expect(html).toContain("연결이 끊겨 결정할 수 없어요");
  });
});

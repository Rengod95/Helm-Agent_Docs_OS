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
import { ReviewView, type ReviewDevSlot } from "../../../src/views/craft/review/review-view.tsx";
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
  missing: ReadonlyMap<string, readonly string[]> = new Map(),
): ReviewLoad {
  return {
    status: "ready",
    items,
    profiles: SAMPLE_PROFILES,
    managedOff: new Set(managedOff),
    missing,
    offline,
  };
}

function render(load: ReviewLoad, arrange: DetailArrange = "band", dev?: ReviewDevSlot): string {
  const node: ReactNode = (
    <EngineStoreContext value={frozenStore(harness().store.read.getState())}>
      <ShellStoreContext value={createShellStore(1440)}>
        <ReviewView data={dataOf(load)} arrange={arrange} {...(dev === undefined ? {} : { dev })} />
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

describe("third round", () => {
  const DEV: ReviewDevSlot = {
    menu: (
      <button type="button" data-review-switcher="">
        표본 · 실제 엔진
      </button>
    ),
    showSample: () => undefined,
  };

  test("the dev sample menu sits in the screen header, after the keys hint, in every state", () => {
    const html = render(ready(ITEMS), "band", DEV);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("data-review-switcher");
    expect(render({ status: "loading" }, "band", DEV)).toContain("data-review-switcher");
    expect(render(ready(ITEMS))).not.toContain("data-review-switcher");
  });

  test("an empty screen offers the sample scene in the dev build only", () => {
    expect(render(ready([]), "band", DEV)).toContain("표본 장면 보기");
    expect(render(ready([]))).not.toContain("표본 장면 보기");
  });

  test("the decide panel follows the source section inside the judging column's scroll", () => {
    const scroll = LINT_HTML.indexOf('class="rv-judge-scroll"');
    const source = LINT_HTML.indexOf('data-section="source"');
    const dock = LINT_HTML.indexOf('class="rv-decide-dock"');
    expect(scroll).toBeGreaterThan(0);
    expect(source).toBeGreaterThan(scroll);
    expect(dock).toBeGreaterThan(source);
  });

  test("enforcement reads as who keeps it: the model's call or the engine", () => {
    expect(LINT_HTML).not.toContain(">권고<");
    expect(LINT_HTML).toMatch(/>(모델 재량|엔진 강제)</);
    expect(LINT_HTML).toContain(">지키는 쪽<");
  });

  test("a chosen profile that already points to a missing plugin shows a quiet warning, not a block", () => {
    const helper = ITEMS.filter((item) => item.itemId === "rvw_sample_drive");
    expect(helper[0]?.originProfileId).toBe("default");
    const html = render(ready(helper, [], false, new Map([["default", ["helm"]]])));
    expect(html).toContain('data-slot="review-missing"');
    expect(html).toContain("‘helm’ 플러그인이 이 기기에 없어요. 이 프로필에서는 건너뛰어요.");
    const clean = render(ready(helper));
    expect(clean).not.toContain('data-slot="review-missing"');
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

describe("fourth round (m6R4)", () => {
  const IMPORTED = render(ready(ITEMS.filter((item) => item.itemId === "rvw_sample_imported")));
  const BOXED = render(ready(ITEMS.filter((item) => item.itemId === "rvw_sample_imported_box")));
  const HELPER = render(ready(ITEMS.filter((item) => item.itemId === "rvw_sample_drive")));

  test("notices are the app's toast part in place, with the toast's tone", () => {
    expect(LINT_HTML).toMatch(/data-slot="toast" data-tone="info"[^>]*data-review-notice="code"/);
    const locked = render(ready(LINT, ["lint-guard"]));
    expect(locked).toMatch(/data-tone="danger"[^>]*data-review-notice="managed"/);
    expect(IMPORTED).toMatch(/data-tone="warning"[^>]*data-review-notice="code"/);
    expect(BOXED).toMatch(/data-tone="info"[^>]*data-review-notice="code"/);
    expect(LINT_HTML).not.toContain("rv-caution");
  });

  test("an imported hook says it runs as you, and shows the original command, shell and the files it reads", () => {
    expect(IMPORTED).toContain("이 훅은 당신의 셸 명령 그대로, 당신의 권한으로 돌아요");
    expect(IMPORTED).toContain("Fresnel이 막지 않아요.");
    expect(IMPORTED).toContain("npx prettier --write &quot;$CLAUDE_FILE_PATHS&quot;");
    expect(IMPORTED).toContain(">.prettierrc<");
    expect(IMPORTED).toContain(">지문 없음<");
    for (const chip of [">당신의 권한<", ">환경 변수<", ">네트워크<"])
      expect(IMPORTED).toContain(chip);
  });

  test("the sandboxed variant, an unknown read set and a missing executable are told apart", () => {
    expect(BOXED).toContain("샌드박스 안에서 돌아요");
    for (const chip of [">넓은 읽기<", ">프로젝트에 쓰기<"]) expect(BOXED).toContain(chip);
    expect(BOXED).toContain("어떤 파일을 읽는지 알 수 없어요");
    expect(BOXED).toContain("이 기기에서 찾지 못한 실행 파일이에요: ruff.");
    expect(LINT_HTML).toContain("자기 폴더 밖의 파일은 읽거나 쓸 수 없어요.");
  });

  test("an observe-only hook is not the model's call: the chip says the engine watches", () => {
    expect(IMPORTED).toContain(">엔진 관찰<");
    expect(IMPORTED).not.toContain(">모델 재량<");
    expect(IMPORTED).toContain("엔진: 정해진 자리에서 돌지만 막거나 바꾸지 않아요");
  });

  test("a missing purpose comes filled from the card's facts, editable", () => {
    const area = HELPER.match(/<textarea[^>]*>([^<]*)<\/textarea>/);
    expect(area?.[1]).toBe("‘/review’ 명령으로 대화를 이끌어요.");
    expect(HELPER).toContain("카드의 사실로 만든 문장이에요. 고칠 것이 있을 때만 고치세요.");
    expect(IMPORTED).toContain("도구 호출 뒤에 돌며 내용을 지켜봐요.");
  });

  test("reject and approve share the row in equal halves", () => {
    const buttons = [...HELPER.matchAll(/<button[^>]*aria-keyshortcuts="[ar]"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain("flex-1");
  });

  test("numbers read in the body face: the version is not monospaced, hashes and paths stay code", () => {
    expect(LINT_HTML).toMatch(
      /data-slot="review-version" class="shrink-0 text-ui text-text-tertiary"/,
    );
    expect(LINT_HTML).toMatch(/class="rv-code"[^>]*>lint-guard</);
    expect(LINT_HTML).not.toContain("tabular-nums");
  });

  test("the header is flush so the list and detail lines meet the header line", () => {
    expect(LINT_HTML).toMatch(/<header class="shell-header[^"]*" data-flush=""/);
    expect(render(ready([]))).not.toContain("data-flush");
  });
});

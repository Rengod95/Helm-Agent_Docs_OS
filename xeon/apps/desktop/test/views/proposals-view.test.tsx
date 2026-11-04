import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { proposalListView, type ProposalRowVM } from "@fresnel/client/settings";
import type { ProposalRow, WireResult } from "@fresnel/contracts/wire";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { renderToString } from "react-dom/server";
import {
  INITIAL_PROPOSALS_STATE,
  proposalsReducer,
  type ProposalPage,
  type ProposalsState,
  type SkillPeek,
} from "../../src/views/pages/proposals/proposals-model.ts";
import {
  ProposalsView,
  SkillCompare,
  type ProposalsHandlers,
  type ProposalsViewProps,
} from "../../src/views/pages/proposals/proposals-view.tsx";

// 제안 화면(P-06)의 서버 렌더. 빈, 읽는 중, 오류, 오프라인, 권한 필요, 긴 내용을 그린다. 클릭과 키 입력은 DOM이 없어 시험하지 못한다
// (뜻은 proposals-model 시험이 본다). 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const HANDLERS: ProposalsHandlers = {
  filterChange: NOOP,
  select: NOOP,
  act: NOOP,
  scopeChange: NOOP,
  editorChange: NOOP,
  editorSubmit: NOOP,
  editorCancel: NOOP,
  confirmAccept: NOOP,
  confirmCancel: NOOP,
  loadMore: NOOP,
  retry: NOOP,
  openThread: NOOP,
  skillOpen: NOOP,
  skillClose: NOOP,
  dismissNotice: NOOP,
  onKey: NOOP,
};
const NOW = 2_000_000_000_000;
const THREAD = ((): ProposalRow["evidence"][number]["threadId"] => {
  const parsed = parse(ThreadIdSchema, "thr_00000000000000000000000001");
  if (!parsed.ok) throw new Error("test id must parse");
  return parsed.value;
})();

function wire(overrides: Partial<ProposalRow>): ProposalRow {
  return {
    source: "learning",
    id: "p1",
    kind: "skill",
    op: "create",
    target: "skills/cache-debug.md",
    status: "pending",
    destructive: false,
    diff: "+ # cache-debug\n+ 1. 단위를 확인한다",
    rationale: "캐시 만료 디버깅을 3번 반복함",
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    revision: 2,
    scope: null,
    afterUntrusted: false,
    createdAt: NOW - 60_000,
    ...overrides,
  };
}

function rowsOf(...rows: readonly ProposalRow[]): ProposalPage {
  const view = proposalListView({ proposals: [...rows], nextCursor: null, unavailable: [] });
  return { rows: view.rows, unavailableTexts: [], nextCursor: null };
}

function ready(page: ProposalPage, base: ProposalsState = INITIAL_PROPOSALS_STATE): ProposalsState {
  return proposalsReducer(base, { type: "listLoaded", page, append: false, readAt: NOW });
}

function selectFirst(state: ProposalsState, rows: readonly ProposalRowVM[]): ProposalsState {
  const first = rows[0];
  if (first === undefined) throw new Error("expected a row");
  return proposalsReducer(state, { type: "select", key: first.key });
}

/** 글이 든 버튼 하나의 시작 태그. 없으면 빈 글이다 */
function buttonOf(markup: string, label: string): string {
  const found = markup.match(
    new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`),
  );
  return found === null ? "" : found[0];
}

function html(state: ProposalsState, over: Partial<ProposalsViewProps> = {}): string {
  return renderToString(
    <ProposalsView
      state={state}
      live={true}
      openable={() => false}
      handlers={HANDLERS}
      {...over}
    />,
  );
}

describe("ProposalsView states", () => {
  test("empty: a loaded pending list with no rows says there are no pending proposals", () => {
    const markup = html(ready(rowsOf()));
    expect(markup).toContain(t("client.settings.proposals.empty"));
    expect(markup).not.toContain('data-slot="skeleton"');
  });

  test("empty under another filter says nothing matches, not that nothing is pending", () => {
    const applied = proposalsReducer(ready(rowsOf()), {
      type: "filterChanged",
      filter: { status: "applied", source: "all", kind: "all" },
    });
    const markup = html(ready(rowsOf(), applied));
    expect(markup).toContain(t("desktop.proposals.filteredEmpty"));
    expect(markup).not.toContain(t("client.settings.proposals.empty"));
  });

  test("reading: the list shows a status line and skeleton rows, not the empty text", () => {
    const markup = html(INITIAL_PROPOSALS_STATE);
    expect(markup).toContain(t("desktop.proposals.loading"));
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain(t("client.settings.proposals.empty"));
  });

  test("error: a failed list read says so with a retry, and a source that could not be read is a warning above the list", () => {
    const failed = proposalsReducer(INITIAL_PROPOSALS_STATE, { type: "listFailed" });
    const listFailed = html(failed);
    expect(listFailed).toContain(t("desktop.proposals.load.failed"));
    expect(listFailed).toContain(t("desktop.proposals.retry"));

    const partial = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "listLoaded",
      page: {
        rows: rowsOf(wire({})).rows,
        unavailableTexts: [t("client.settings.proposals.unavailable.knowledge")],
        nextCursor: null,
      },
      append: false,
      readAt: NOW,
    });
    const warned = html(partial);
    expect(warned).toContain(t("client.settings.proposals.unavailable.knowledge"));
    expect(warned).toContain("skills/cache-debug.md");
  });

  test("error from a decision shows its sentence in a notice and keeps the list", () => {
    const withNotice = proposalsReducer(
      selectFirst(ready(rowsOf(wire({}))), rowsOf(wire({})).rows),
      {
        type: "noticeSet",
        notice: { tone: "danger", text: t("client.settings.proposals.failed.revisionMismatch") },
      },
    );
    const markup = html(withNotice);
    expect(markup).toContain(t("client.settings.proposals.failed.revisionMismatch"));
    expect(markup).toContain("skills/cache-debug.md");
  });

  test("offline: the banner says so and the decision buttons are disabled, while the read rows stay", () => {
    const page = rowsOf(wire({}));
    const state = selectFirst(ready(page), page.rows);
    const markup = html(state, { live: false });
    expect(markup).toContain(t("desktop.proposals.offline"));
    expect(markup).toContain("skills/cache-debug.md");
    expect(buttonOf(markup, t("desktop.proposals.action.approve"))).toContain('disabled=""');
    // 같은 화면을 연결된 상태로 그리면 승인 버튼은 열려 있다(잠금이 연결 상태 때문임을 확인한다)
    const connected = html(state);
    expect(buttonOf(connected, t("desktop.proposals.action.approve"))).not.toContain('disabled=""');
  });

  test("permission needed: an approval-required outcome shows its sentence and nothing is hidden", () => {
    const page = rowsOf(wire({}));
    const needed = proposalsReducer(selectFirst(ready(page), page.rows), {
      type: "noticeSet",
      notice: { tone: "danger", text: t("client.settings.proposals.failed.approvalRequired") },
    });
    const markup = html(needed);
    expect(markup).toContain(t("client.settings.proposals.failed.approvalRequired"));
  });

  test("long content: a diff over 500 lines shows the first 500 and a button for the rest", () => {
    const longDiff = Array.from({ length: 600 }, (_, index) => `+ row-${String(index + 1)}`).join(
      "\n",
    );
    const page = rowsOf(wire({ diff: longDiff }));
    const markup = html(selectFirst(ready(page), page.rows));
    expect(markup).toContain("row-500");
    expect(markup).not.toContain("row-501");
    expect(markup).toContain(t("desktop.proposals.detail.foldMore", { count: 100 }));
  });

  test("an untrusted candidate shows the warning, and a conflict shows the other target", () => {
    const page = rowsOf(wire({ afterUntrusted: true, conflictsWith: "skills/other.md" }));
    const markup = html(selectFirst(ready(page), page.rows));
    expect(markup).toContain(t("desktop.proposals.detail.untrusted"));
    expect(markup).toContain(t("desktop.proposals.detail.conflict", { target: "skills/other.md" }));
  });
});

/** 충돌 행 하나를 고른 상태. 대화 상자 상태는 `peek`으로 정한다 */
function conflicted(peek: SkillPeek = { status: "closed" }): ProposalsState {
  const page = rowsOf(wire({ conflictsWith: "cache-debug-old" }));
  return { ...selectFirst(ready(page), page.rows), skill: peek };
}

describe("ProposalsView conflicting skill", () => {
  const SKILL: WireResult<"knowledge.skills.view"> = {
    name: "cache-debug-old",
    scope: "project",
    description: "캐시 만료를 디버깅한다",
    body: "1. 단위를 확인한다\n2. 로그를 본다",
    bodyTruncated: false,
    files: [],
    treeHash: "b".repeat(64),
  };

  test("a conflict offers the view button inside its alert, and the button is off while offline", () => {
    const state = conflicted();
    const connected = html(state);
    expect(connected).toContain(
      t("desktop.proposals.detail.conflict", { target: "cache-debug-old" }),
    );
    expect(buttonOf(connected, t("desktop.proposals.skill.open"))).not.toContain('disabled=""');
    const offline = html(state, { live: false });
    expect(buttonOf(offline, t("desktop.proposals.skill.open"))).toContain('disabled=""');
  });

  test("a proposal without a conflict offers no skill button", () => {
    const page = rowsOf(wire({}));
    const markup = html(selectFirst(ready(page), page.rows));
    expect(markup).not.toContain(t("desktop.proposals.skill.open"));
  });

  test("a closed dialog draws none of the skill columns", () => {
    const markup = html(conflicted());
    expect(markup).not.toContain(t("desktop.proposals.skill.current"));
    expect(markup).not.toContain(t("desktop.proposals.skill.proposed"));
  });

  test("loading: the current column shows a status line and skeleton rows, and the proposed text is already there", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{ status: "loading", name: "cache-debug-old", threadId: null }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.skill.loading"));
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).toContain("# 새 스킬");
  });

  test("ready: the scope and description head the body, and the proposed text sits beside it", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{ status: "ready", name: "cache-debug-old", threadId: null, skill: SKILL }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.scope.project"));
    expect(markup).toContain("캐시 만료를 디버깅한다");
    expect(markup).toContain("2. 로그를 본다");
    expect(markup).toContain("# 새 스킬");
    expect(markup).not.toContain(t("desktop.proposals.skill.truncated"));
    expect(markup).toContain(t("desktop.proposals.skill.info"));
  });

  test("ready with a truncated body shows the warning above the text", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{
          status: "ready",
          name: "cache-debug-old",
          threadId: null,
          skill: { ...SKILL, bodyTruncated: true },
        }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.skill.truncated"));
    expect(markup).toContain("2. 로그를 본다");
  });

  test("ready with an empty body says so, and an extension skill names its origin", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{
          status: "ready",
          name: "cache-debug-old",
          threadId: null,
          skill: { ...SKILL, body: "", scope: "extension" },
        }}
        proposed={null}
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.skill.empty"));
    expect(markup).toContain(t("desktop.proposals.skill.scope.extension"));
    expect(markup).toContain(t("desktop.proposals.skill.noProposed"));
  });

  test("not found and feature off are plain sentences with no retry", () => {
    const notFound = renderToString(
      <SkillCompare
        peek={{ status: "notFound", name: "cache-debug-old", threadId: null }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(notFound).toContain(t("desktop.proposals.skill.notFound"));
    expect(notFound).not.toContain(t("desktop.proposals.retry"));

    const unsupported = renderToString(
      <SkillCompare
        peek={{ status: "unsupported", name: "cache-debug-old", threadId: null }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(unsupported).toContain("스킬 기능이 꺼져 있어요");
    expect(unsupported).not.toContain(t("desktop.proposals.retry"));
  });

  test("a read error offers a retry that is on while connected", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{ status: "failed", name: "cache-debug-old", threadId: null }}
        proposed="# 새 스킬"
        live={true}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.skill.failed"));
    expect(buttonOf(markup, t("desktop.proposals.retry"))).not.toContain('disabled=""');
  });

  test("offline: the sentence says to reconnect, and the retry is off", () => {
    const markup = renderToString(
      <SkillCompare
        peek={{ status: "offline", name: "cache-debug-old", threadId: null }}
        proposed="# 새 스킬"
        live={false}
        handlers={HANDLERS}
      />,
    );
    expect(markup).toContain(t("desktop.proposals.skill.offline"));
    expect(buttonOf(markup, t("desktop.proposals.retry"))).toContain('disabled=""');
  });
});

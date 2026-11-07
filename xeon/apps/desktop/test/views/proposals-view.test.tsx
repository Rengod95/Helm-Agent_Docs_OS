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
  type LearningState,
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
  learningTurnOn: NOOP,
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
    target: "cache-debug",
    status: "pending",
    destructive: false,
    diff: "+ # cache-debug\n+ 1. 단위를 확인한다",
    rationale: "캐시 만료 디버깅을 3번 반복함",
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    note: null,
    revision: 2,
    scope: null,
    afterUntrusted: false,
    createdAt: NOW - 60_000,
    expiresAt: NOW - 60_000 + 30 * 86_400_000,
    ...overrides,
  };
}

function rowsOf(...rows: readonly ProposalRow[]): ProposalPage {
  const view = proposalListView({ proposals: [...rows], nextCursor: null, unavailable: [] });
  return { rows: view.rows, unavailable: [], nextCursor: null };
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
        unavailable: ["knowledge"],
        nextCursor: null,
      },
      append: false,
      readAt: NOW,
    });
    const warned = html(partial);
    expect(warned).toContain(t("client.settings.proposals.unavailable.knowledge"));
    // 목록 행은 대상 이름이 아니라 제목(스킬 이름)을 보인다
    expect(warned).toContain("스킬 cache-debug");
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
    expect(markup).toContain("cache-debug");
  });

  test("offline: the banner says so and the decision buttons are disabled, while the read rows stay", () => {
    const page = rowsOf(wire({}));
    const state = selectFirst(ready(page), page.rows);
    const markup = html(state, { live: false });
    expect(markup).toContain(t("desktop.proposals.offline"));
    expect(markup).toContain("cache-debug");
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

describe("ProposalsView learning off and reverts", () => {
  const OFF_ON: LearningState = {
    status: "off",
    turnOn: { key: "ext.learning.enabled", value: true, scope: "user" },
  };

  test("learning off is an info line with a turn-on button, not an error, and the stored history stays listed", () => {
    const page = rowsOf(wire({ status: "applied", source: "learning", target: "old" }));
    const off = proposalsReducer(ready(page), { type: "learningRead", learning: OFF_ON });
    const markup = html(off);
    expect(markup).toContain(t("desktop.proposals.learning.off"));
    expect(buttonOf(markup, t("desktop.proposals.learning.on"))).not.toContain('disabled=""');
    expect(markup).toContain("스킬 old");
    expect(markup).not.toContain(t("client.settings.proposals.unavailable.learning"));
  });

  test("learning off with the learning read gap from the host shows no learning error", () => {
    const page: ProposalPage = { rows: [], unavailable: ["learning"], nextCursor: null };
    const off = proposalsReducer(ready(page), { type: "learningRead", learning: OFF_ON });
    const markup = html(off);
    expect(markup).toContain(t("desktop.proposals.learning.off"));
    expect(markup).not.toContain(t("client.settings.proposals.unavailable.learning"));
  });

  test("the turn-on button is off while offline, and absent when the group cannot be switched", () => {
    const page = rowsOf(wire({}));
    const offline = html(
      proposalsReducer(ready(page), { type: "learningRead", learning: OFF_ON }),
      {
        live: false,
      },
    );
    expect(buttonOf(offline, t("desktop.proposals.learning.on"))).toContain('disabled=""');
    const locked = html(
      proposalsReducer(ready(page), {
        type: "learningRead",
        learning: { status: "off", turnOn: null },
      }),
    );
    expect(locked).toContain(t("desktop.proposals.learning.off"));
    expect(locked).not.toContain(t("desktop.proposals.learning.on"));
  });

  test("learning on shows neither the off line nor a learning error for a read gap the list did not name", () => {
    const page = rowsOf(wire({}));
    const on = html(
      proposalsReducer(ready(page), { type: "learningRead", learning: { status: "on" } }),
    );
    expect(on).not.toContain(t("desktop.proposals.learning.off"));
  });

  test("a refused revert shows the warning sentence, not the reverted one, and the row stays applied with its revert button", () => {
    const page = rowsOf(
      wire({ status: "applied", source: "learning", reason: "rollback_refused" }),
    );
    const selected = selectFirst(ready(page), page.rows);
    const refused = proposalsReducer(selected, {
      type: "noticeSet",
      notice: { tone: "warning", text: t("desktop.proposals.done.revertRefused") },
    });
    const markup = html(refused);
    expect(markup).toContain(t("desktop.proposals.done.revertRefused"));
    expect(markup).not.toContain(t("desktop.proposals.done.reverted"));
    expect(buttonOf(markup, t("desktop.proposals.action.revert"))).not.toContain('disabled=""');
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

/** 입력 칸의 이름표: 이름표가 가리키는 칸의 id와 글. 이름표가 없으면 null */
function labelOf(markup: string): { readonly forId: string; readonly text: string } | null {
  const found = markup.match(/<label[^>]*\sfor="([^"]+)"[^>]*>([^<]*)<\/label>/);
  return found === null ? null : { forId: found[1] ?? "", text: found[2] ?? "" };
}

/** 글 칸(textarea)의 id. 칸이 없으면 빈 글 */
function textareaIdOf(markup: string): string {
  const found = markup.match(/<textarea[^>]*\sid="([^"]+)"/);
  return found === null ? "" : (found[1] ?? "");
}

/** 첫 행을 고르고 거절 메모 칸을 연 상태 */
function rejecting(page: ProposalPage): ProposalsState {
  const first = page.rows[0];
  if (first === undefined) throw new Error("expected a row");
  return proposalsReducer(selectFirst(ready(page), page.rows), {
    type: "editorOpened",
    mode: "reject",
    key: first.key,
  });
}

describe("ProposalsView reject note, row title, diff wrap, and expiry", () => {
  // 시험 프로세스는 ko로 시작하므로 날짜 글은 ko로 본다(2033-06-17 정오, 지역 시각)
  const AT = new Date(2033, 5, 17, 12).getTime();
  const DATE = "2033년 6월 17일";

  test("the reject note field has a visible label that names it and a placeholder, and no aria-label stands in for the label", () => {
    const page = rowsOf(wire({}));
    const markup = html(rejecting(page));
    expect(labelOf(markup)).toEqual({
      forId: textareaIdOf(markup),
      text: t("desktop.proposals.reject.noteLabel"),
    });
    expect(markup).toContain(`placeholder="${t("desktop.proposals.reject.notePlaceholder")}"`);
    const textarea = markup.match(/<textarea[^>]*>/);
    expect(textarea === null ? "" : textarea[0]).not.toContain("aria-label");
  });

  test("a rejected proposal shows its saved note under the reason in a labelled line; with no note there is no such line", () => {
    const withNote = rowsOf(wire({ status: "rejected", note: "같은 제안은 다시 만들지 마" }));
    const markup = html(selectFirst(ready(withNote), withNote.rows));
    expect(markup).toContain(t("desktop.proposals.detail.note"));
    expect(markup).toContain("같은 제안은 다시 만들지 마");
    expect(markup.indexOf(t("desktop.proposals.detail.rationale"))).toBeLessThan(
      markup.indexOf(t("desktop.proposals.detail.note")),
    );
    const withoutNote = rowsOf(wire({ status: "rejected", note: null }));
    const bare = html(selectFirst(ready(withoutNote), withoutNote.rows));
    expect(bare).not.toContain(t("desktop.proposals.detail.note"));
  });

  test("the list row titles the proposal by its content, shows the kind and the expiry, and leaves the internal target out", () => {
    const sentence = "커밋 메시지는 feat/fix/chore 중 하나로 쓰고 한 줄로 쓴다. 팀 규칙이다.";
    const page = rowsOf(
      wire({
        kind: "feedback",
        op: "add",
        target: "user/work-style",
        diff: `+ ${sentence}`,
        expiresAt: AT,
      }),
    );
    const markup = html(ready(page));
    expect(markup).toContain(sentence);
    expect(markup).toContain(t("desktop.proposals.row.expires", { date: DATE }));
    expect(markup).toContain(t("client.settings.proposals.kind.feedback"));
    expect(markup).not.toContain("user/work-style");
  });

  test("a pending proposal shows its expiry date in the detail with an info icon; a proposal without an expiry shows neither", () => {
    const page = rowsOf(wire({ expiresAt: AT }));
    const markup = html(selectFirst(ready(page), page.rows));
    expect(markup).toContain(t("desktop.proposals.detail.expires", { date: DATE }));
    expect(markup).toContain(t("desktop.proposals.detail.expiresInfo"));
    const none = rowsOf(wire({ expiresAt: null }));
    expect(html(selectFirst(ready(none), none.rows))).not.toContain(
      t("desktop.proposals.detail.expires", { date: DATE }),
    );
    expect(html(selectFirst(ready(none), none.rows))).not.toContain(
      t("desktop.proposals.detail.expiresInfo"),
    );
    expect(html(ready(none))).not.toContain(t("desktop.proposals.row.expires", { date: DATE }));
  });

  test("a long diff line wraps: its line carries the wrap classes and keeps all 300 characters", () => {
    const long = "x".repeat(300);
    const page = rowsOf(wire({ diff: `+ ${long}\n- 짧은 줄` }));
    const markup = html(selectFirst(ready(page), page.rows));
    expect(markup).toContain(long);
    const added = markup.match(/<span data-slot="code-diff-line" data-kind="add" class="([^"]*)"/);
    const classes = added === null ? [] : (added[1] ?? "").split(" ");
    expect(classes).toContain("whitespace-pre-wrap");
    expect(classes).toContain("break-words");
    expect(classes).toContain("h-auto");
    expect(classes).not.toContain("whitespace-pre");
    expect(classes).not.toContain("h-5");
  });
});

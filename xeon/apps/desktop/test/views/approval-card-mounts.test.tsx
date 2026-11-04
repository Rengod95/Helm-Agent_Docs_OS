import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { DurableFact } from "../../src/state/engine/input.ts";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { ApprovalCardList } from "../../src/views/approval-card/approval-card.tsx";
import { ApprovalQueue, InboxApprovals } from "../../src/views/approvals.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { GoToThreadContext, type GoToThread } from "../../src/views/thread-link.ts";
import { SUB, evt, openedHarness, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 같은 승인 대기 넷(도구, 질문, 계획, 검토)을 트랜스크립트 끝, 끝 영역 받은 요청, P-03 목록 자리(ApprovalCardList)에 그린다.
// 세 자리의 카드는 머리 부제를 뺀 HTML이 종류마다 같아야 하고, approval.resolved가 오면 세 자리에서 모두 사라져야 한다.
// 머리 부제에는 대화 이름이 들어간다. 트랜스크립트 끝(열린 대화 안)은 글이고, 받은 요청과 대화 밖 목록은 이름이 링크다.
// React useId 값은 트리 위치에 따라 달라 id·aria-labelledby 값만 지우고 비교한다.

const T = thr(1);

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

/** 이동 문맥을 넣을 때만 `goTo`를 준다. 없으면 대화 이름은 글이다 */
function render(node: ReactNode, state: EngineMirror, goTo: GoToThread | null = null): string {
  return renderToString(
    <Providers engine={frozen(state)} ui={createUiStore().read} commands={fakeCommands()}>
      <GoToThreadContext value={goTo}>{node}</GoToThreadContext>
    </Providers>,
  );
}

const origin = { threadId: T, turnId: null, stepId: null, toolCallId: null, caller: "main" };
const ULID_TAIL = "0".repeat(24);

function payload(input: Record<string, unknown>): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin,
    surfaceThreadId: T,
    requestedAt: Date.now() - 5 * 60_000,
    remember: ["once", "thread"],
    ...input,
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

const REQUESTS: readonly ApprovalRequestedPayload[] = [
  payload({
    requestKey: "tool-1",
    title: "Allow bash to deploy?",
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "execute",
        args: { command: "deploy --prod", secretEnv: { TOKEN: "secret://prod/token" } },
        argsHash: "h1",
        ruleId: null,
      },
    },
  }),
  payload({
    requestKey: "question-1",
    title: "Which suite first?",
    remember: ["once"],
    body: {
      kind: "question",
      question: {
        questions: [
          {
            id: "scope",
            header: "Scope",
            text: "Which suite first?",
            options: [
              { id: "unit", label: "Unit", description: "fast", recommended: true },
              { id: "e2e", label: "End to end" },
            ],
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      },
    },
  }),
  payload({
    requestKey: "plan-1",
    title: "Split the cache step",
    body: {
      kind: "plan",
      plan: {
        plan: "1. Split the step\n2. Add two tests",
        planRef: null,
        nextModes: ["default", "plan"],
      },
    },
  }),
  payload({
    requestKey: "review-1",
    title: "Review the cache changes",
    body: {
      kind: "review",
      review: {
        reviewId: `rvw_${ULID_TAIL}AB`,
        artifactId: `art_${ULID_TAIL}CD`,
        title: "Cache expiry",
        round: 1,
        files: [
          { path: "src/cache.ts", change: "modified", binary: false, hunks: 4 },
          { path: "test/expiry.test.ts", change: "added", binary: false, hunks: 2 },
        ],
      },
    },
  }),
];

const KINDS = ["tool", "question", "plan", "review"] as const;

/** 카드 한 장의 HTML. 카드 안에는 li가 없으므로 첫 `</li>`까지가 한 장이다 */
function cardsOf(html: string): string[] {
  return html.match(/<li data-slot="approval-card-item"[\s\S]*?<\/li>/g) ?? [];
}

/** 머리 부제를 뺀다(대화 이름 링크가 들어가는 자리). 부제는 글과 단추만 있어 첫 `</div>`가 끝이다 */
const SUBTITLE = /<div data-slot="agent-request-subtitle"[\s\S]*?<\/div>/;

/** useId 값만 지운다(트리 위치가 달라도 같은 카드인지 본다). 부제는 위치마다 달라 비교에서 뺀다 */
function sameCardShape(card: string): string {
  return card.replace(SUBTITLE, "").replace(/\s(?:id|aria-labelledby)="[^"]*"/g, "");
}

function kindOf(card: string): string | undefined {
  return card.match(/data-approval-kind="([a-z]+)"/)?.[1];
}

/** 카드 머리의 대화 이름이 링크인가 */
function threadLinkOf(card: string): boolean {
  return card.includes('data-action="thread"');
}

const goTo: GoToThread = () => {};

describe("approval card mounts", () => {
  test("approval-card.same-in-three-places", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "threads",
      threads: [summary(T, { title: "Cache work" })],
    });
    REQUESTS.forEach((request, index) => {
      const seq = 6 + index;
      const fact: DurableFact = {
        type: "approval.requested",
        seq,
        eventId: evt(seq),
        threadId: T,
        turnId: null,
        at: "t",
        request,
      };
      h.store.ingest({
        type: "batch",
        sub: SUB,
        from: seq - 1,
        to: seq,
        caughtUp: true,
        facts: [fact],
      });
    });
    h.store.flush();

    const state = h.store.read.getState();
    expect(state.approvals.ids).toEqual(REQUESTS.map((_, index) => evt(6 + index)));

    const queue = cardsOf(render(<ApprovalQueue />, state, goTo));
    const inbox = cardsOf(render(<InboxApprovals />, state, goTo));
    const shared = cardsOf(render(<ApprovalCardList ids={state.approvals.ids} />, state, goTo));

    // 네 종류가 세 자리에 한 장씩 있고, 부제를 뺀 카드 HTML은 같다
    expect(queue.map(kindOf)).toEqual([...KINDS]);
    expect(inbox.map(kindOf)).toEqual([...KINDS]);
    expect(shared.map(kindOf)).toEqual([...KINDS]);
    KINDS.forEach((_kind, index) => {
      const reference = sameCardShape(queue[index] ?? "");
      expect(sameCardShape(inbox[index] ?? "")).toBe(reference);
      expect(sameCardShape(shared[index] ?? "")).toBe(reference);
    });
    // 같은 카드 머리에 대화 이름과 만료가 함께 그려진다(한 줄 확인). 트랜스크립트 끝은 열린 대화 안이라 글이다
    expect(queue[0] ?? "").toContain("대화: Cache work");
    expect(queue.map(threadLinkOf)).toEqual([false, false, false, false]);
    // 받은 요청과 대화 밖 목록은 같은 이름을 링크로 낸다
    expect(inbox.map(threadLinkOf)).toEqual([true, true, true, true]);
    expect(shared.map(threadLinkOf)).toEqual([true, true, true, true]);
    expect(inbox[0] ?? "").toContain(">Cache work</button>");
    // 검토 카드는 "검토 열기"를 낸다(P-04로 가는 단추)
    expect(queue[3] ?? "").toContain(`data-action="open"`);
    expect(queue[2] ?? "").not.toContain(`data-action="open"`);

    // approval.resolved(질문)가 오면 질문 카드만 세 자리에서 사라진다
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 9,
      to: 10,
      caughtUp: true,
      facts: [
        {
          type: "approval.resolved",
          seq: 10,
          eventId: evt(10),
          threadId: T,
          turnId: null,
          at: "t",
          approvalId: evt(7),
        },
      ],
    });
    h.store.flush();
    const afterOne = h.store.read.getState();
    const remaining = ["tool", "plan", "review"] as const;
    expect(cardsOf(render(<ApprovalQueue />, afterOne)).map(kindOf)).toEqual([...remaining]);
    expect(cardsOf(render(<InboxApprovals />, afterOne)).map(kindOf)).toEqual([...remaining]);
    expect(
      cardsOf(render(<ApprovalCardList ids={afterOne.approvals.ids} />, afterOne)).map(kindOf),
    ).toEqual([...remaining]);
    expect(render(<ApprovalQueue />, afterOne)).not.toContain("Which suite first?");

    // 나머지도 해결되면 대기열 자리는 비고, 끝 영역은 빈 상태 글을 보인다
    [evt(6), evt(8), evt(9)].forEach((approvalId, index) => {
      const seq = 11 + index;
      h.store.ingest({
        type: "batch",
        sub: SUB,
        from: seq - 1,
        to: seq,
        caughtUp: true,
        facts: [
          {
            type: "approval.resolved",
            seq,
            eventId: evt(seq),
            threadId: T,
            turnId: null,
            at: "t",
            approvalId,
          },
        ],
      });
    });
    h.store.flush();
    const empty = h.store.read.getState();
    expect(render(<ApprovalQueue />, empty)).toBe("");
    expect(cardsOf(render(<InboxApprovals />, empty))).toEqual([]);
    expect(render(<InboxApprovals />, empty)).toContain("기다리는 요청이 없어요");
    expect(cardsOf(render(<ApprovalCardList ids={empty.approvals.ids} />, empty))).toEqual([]);
  });

  test("approval-card.thread-link-needs-a-target", () => {
    // 같은 대화(T)의 요청 하나와, 거울에 없는 대화(other)의 요청 하나
    const other = thr(2);
    const h = openedHarness();
    h.store.ingest({ type: "threads", threads: [summary(T, { title: "Cache work" })] });
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "approval.requested",
          seq: 6,
          eventId: evt(6),
          threadId: T,
          turnId: null,
          at: "t",
          request: payload({
            requestKey: "tool-own",
            title: "Allow bash in this conversation?",
            body: {
              kind: "tool",
              tool: {
                toolName: "bash",
                risk: "execute",
                args: { command: "ls" },
                argsHash: "h1",
                ruleId: null,
              },
            },
          }),
        },
      ],
    });
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 6,
      to: 7,
      caughtUp: true,
      facts: [
        {
          type: "approval.requested",
          seq: 7,
          eventId: evt(7),
          threadId: other,
          turnId: null,
          at: "t",
          request: payload({
            origin: { ...origin, threadId: other },
            surfaceThreadId: other,
            requestKey: "tool-other",
            title: "Allow bash in another conversation?",
            body: {
              kind: "tool",
              tool: {
                toolName: "bash",
                risk: "execute",
                args: { command: "pwd" },
                argsHash: "h2",
                ruleId: null,
              },
            },
          }),
        },
      ],
    });
    h.store.flush();
    const state = h.store.read.getState();

    // 이동 문맥이 없으면 대화 이름은 글이다(받은 요청이어도)
    expect(cardsOf(render(<InboxApprovals />, state)).map(threadLinkOf)).toEqual([false, false]);
    // 문맥이 있어도 거울에 없는 대화는 링크가 아니다. 이름 없는 글로 보인다
    const inbox = cardsOf(render(<InboxApprovals />, state, goTo));
    expect(inbox.map(threadLinkOf)).toEqual([true, false]);
    expect(inbox[1] ?? "").toContain("대화: 이름 없는 대화");
  });
});

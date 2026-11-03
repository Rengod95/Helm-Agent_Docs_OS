import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { AgentView, SessionService, TurnView } from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { cancelledByOwnerOf } from "../../src/assembly/owner-cancel.ts";
import { partial } from "../fixtures/unsafe.ts";

// L1.tasks.spec §4.8 3번: 재개 때 열린 자식 turn이 소유 사슬(부모 turn)의 취소 의도를 읽는다.

const ids = fixedIdFactory(900);
const ROOT: ThreadId = ids.next("thr");
const CHILD: ThreadId = ids.next("thr");
const ROOT_TURN: TurnId = ids.next("trn");
const CHILD_TURN: TurnId = ids.next("trn");

function sessionOf(
  abortedTurns: readonly TurnId[],
  links: ReadonlyMap<ThreadId, Pick<AgentView, "parentThreadId" | "ownerTurnId" | "background">>,
): SessionService {
  return partial<SessionService>({
    query: partial<SessionService["query"]>({
      turn: (_threadId, turnId) =>
        ok(partial<TurnView>({ turnId, abortRequested: abortedTurns.includes(turnId) })),
      agentOfChild: (threadId) => {
        const link = links.get(threadId);
        return ok(
          link === undefined ? undefined : partial<AgentView>({ childThreadId: threadId, ...link }),
        );
      },
    }),
  });
}

const FOREGROUND = new Map([
  [CHILD, { parentThreadId: ROOT, ownerTurnId: ROOT_TURN, background: false }],
]);

test("a child's open turn is cancelled when the parent turn that owns it has an abort intent", () => {
  const cancelled = cancelledByOwnerOf(sessionOf([ROOT_TURN], FOREGROUND));
  expect(cancelled(CHILD, CHILD_TURN)).toBe(true);
});

test("a live parent turn leaves the child's open turn alone", () => {
  expect(cancelledByOwnerOf(sessionOf([], FOREGROUND))(CHILD, CHILD_TURN)).toBe(false);
});

test("a background child is not cancelled by its parent's turn", () => {
  const background = new Map([
    [CHILD, { parentThreadId: ROOT, ownerTurnId: ROOT_TURN, background: true }],
  ]);
  expect(cancelledByOwnerOf(sessionOf([ROOT_TURN], background))(CHILD, CHILD_TURN)).toBe(false);
});

test("a read failure counts as not cancelled instead of closing the turn", () => {
  const broken = partial<SessionService>({
    query: partial<SessionService["query"]>({
      turn: () => err({ kind: "row_invalid", where: "p_agents" }),
      agentOfChild: () => err({ kind: "row_invalid", where: "p_agents" }),
    }),
  });
  expect(cancelledByOwnerOf(broken)(CHILD, CHILD_TURN)).toBe(false);
});

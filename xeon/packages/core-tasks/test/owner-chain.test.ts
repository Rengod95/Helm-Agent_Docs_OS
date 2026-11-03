import { expect, test } from "bun:test";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import { isCancelledByOwner, type OwnerChainReader, type OwnerLink } from "../src/owner-chain.ts";
import { fixedIdFactory } from "./support/ids.ts";

// 소유 사슬: ROOT(최상위) ← PARENT(자식 thread, 소유 turn = ROOT_TURN) ← CHILD(소유 turn = PARENT_TURN)
const ids = fixedIdFactory();
const ROOT: ThreadId = ids.next("thr");
const PARENT: ThreadId = ids.next("thr");
const CHILD: ThreadId = ids.next("thr");
const ROOT_TURN: TurnId = ids.next("trn");
const PARENT_TURN: TurnId = ids.next("trn");
const CHILD_TURN: TurnId = ids.next("trn");

interface Facts {
  /** turn.abort_requested가 있는 turn */
  readonly aborted: readonly TurnId[];
  readonly owners: ReadonlyMap<ThreadId, OwnerLink>;
}

function readerOf(facts: Facts): OwnerChainReader {
  return {
    turnAbortRequested: (_threadId, turnId) => facts.aborted.includes(turnId),
    ownerOf: (threadId) => facts.owners.get(threadId) ?? null,
  };
}

const LINK_TO_ROOT_TURN: OwnerLink = {
  parentThreadId: ROOT,
  ownerTurnId: ROOT_TURN,
  background: false,
};
const LINK_TO_PARENT_TURN: OwnerLink = {
  parentThreadId: PARENT,
  ownerTurnId: PARENT_TURN,
  background: false,
};

test("a cancelled owner turn makes the open child turn cancelled", () => {
  const reader = readerOf({
    aborted: [PARENT_TURN],
    owners: new Map([[CHILD, LINK_TO_PARENT_TURN]]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(true);
});

test("a cancelled grandparent turn reaches through a live parent", () => {
  const reader = readerOf({
    aborted: [ROOT_TURN],
    owners: new Map([
      [CHILD, LINK_TO_PARENT_TURN],
      [PARENT, LINK_TO_ROOT_TURN],
    ]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(true);
});

test("no cancelled turn on the chain gives false", () => {
  const reader = readerOf({
    aborted: [],
    owners: new Map([
      [CHILD, LINK_TO_PARENT_TURN],
      [PARENT, LINK_TO_ROOT_TURN],
    ]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

test("the turn's own abort intent counts without any owner link", () => {
  const reader = readerOf({ aborted: [CHILD_TURN], owners: new Map() });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(true);
});

test("a background boundary on the child's own link stops the owner's cancel", () => {
  const reader = readerOf({
    aborted: [PARENT_TURN],
    owners: new Map([[CHILD, { ...LINK_TO_PARENT_TURN, background: true }]]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

test("a background boundary higher up stops the walk before the grandparent", () => {
  const reader = readerOf({
    aborted: [ROOT_TURN],
    owners: new Map([
      [CHILD, LINK_TO_PARENT_TURN],
      [PARENT, { ...LINK_TO_ROOT_TURN, background: true }],
    ]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

test("a non-turn owner (scope or drive) ends the chain without reading other turns", () => {
  const reader = readerOf({
    aborted: [PARENT_TURN],
    owners: new Map([[CHILD, { parentThreadId: PARENT, ownerTurnId: null, background: false }]]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

test("a missing owner link for the child ends the chain as not cancelled", () => {
  const reader = readerOf({ aborted: [PARENT_TURN], owners: new Map() });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

test("a cycle in owner links terminates as not cancelled", () => {
  const reader = readerOf({
    aborted: [],
    owners: new Map([
      [CHILD, LINK_TO_PARENT_TURN],
      [PARENT, { parentThreadId: CHILD, ownerTurnId: CHILD_TURN, background: false }],
    ]),
  });
  expect(isCancelledByOwner(reader, CHILD, CHILD_TURN)).toBe(false);
});

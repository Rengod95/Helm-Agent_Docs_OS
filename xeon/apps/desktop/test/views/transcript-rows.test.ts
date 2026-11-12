import { describe, expect, test } from "bun:test";
import type { ItemId } from "@fresnel/contracts/conversation";
import type { AnchoredCompaction } from "../../src/state/engine/compaction-anchor.ts";
import type { ConvoMarker } from "../../src/state/engine/convo.ts";
import type { ItemShape, ShapeBlock } from "../../src/state/engine/index.ts";
import type { CompactionRecord } from "../../src/state/engine/state.ts";
import {
  transcriptRowsOf,
  type LeadRef,
  type TranscriptRow,
  type TurnRef,
} from "../../src/views/transcript-rows.ts";
import { evt, itm, thr, trn } from "../state/helpers.ts";

// 대화 줄 모델(L4 desktop-ux §16.2): 줄 종류, 묶음, 키, 턴 발 줄, 변화 표지, 주도 구간. 값으로 비교한다.

function recordOf(n: number): CompactionRecord {
  return {
    threadId: thr(1),
    eventId: evt(n),
    at: "2026-11-07T00:00:00.000Z",
    summary: `요약 ${n}`,
    tokensBefore: 1,
    tokensAfter: null,
    reason: null,
  };
}

const anchor = (n: number, after: ItemId | null): AnchoredCompaction => ({
  record: recordOf(n),
  after,
});

const user = (n: number): ItemShape => ({ kind: "user", id: itm(n) });
const text = (index: number): ShapeBlock => ({ kind: "text", index });
const thinking = (index: number): ShapeBlock => ({ kind: "thinking", index });
const call = (index: number, callId: string, name: string): ShapeBlock => ({
  kind: "call",
  index,
  callId,
  name,
  args: {},
});
const assistant = (n: number, ...blocks: ShapeBlock[]): ItemShape => ({
  kind: "assistant",
  id: itm(n),
  blocks,
});
const hidden = (n: number): ItemShape => ({ kind: "hidden", id: itm(n) });

const turn = (
  n: number,
  startedSeq: number,
  inputs: readonly number[],
  running = false,
): TurnRef => ({
  turnId: trn(n),
  startedSeq,
  inputItemIds: inputs.map(itm),
  running,
});

const marker = (seq: number, model: string): ConvoMarker => ({
  seq,
  at: "2026-11-07T00:00:00.000Z",
  change: { kind: "model", model },
});

const BASE = {
  live: [],
  showLive: true,
  anchors: [],
  turns: [],
  markers: [],
  leads: [],
  running: false,
} as const;

function rowsOf(input: Partial<Parameters<typeof transcriptRowsOf>[0]>): readonly TranscriptRow[] {
  return transcriptRowsOf({ ...BASE, shapes: [], ...input });
}

const keys = (rows: readonly TranscriptRow[]): readonly string[] => rows.map((row) => row.key);
const kinds = (rows: readonly TranscriptRow[]): readonly string[] => rows.map((row) => row.kind);

describe("transcriptRowsOf: 줄 종류와 묶음", () => {
  test("이어지는 도구 호출은 한 묶음이고, 호출 사이 생각은 묶음에 든다. 키는 첫 호출 id다", () => {
    const rows = rowsOf({
      shapes: [
        user(1),
        assistant(2, thinking(0), call(1, "c1", "read")),
        hidden(3),
        assistant(4, thinking(0), call(1, "c2", "grep"), call(2, "c3", "bash")),
        hidden(5),
        assistant(6, text(0)),
      ],
    });
    expect(kinds(rows)).toEqual(["user", "activity", "reply", "turnFoot"]);
    expect(keys(rows)).toEqual([itm(1), "act:c1", itm(6), `foot:${itm(1)}`]);
    const group = rows[1];
    expect(
      group?.kind === "activity" ? group.entries.map((e) => [e.itemId, e.block.kind]) : null,
    ).toEqual([
      [itm(2), "thinking"],
      [itm(2), "call"],
      [itm(4), "thinking"],
      [itm(4), "call"],
      [itm(4), "call"],
    ]);
  });

  test("글 앞 생각은 같은 item의 답 줄 머리로 들어간다", () => {
    const rows = rowsOf({ shapes: [user(1), assistant(2, thinking(0), text(1))] });
    expect(rows[1]).toEqual({
      kind: "reply",
      key: itm(2),
      lead: null,
      id: itm(2),
      blocks: [thinking(0), text(1)],
    });
  });

  test("결과물 도구는 묶음을 끊고 카드 한 줄이다. 파일 변경 도구는 혼자 한 묶음이다. 답 글도 턴도 없으면 턴 발 줄이 없다", () => {
    const rows = rowsOf({
      shapes: [
        user(1),
        assistant(2, call(0, "c1", "read"), call(1, "c2", "agent"), call(2, "c3", "read")),
        assistant(3, call(0, "c4", "edit"), call(1, "c5", "read")),
      ],
    });
    expect(keys(rows)).toEqual([itm(1), "act:c1", "card:c2", "act:c3", "act:c4", "act:c5"]);
    expect(rows[2]).toMatchObject({ kind: "card", itemId: itm(2), call: { name: "agent" } });
  });

  test("한 item 안 두 번째 글 줄은 item id 뒤에 블록 자리를 붙인 키다", () => {
    const rows = rowsOf({
      shapes: [user(1), assistant(2, text(0), call(1, "c1", "read"), text(2))],
    });
    expect(keys(rows)).toEqual([itm(1), itm(2), "act:c1", `${itm(2)}:2`, `foot:${itm(1)}`]);
  });

  test("사용자 줄은 바로 앞 item을 든다(고쳐 보내기의 되감기 자리)", () => {
    const rows = rowsOf({ shapes: [user(1), assistant(2, text(0)), hidden(3), user(4)] });
    const users = rows.filter((row) => row.kind === "user");
    expect(users.map((row) => ("prevId" in row ? row.prevId : "x"))).toEqual([null, itm(3)]);
  });
});

describe("transcriptRowsOf: 키 안정", () => {
  test("진행 중 줄의 키는 item id이고, 확정된 첫 글 줄과 같다", () => {
    const streaming = rowsOf({ shapes: [user(1)], live: [itm(2)], running: true });
    const recorded = rowsOf({ shapes: [user(1), assistant(2, text(0))], live: [itm(2)] });
    expect(keys(streaming)).toEqual([itm(1), itm(2)]);
    expect(streaming[1]?.kind).toBe("live");
    expect(keys(recorded)).toEqual([itm(1), itm(2), `foot:${itm(1)}`]);
    expect(recorded[1]?.kind).toBe("reply");
  });

  test("진행 중 줄은 대화가 읽히기 전에는 빠진다", () => {
    const rows = rowsOf({ shapes: [user(1)], live: [itm(9)], showLive: false, running: true });
    expect(keys(rows)).toEqual([itm(1)]);
  });

  test("묶음이 커져도 키는 첫 호출 id 그대로다", () => {
    const one = rowsOf({ shapes: [user(1), assistant(2, call(0, "c1", "read"))], running: true });
    const two = rowsOf({
      shapes: [user(1), assistant(2, call(0, "c1", "read")), assistant(3, call(0, "c2", "read"))],
      running: true,
    });
    expect(keys(one)).toEqual([itm(1), "act:c1"]);
    expect(keys(two)).toEqual([itm(1), "act:c1"]);
  });
});

describe("transcriptRowsOf: 턴과 표지", () => {
  test("턴은 입력 item으로 갈리고, 끝난 턴 뒤에만 턴 발 줄이 선다", () => {
    const rows = rowsOf({
      shapes: [user(1), assistant(2, text(0)), user(3), assistant(4, text(0))],
      turns: [turn(1, 10, [1]), turn(2, 20, [3], true)],
      running: true,
    });
    expect(keys(rows)).toEqual([itm(1), itm(2), `foot:${trn(1)}`, itm(3), itm(4)]);
    expect(rows[2]).toEqual({
      kind: "turnFoot",
      key: `foot:${trn(1)}`,
      lead: null,
      turnId: trn(1),
      replyId: itm(2),
    });
  });

  test("변화 표지는 seq 뒤 첫 턴 앞에, 어느 턴보다 늦으면 끝에 선다", () => {
    const rows = rowsOf({
      shapes: [user(1), assistant(2, text(0)), user(3), assistant(4, text(0))],
      turns: [turn(1, 10, [1]), turn(2, 20, [3])],
      markers: [marker(15, "m-2"), marker(30, "m-3")],
    });
    expect(keys(rows)).toEqual([
      itm(1),
      itm(2),
      `foot:${trn(1)}`,
      "mark:15",
      itm(3),
      itm(4),
      `foot:${trn(2)}`,
      "mark:30",
    ]);
  });

  test("요약 구분선은 자리 item 뒤에, 자리가 없으면 맨 앞에 선다. 묶음 안 item 자리는 묶음 뒤다", () => {
    const rows = rowsOf({
      shapes: [user(1), assistant(2, call(0, "c1", "read")), assistant(3, call(0, "c2", "read"))],
      anchors: [anchor(1, itm(2)), anchor(2, null)],
    });
    expect(keys(rows)).toEqual([`compact:${evt(2)}`, itm(1), "act:c1", `compact:${evt(1)}`]);
  });

  test("주도 구간은 첫 턴 앞에 머리, 마지막 턴 뒤에 끝 줄이 서고, 그 사이 줄은 구간 id를 든다", () => {
    const lead: LeadRef = { leaseId: "lease-1", turnIds: [trn(2), trn(3)] };
    const rows = rowsOf({
      shapes: [
        user(1),
        assistant(2, text(0)),
        hidden(3),
        assistant(4, text(0)),
        hidden(5),
        assistant(6, text(0)),
      ],
      turns: [turn(1, 10, [1]), turn(2, 20, [3]), turn(3, 30, [5])],
      leads: [lead],
    });
    expect(rows.map((row) => [row.key, row.lead])).toEqual([
      [itm(1), null],
      [itm(2), null],
      [`foot:${trn(1)}`, null],
      ["lead:lease-1", "lease-1"],
      [itm(4), "lease-1"],
      [`foot:${trn(2)}`, "lease-1"],
      [itm(6), "lease-1"],
      [`foot:${trn(3)}`, "lease-1"],
      ["lead-end:lease-1", null],
    ]);
  });

  test("빈 대화는 줄이 없다", () => {
    expect(rowsOf({})).toEqual([]);
  });
});

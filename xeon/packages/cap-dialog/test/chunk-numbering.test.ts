import { expect, test } from "bun:test";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createChunkNumbering } from "../src/chunk-numbering.ts";

// 발급기는 (threadId, turnId) 키마다 0부터 1씩 센다(F.records.spec §4.3). 키의 한쪽이라도 다르면 따로 센다.

test("번호는 (thread, turn) 키마다 0부터 1씩 오르고 키가 다르면 따로 센다", () => {
  const ids = fixedIdFactory(1);
  const threadA = ids.next("thr");
  const threadB = ids.next("thr");
  const turn = ids.next("trn");
  const numbering = createChunkNumbering();
  expect([
    numbering.next(threadA, null),
    numbering.next(threadA, null),
    numbering.next(threadA, turn),
    numbering.next(threadB, null),
    numbering.next(threadA, null),
    numbering.next(threadA, turn),
  ]).toEqual([0, 1, 0, 0, 2, 1]);
});

test("발급기마다 따로 센다", () => {
  const thread = fixedIdFactory(1).next("thr");
  const first = createChunkNumbering();
  const second = createChunkNumbering();
  expect([first.next(thread, null), first.next(thread, null), second.next(thread, null)]).toEqual([
    0, 1, 0,
  ]);
});

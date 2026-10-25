import { expect, test } from "bun:test";
import type { ApprovalBody, ApprovalRequestInput } from "@xeon/contracts/services";
import { fakeApprovals } from "../src/testing/index.ts";
import { eachInOrder } from "../src/util.ts";
import { expectOk } from "./support/harness.ts";

// L7(통합 검토): 해결된 요청은 상한까지만 메모리 표에 남는다. 대기 중인 요청은 빼지 않고, 빠진 요청은 기록에서 되찾는다.

const QUESTION: ApprovalBody = {
  kind: "question",
  question: {
    questions: [
      { id: "note", text: "Anything?", options: [], multiSelect: false, allowFreeText: true },
    ],
  },
};

test("the oldest resolved requests leave memory first, pending ones stay, and a reopened key adopts the stored resolution", async () => {
  const kept = 3;
  const fake = await fakeApprovals({ resolvedKept: kept });
  const thread = fake.ids.next("thr");
  await fake.openThread(thread);
  const origin = fake.originOf(thread);
  const input = (key: string): ApprovalRequestInput => ({
    origin,
    requestKey: key,
    title: key,
    body: QUESTION,
    remember: ["once"],
  });

  // 해결하지 않은 첫 요청
  const waiting = expectOk(await fake.approvals.open(input("k0")));

  // kept + 4개를 차례로 열고 해결한다: 해결 순서 k1..k7 중 k1..k4가 빠지고 k5..k7이 남는다
  const keys = Array.from({ length: kept + 4 }, (_unused, index) => `k${String(index + 1)}`);
  const idByKey = new Map<string, string>();
  await eachInOrder(keys, async (key) => {
    const opened = expectOk(await fake.approvals.open(input(key)));
    idByKey.set(key, opened.request.approvalId);
    const applied = await fake.approvals.respond(opened.request.approvalId, {
      decision: "answer",
      answer: { note: { selected: [], text: `answer ${key}` } },
    });
    expect(applied).toEqual({ applied: true });
  });

  const stillKnown = keys.filter((key) => fake.approvals.get(idByKey.get(key) ?? "") !== undefined);
  expect(stillKnown).toEqual(["k5", "k6", "k7"]);
  expect(fake.approvals.get(waiting.request.approvalId)?.resolution).toBeNull();
  expect(fake.approvals.pending(thread).map((request) => request.approvalId)).toEqual([
    waiting.request.approvalId,
  ]);

  // 빠진 요청에는 응답을 적용하지 않는다
  const evictedId = idByKey.get("k1") ?? "";
  expect(await fake.approvals.respond(evictedId, { decision: "deny" })).toEqual({
    applied: false,
  });

  // 기록은 남아 있다: 같은 키로 다시 열면 새 이벤트 없이 같은 approvalId와 저장된 해결을 이어 받는다
  const eventsBefore = fake.session.events.length;
  const again = expectOk(await fake.approvals.open(input("k1")));
  expect(again.request.approvalId).toBe(evictedId);
  expect(again.resolution).toMatchObject({
    decision: "answer",
    resolvedBy: "user",
    answer: { note: { selected: [], text: "answer k1" } },
  });
  expect(fake.session.events.length).toBe(eventsBefore);
});

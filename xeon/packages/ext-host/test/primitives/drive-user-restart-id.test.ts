// S-06(AGE-77): 재시작 뒤 사용자 메시지로 여는 turn의 요청 id가 재시작 전 메시지의 turn과 겹치지 않는다.
// 겹치면 루프가 `turn_exists`로 옛 turn을 재생하고 새 turn은 열리지 않는데, 메시지는 처리된 것으로 정착해 묻혔다.
import { expect, test } from "bun:test";
import type { DriveCommand, PostItem } from "@fresnel/contracts/extensions";
import { createTestHost, fixedIdFactory, type MemoryLoopOptions } from "../../src/testing/index.ts";
import { makeOrchestrationUnit } from "./fixtures/support.ts";

const ids = fixedIdFactory(9800);
const TURN = ids.next("trn");
const SCRIPTED: MemoryLoopOptions = {
  runTurn: () => Promise.resolve({ outcome: { turnId: TURN, status: "completed" }, usage: null }),
};
type Command = DriveCommand<never>;

const unit = () =>
  makeOrchestrationUnit({ name: "ui-r" }, (g) => {
    g.drive(({ last }) => {
      if (last !== null && last.kind === "user")
        return Promise.resolve<Command>({ do: "turn", input: last.message });
      return Promise.resolve<Command>({ do: "yield" });
    });
  });

test("a user turn opened after a restart gets a request id different from the turns before it", async () => {
  const first = await createTestHost({ loop: SCRIPTED });
  const thread = first.newThread();
  await first.host.install(unit());
  await first.host.openThread(thread);
  first.host.startDrive(thread, "ui-r");
  await first.settled();
  const one: PostItem = { kind: "user", content: "one" };
  expect(await first.host.claimUserInput(thread, one, "msg-1")).toBe(true);
  await first.settled();
  expect(first.loop.turns.map((turn) => turn.input)).toEqual([one]);

  await first.host.dispose();
  const second = await first.restart();
  await second.host.install(unit());
  await second.host.openThread(thread);
  await second.settled();
  const two: PostItem = { kind: "user", content: "two" };
  expect(await second.host.claimUserInput(thread, two, "msg-2")).toBe(true);
  await second.settled();
  expect(second.loop.turns.map((turn) => turn.input)).toEqual([one, two]);

  const [firstTurn, secondTurn] = second.loop.turns;
  expect(firstTurn?.requestId).not.toBe(secondTurn?.requestId);
});

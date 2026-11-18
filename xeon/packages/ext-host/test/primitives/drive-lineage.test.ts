// REQ-X-04 drive 락 계통 id. 3a 엔진에서 계통 id(`lineageId`)는 임대 id(`leaseId`)와 같다. 부여마다 새 임대 id가 나오므로
// 시작 요청으로 다시 준 임대는 새 임대라 새 turn 키를 연다. 기본 키(`turn`·`spawn`)는 계통 id로 만든다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveCommand } from "@fresnel/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

/** 상태가 없는 그룹의 명령(S가 never) */
type Command = DriveCommand<never>;

function yieldOf(): Command {
  return { do: "yield" };
}

function turnOf(content: string): Command {
  return { do: "turn", input: { kind: "user", content } };
}

/** 사용자 명령으로 주도 시작을 요청하고 거부가 없었는지 확인한다 */
function requestDrive(t: Host, thread: ThreadId, scopeId: string): void {
  expect(t.host.startDrive(thread, scopeId)).toEqual({ ok: true, value: undefined });
}

function turnKeys(t: Host): string[] {
  return t.loop.turns.map((turn) => turn.requestId);
}

/** 부여마다 새 임대 id가 나온다. 계통 id는 3a에서 임대 id와 같으므로 앞 부여와 겹치지 않는다 */
function expectNewLease(t: Host, thread: ThreadId, index: number): void {
  const grant = acquiredOf(t, thread)[index];
  expect(grant?.lineageId).toBe(grant?.leaseId);
  const earlier = acquiredOf(t, thread).slice(0, index);
  expect(earlier.map((other) => other.leaseId)).not.toContain(grant?.leaseId);
}

test("a drive that returns without committing and is granted again at the same rev gets a new turn", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeGroupUnit({ name: "lin-idle" }, (g) => {
      // 첫 단계는 turn을 내고, 그 결과를 받은 단계는 효과 없이 끝낸다
      g.drive(({ last }) => Promise.resolve(last === null ? turnOf("go") : yieldOf()));
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "lin-idle");
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);
  // 같은 판으로 효과 없이 반환을 거듭하면 idle로 반납된다. 같은 drive 락 안의 재호출은 같은 키라 재생이다
  await t.boundary(thread).turnSettled();
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["idle"]);
  expect(t.loop.turns).toHaveLength(1);

  // 시작 요청이 있어야 다시 부여된다. 새 임대라 새 임대 id이고, 같은 판이어도 새 키라 turn이 다시 열린다.
  // 임대 id를 키에서 빼면 옛 결과가 재생되어 이 drive는 멈춘다
  requestDrive(t, thread, "lin-idle");
  await t.settled();
  const acquired = acquiredOf(t, thread);
  expect(acquired).toHaveLength(2);
  expectNewLease(t, thread, 1);
  const [first, second] = acquired;
  expect(turnKeys(t)).toEqual([`${first?.lineageId}:0.0`, `${second?.lineageId}:0.0`]);
  expect(first?.leaseId).not.toBe(second?.leaseId);
});

test("a re-grant after a budget release gets a new lease and a new turn key", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeGroupUnit({ name: "lin-budget" }, (g) => {
      // 첫 turn 뒤 둘째 turn을 낸다. 한도(1)를 넘는 둘째 turn이 budget으로 임대를 반납하게 한다
      g.drive(
        ({ last }) => {
          if (last === null) return Promise.resolve(turnOf("one"));
          if (last.kind === "ok") return Promise.resolve(turnOf("two"));
          return Promise.resolve(yieldOf());
        },
        { limits: { maxTurns: 1 } },
      );
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  t.host.startDrive(thread, "lin-budget");
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(releasedOf(t, thread)[0]?.reason).toBe("budget");
  requestDrive(t, thread, "lin-budget");
  await t.settled();
  expect(acquiredOf(t, thread)).toHaveLength(2);
  expectNewLease(t, thread, 1);
  const [first, second] = acquiredOf(t, thread);
  expect(turnKeys(t)).toEqual([`${first?.lineageId}:0.0`, `${second?.lineageId}:0.0`]);
});

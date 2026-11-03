// REQ-X-04 drive 락 계통 id. `leaseId`는 부여마다 새로 발급하고, 기본 키(`loop.turn`·`loop.spawn`)는 계통 id로 만든다.
// `waiting` 반납 바로 뒤의 같은 Registration 부여만 계통을 잇고, 그 밖의 재부여는 새 계통이라 새 turn을 연다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { RegistrationId } from "@fresnel/contracts/extensions";
import {
  createStaticPrimitivesSettings,
  type PrimitivesSettingsSource,
} from "../../src/primitives/settings.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { acquiredOf, releasedOf, type Host } from "./fixtures/fake-approvals.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

function turnKeys(t: Host): string[] {
  return t.loop.turns.map((turn) => turn.requestId);
}

function expectNewLineage(t: Host, thread: ThreadId, index: number): void {
  const grant = acquiredOf(t, thread)[index];
  expect(grant?.lineageId).toBe(grant?.leaseId);
  const earlier = acquiredOf(t, thread).slice(0, index);
  expect(earlier.map((other) => other.lineageId)).not.toContain(grant?.lineageId);
}

test("a drive that returns without committing and is granted again at the same rev gets a new turn", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeGroupUnit({ name: "lin-idle" }, (g) => {
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: "go" } });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.loop.turns).toHaveLength(1);
  // 같은 판으로 효과 없이 반환을 거듭하면 idle로 반납된다. 같은 drive 락 안의 재호출은 같은 키라 재생이다
  await t.boundary(thread).turnSettled();
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["idle"]);
  expect(t.loop.turns).toHaveLength(1);

  // 다시 부여된 drive 락은 `waiting` 뒤가 아니므로 새 계통이고, 같은 판이어도 새 키라 turn이 다시 열린다.
  // 계통 id를 키에서 빼면 옛 결과가 재생되어 이 drive는 멈춘다
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  const acquired = acquiredOf(t, thread);
  expect(acquired).toHaveLength(2);
  expectNewLineage(t, thread, 1);
  const [first, second] = acquired;
  expect(turnKeys(t)).toEqual([`${first?.lineageId}:0.0`, `${second?.lineageId}:0.0`]);
  expect(first?.lineageId).not.toBe(second?.lineageId);
});

test("a re-grant after a budget release starts a new lineage", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeGroupUnit({ name: "lin-budget" }, (g) => {
      g.drive(
        async (loop) => {
          await loop.turn({ input: { kind: "user", content: "one" } });
          await loop.turn({ input: { kind: "user", content: "two" } });
        },
        { limits: { maxTurns: 1 } },
      );
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.boundary(thread).idle();
  await t.settled();
  expect(releasedOf(t, thread)[0]?.reason).toBe("budget");
  expect(acquiredOf(t, thread).length).toBeGreaterThanOrEqual(2);
  expectNewLineage(t, thread, 1);
  const [first, second] = acquiredOf(t, thread);
  expect(turnKeys(t)).toEqual([`${first?.lineageId}:0.0`, `${second?.lineageId}:0.0`]);
});

test("a re-grant after another group revoked the lock starts a new lineage", async () => {
  let chosen: RegistrationId | null = "lin-one";
  const source: PrimitivesSettingsSource = {
    ...createStaticPrimitivesSettings(),
    activeDriver: () => chosen,
  };
  const t = await createTestHost({ settingsSource: source });
  await Promise.all(
    ["lin-one", "lin-two"].map((name, loadIndex) =>
      t.host.install(
        makeGroupUnit({ name, loadIndex }, (g) => {
          g.drive(async (loop) => {
            await loop.turn({ input: { kind: "user", content: name } });
          });
        }),
      ),
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  chosen = "lin-two";
  await t.boundary(thread).turnSettled();
  await t.settled();
  chosen = "lin-one";
  await t.boundary(thread).turnSettled();
  await t.settled();

  expect(releasedOf(t, thread).map((released) => released.reason)).toEqual(["revoked", "revoked"]);
  const acquired = acquiredOf(t, thread);
  expect(acquired.map((grant) => grant.scopeId)).toEqual(["lin-one", "lin-two", "lin-one"]);
  acquired.forEach((_, index) => {
    expectNewLineage(t, thread, index);
  });
  expect(turnKeys(t)).toEqual(acquired.map((grant) => `${grant.lineageId}:0.0`));
});

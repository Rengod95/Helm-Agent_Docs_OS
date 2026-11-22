import { expect, test } from "bun:test";
import { createTestHost } from "../../src/testing/index.ts";
import { makeOrchestrationUnit } from "./fixtures/support.ts";

// M5c §4.3.5, §9.1: 검토본 단위의 판 식별자(`ExtensionUnit.contentHash`)는 그 단위가 쌓는 Drive 프레임의 `lease.acquired.contentHash`가 되고,
// 재시작 뒤 복원된 프레임이 같은 값을 `drive.frames`(`versionId`)로 보인다. 같은 시작 요청을 연달아 넣어도 부여는 한 번이다.

const HASH = "sha256:" + "d".repeat(64);

test("a reviewed unit's contentHash is recorded on lease.acquired and the restored frame keeps it", async () => {
  const unitOf = () => ({
    ...makeOrchestrationUnit({ name: "hashed-drive" }, (g) => {
      g.drive(async () => ({ do: "yield" }));
    }),
    contentHash: HASH,
  });
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(unitOf());
  await first.host.openThread(thread, { startDrive: "hashed-drive" });
  await first.settled();
  const acquired = first.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquired).toHaveLength(1);
  expect(acquired[0]?.payload).toMatchObject({ scopeId: "hashed-drive", contentHash: HASH });

  // 재시작: 열린 임대가 복원되고 프레임의 versionId가 기록의 판 식별자다
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await second.host.install(unitOf());
  await second.host.openThread(thread);
  await second.settled();
  expect(second.host.driveFrames(thread).map((frame) => [frame.plugin, frame.versionId])).toEqual([
    [null, null],
    ["hashed-drive", HASH],
  ]);
});

test("a unit without a contentHash records no contentHash on lease.acquired", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(
    makeOrchestrationUnit({ name: "plain-drive" }, (g) => {
      g.drive(async () => ({ do: "yield" }));
    }),
  );
  await first.host.openThread(thread, { startDrive: "plain-drive" });
  await first.settled();
  const acquired = first.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquired).toHaveLength(1);
  expect(acquired[0]?.payload).not.toHaveProperty("contentHash");
});

test("the same start request given twice before the boundary is queued once, so the drive is granted once", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(
    makeOrchestrationUnit({ name: "dup-start" }, (g) => {
      g.drive(async () => ({ do: "done" }));
    }),
  );
  await first.host.openThread(thread);
  first.host.startDrive(thread, "dup-start", { trigger: "user" });
  first.host.startDrive(thread, "dup-start", { trigger: "user" });
  await first.settled();
  // 두 번째 요청이 남았다면 첫 주도가 끝난 뒤 한 번 더 부여되어 임대가 두 번 생긴다
  const acquired = first.records.events(thread).filter((e) => e.kind === "lease.acquired");
  expect(acquired).toHaveLength(1);
  const released = first.records.events(thread).filter((e) => e.kind === "lease.released");
  expect(released).toHaveLength(1);
});

import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { createGroupService, defineGroup, groupCommand, type GroupModule } from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

/** 쓰기 전 판의 스키마. 0 이상이면 된다 */
const LOOSE = Type.Object({ n: Type.Integer({ minimum: 0 }) });
/** 다시 연 판의 스키마. 10 이상이어야 한다. 저장된 {n: 4}를 거부한다 */
const STRICT = Type.Object({ n: Type.Integer({ minimum: 10 }) });

/** 경계마다 상태를 {n: 4}로 쓰는 그룹. 옛 판을 남긴다 */
function writer(name: string): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, points: ["boundary.settle.after"] }),
    state: { schema: LOOSE, initial: { n: 0 }, version: 1 },
    setup(g) {
      g.on("boundary.settle.after", async () => {
        await g.commit({ n: 4 });
      });
    },
  });
}

/** 저장 상태를 거부하고 선언 초기값을 쓰는 그룹. 핸들러가 본 상태를 모은다 */
function strictGroup(name: string, seen: unknown[]): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, points: ["boundary.settle.after"] }),
    state: { schema: STRICT, initial: { n: 10 }, version: 1 },
    setup(g) {
      g.on("boundary.settle.after", () => {
        seen.push(g.state());
      });
    },
  });
}

function serviceOf(t: TestHost, modules: readonly GroupModule[], thread: ThreadId | null) {
  return createGroupService({
    host: t.host,
    catalog: groupCatalogOf(modules),
    holder: memoryDriveHolderSettings(),
    currentThread: () => thread,
    report: () => undefined,
  });
}

/** 쓰기 그룹으로 {n: 4}를 한 판 저장하고, 옛 호스트를 재시작한 새 호스트와 thread를 돌려준다 */
async function brokenByStricterSchema(
  name: string,
): Promise<{ second: TestHost; thread: ThreadId }> {
  const first = await createTestHost();
  const thread = first.newThread();
  await install(first, writer(name));
  await first.host.openThread(thread);
  await first.settled();
  await first.host.dispatch(
    "boundary.settle.after",
    { turnId: first.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "seed" },
  );
  await first.settled();
  const second = await first.restart();
  return { second, thread };
}

test("reset.command-restores-the-declared-initial-and-the-group-runs-at-the-next-boundary", async () => {
  const { second, thread } = await brokenByStricterSchema("stateful");
  const seen: unknown[] = [];
  await install(second, strictGroup("stateful", seen));
  await second.host.openThread(thread);
  await second.settled();
  const service = serviceOf(second, [strictGroup("stateful", seen)], thread);
  const command = groupCommand(service);

  // 저장 상태가 거부되어 그룹 상태에 오류가 남는다
  expect(service.status("stateful")).toMatchObject({
    ok: true,
    value: { scope: "enabled", lastError: { kind: "group.stateInvalid" } },
  });

  // 재설정 명령은 초기값을 새 판으로 쓰고 오류를 지운다. 명령은 켜기 상태를 바꾸지 않는다
  expect(await command.run("reset stateful")).toEqual({
    ok: true,
    text: "stateful: 저장 상태를 초기값으로 되돌렸습니다. /group on stateful로 다시 켜세요.",
    pending: false,
  });
  expect(service.status("stateful")).toMatchObject({
    ok: true,
    value: { scope: "enabled", lastError: null },
  });
  // 판은 1에서 2로 올라가고 그 값은 선언 초기값이다
  const committed = second.records
    .events(thread)
    .filter((draft) => draft.kind === "grp.stateful.state.committed")
    .map((draft) => draft.payload);
  expect(committed).toMatchObject([
    { rev: 1, version: 1, doc: { n: 4 } },
    { rev: 2, version: 1, doc: { n: 10 } },
  ]);

  // 다음 단계 경계 뒤 핸들러가 초기값으로 돈다. /group on 없이도 그렇다(X가 적용을 예약한다)
  await second.boundary(thread).stepEnd();
  await second.host.dispatch(
    "boundary.settle.after",
    { turnId: second.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "after-reset" },
  );
  await second.settled();
  expect(seen).toEqual([{ n: 10 }]);
});

test("reset.error-kinds", async () => {
  const { second, thread } = await brokenByStricterSchema("stateful");
  const seen: unknown[] = [];
  const healthy = defineGroup({ manifest: groupManifestOf({ name: "healthy" }), setup() {} });
  await install(second, strictGroup("stateful", seen));
  await install(second, healthy);
  await second.host.openThread(thread);
  await second.settled();
  const modules = [strictGroup("stateful", seen), healthy];
  const service = serviceOf(second, modules, thread);

  // 설치되지 않은 이름
  expect(await service.resetState("nobody")).toEqual({
    ok: false,
    error: { kind: "group.unknown", id: "nobody", known: ["stateful", "healthy"] },
  });
  // 오류가 없는 그룹은 되돌릴 것이 없다
  expect(await service.resetState("healthy")).toEqual({
    ok: false,
    error: { kind: "group.notResettable", id: "healthy" },
  });
  // 현재 thread가 없다
  expect(await serviceOf(second, modules, null).resetState("stateful")).toEqual({
    ok: false,
    error: { kind: "group.noThread" },
  });
  // 열리지 않은 thread를 가리키면 X가 거부하고 그 이유를 싣는다
  const closed = second.newThread();
  expect(await serviceOf(second, modules, closed).resetState("stateful")).toEqual({
    ok: false,
    error: { kind: "group.resetFailed", id: "stateful", message: "thread_not_open" },
  });
  // 명령 문장으로 보면 같은 이유가 한 줄로 나온다
  const command = groupCommand(service);
  expect(await command.run("reset healthy")).toEqual({
    ok: false,
    text: "healthy 그룹은 되돌릴 저장 상태 오류가 없다",
    pending: false,
  });
  expect(await command.run("reset")).toEqual({
    ok: false,
    text: "사용법: /group status [이름] | on <이름> | off <이름> | drive <이름|auto> | reset <이름>",
    pending: false,
  });
  // 실패한 재설정은 저장 상태를 건드리지 않는다
  expect(seen).toEqual([]);
});

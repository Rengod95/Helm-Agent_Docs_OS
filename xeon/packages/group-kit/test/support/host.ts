import type { ThreadId } from "@xeon/contracts/conversation";
import { LeaseArbiterPortKey } from "@xeon/contracts/extensions";
import { withDriveDefaults } from "@xeon/ext-host";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import {
  createGroupService,
  type GroupModule,
  type GroupServiceWithSetting,
} from "../../src/index.ts";
import {
  groupCatalogOf,
  memoryDriveHolderSettings,
  type MemoryDriveHolderSettings,
} from "../../src/testing/index.ts";

export function install(
  t: TestHost,
  module: GroupModule,
  loadIndex = 0,
): ReturnType<TestHost["host"]["install"]> {
  return t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex,
    builtin: true,
  });
}

/** agent_settled 지점을 한 번 발화한다. 이 지점에 on을 건 그룹의 핸들러가 부른다 */
export function fireSettled(t: TestHost, thread: ThreadId, key: string): Promise<unknown> {
  return t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

/** 로드 순서(loadIndex)를 지키려고 하나씩 설치한다 */
async function installInOrder(
  t: TestHost,
  modules: readonly GroupModule[],
  index = 0,
): Promise<void> {
  const [first, ...rest] = modules;
  if (first === undefined) return;
  await install(t, first, index);
  await installInOrder(t, rest, index + 1);
}

/** GroupService 시험이 쓰는 호스트 묶음: 구동 그룹 설정을 X와 서비스가 같은 값으로 읽는다 */
export interface ServiceRig {
  readonly t: TestHost;
  readonly thread: ThreadId;
  readonly holder: MemoryDriveHolderSettings;
  readonly service: GroupServiceWithSetting;
  readonly reported: unknown[];
}

export async function serviceRig(modules: readonly GroupModule[]): Promise<ServiceRig> {
  const holder = memoryDriveHolderSettings();
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => holder.read(null),
      capabilityProviders: () => ({}),
    },
  });
  const thread = t.newThread();
  const reported: unknown[] = [];
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf(modules),
    holder,
    currentThread: () => thread,
    report: (cause) => {
      reported.push(cause);
    },
  });
  await t.host.registerPlatform({
    name: "xeon-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, service);
    },
  });
  await installInOrder(t, modules);
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread, holder, service, reported };
}

import type { ThreadId } from "@fresnel/contracts/conversation";
import { withDriveDefaults } from "@fresnel/ext-host";
import { createTestHost, type TestHost } from "@fresnel/ext-host/testing";
import {
  createOrchestrationService,
  type OrchestrationModule,
  type OrchestrationServiceWithUsage,
  type OrchestrationStatus,
} from "../../src/index.ts";
import { orchestrationCatalogOf } from "../../src/testing/index.ts";

export function install(
  t: TestHost,
  module: OrchestrationModule,
  loadIndex = 0,
): ReturnType<TestHost["host"]["install"]> {
  return t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex,
    builtin: true,
  });
}

/**
 * 주도 시작 요청을 넣고 턴 경계를 한 번 돌려 부여받게 한다(E3: 중재가 없어 그룹은 시작 요청으로만 스택에 오른다).
 * 요청이 거부되면 시험이 실패하도록 결과를 확인한다.
 */
export async function startDriveOf(t: TestHost, thread: ThreadId, scope: string): Promise<void> {
  const started = t.host.startDrive(thread, scope);
  if (!started.ok) throw new Error(`startDrive ${scope} refused: ${started.error.kind}`);
  await t.boundary(thread).turnSettled();
  await t.settled();
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
  modules: readonly OrchestrationModule[],
  index = 0,
): Promise<void> {
  const [first, ...rest] = modules;
  if (first === undefined) return;
  await install(t, first, index);
  await installInOrder(t, rest, index + 1);
}

/** OrchestrationService 시험이 쓰는 호스트 묶음 */
export interface ServiceRig {
  readonly t: TestHost;
  readonly thread: ThreadId;
  readonly service: OrchestrationServiceWithUsage;
}

export async function serviceRig(modules: readonly OrchestrationModule[]): Promise<ServiceRig> {
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      driveMaxDepth: () => 8,
      driveRequiresOrchestration: () => true,
      capabilityProviders: () => ({}),
    },
  });
  const thread = t.newThread();
  const service = createOrchestrationService({
    host: t.host,
    catalog: orchestrationCatalogOf(modules),
    currentThread: () => thread,
  });
  await installInOrder(t, modules);
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread, service };
}

/** 서비스 목록에서 id의 상태를 찾는다 */
export function statusOf(
  service: OrchestrationServiceWithUsage,
  id: string,
): OrchestrationStatus | undefined {
  return service.list().find((group) => group.id === id);
}

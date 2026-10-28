import type { ThreadId } from "@xeon/contracts/conversation";
import {
  createTestHost,
  fixedIdFactory,
  memoryInputQueue,
  memoryLoopPort,
  type MemoryInputQueue,
  type MemoryLoopPort,
  type TestHost,
} from "@xeon/ext-host/testing";
import { helmGroup } from "../../src/index.ts";
import {
  DEFS,
  callCommand,
  createWorld,
  defaultAnswers,
  drainRounds,
  installWorld,
  scriptedLoop,
  settleOnce,
  type World,
} from "./rig.ts";

/** 프로세스 강제 종료 뒤 같은 기록 저장소·루프·큐·능력 세계로 다시 시작해 탐구를 끝낸다 */
export async function crashAndResume(crash: {
  readonly taskCall?: number;
  readonly post?: boolean;
  /** 이 번째 spawn 실행이 던진다(1부터) */
  readonly spawnCall?: number;
}): Promise<{
  readonly world: World;
  readonly loop: MemoryLoopPort;
  readonly queue: MemoryInputQueue;
  readonly records: ReturnType<TestHost["records"]["events"]>;
  readonly thread: ThreadId;
  readonly spawnsCompleted: readonly string[];
}> {
  const scripted = scriptedLoop(fixedIdFactory(9000), defaultAnswers());
  const spawns = { calls: 0 };
  /** 끝까지 실행된 spawn의 요청 id(던진 호출은 빠진다) */
  const completed: string[] = [];
  const loop = memoryLoopPort({
    ...scripted,
    runSpawn: (request) => {
      spawns.calls += 1;
      if (spawns.calls === crash.spawnCall) throw new TypeError("simulated crash");
      completed.push(request.requestId);
      return scripted.runSpawn?.(request) ?? Promise.reject(new TypeError("no scripted spawn"));
    },
  });
  const queue = memoryInputQueue();
  const world = createWorld();
  if (crash.taskCall !== undefined) world.hooks.crashOnTaskCall = crash.taskCall;
  const armed = { post: crash.post === true };
  const crashing: MemoryInputQueue = {
    get items() {
      return queue.items;
    },
    enqueue(request) {
      if (armed.post && request.requestId.endsWith(":finished")) {
        armed.post = false;
        throw new TypeError("simulated crash");
      }
      return queue.enqueue(request);
    },
  };
  const first = await createTestHost({ capabilityDefs: DEFS, shared: { loop, queue: crashing } });
  const thread = first.newThread();
  await installWorld(first, world);
  await first.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 4,
    builtin: true,
  });
  await first.host.openThread(thread);
  await first.settled();
  await callCommand(first, thread, "start 캐시 무효화");
  await settleOnce(first, thread, "start");
  await drainRounds(first, thread, 8);
  // 강제 종료: 같은 저장소·포트로 새 호스트를 만든다. 첫 호스트는 그대로 둔다
  world.hooks.crashOnTaskCall = null;
  const second = await first.restart();
  await installWorld(second, world);
  await second.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 4,
    builtin: true,
  });
  await second.host.openThread(thread);
  await second.settled();
  await drainRounds(second, thread, 8);
  return {
    world,
    loop,
    queue,
    records: second.records.events(thread),
    thread,
    spawnsCompleted: completed,
  };
}

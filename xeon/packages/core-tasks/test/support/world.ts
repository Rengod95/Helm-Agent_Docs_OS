import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { CommitRequest } from "@xeon/contracts/records";
import type {
  AbortIntentWriter,
  AbortReason,
  InputDraft,
  TaskScope,
  TaskService,
} from "@xeon/contracts/services";
import {
  createStaticTasksSettings,
  type StaticTasksSettings,
  type TasksSettingsSource,
} from "../../src/settings-source.ts";
import {
  memoryTasks,
  recordingLogger,
  type MemorySession,
  type RecordingLogger,
} from "../../src/testing/index.ts";
import { fixedIdFactory } from "./ids.ts";

export interface World {
  readonly tasks: TaskService;
  readonly session: MemorySession;
  readonly log: RecordingLogger;
  readonly threadId: ThreadId;
  readonly ids: ReturnType<typeof fixedIdFactory>;
}

export interface WorldOptions {
  readonly settings?: StaticTasksSettings;
  /** 설정 읽기를 직접 넘긴다. settings보다 앞선다 */
  readonly settingsSource?: TasksSettingsSource;
  readonly session?: MemorySession;
  readonly threadId?: ThreadId;
}

/** 열린 thread 하나와 메모리 세션 위의 실제 TaskService */
export function createWorld(options: WorldOptions = {}): World {
  const ids = fixedIdFactory();
  const log = recordingLogger();
  const made = memoryTasks({
    ids,
    log: log.logger,
    settings: options.settingsSource ?? createStaticTasksSettings(options.settings),
    ...(options.session === undefined ? {} : { session: options.session }),
  });
  const threadId = options.threadId ?? ids.next("thr");
  if (options.session === undefined) made.session.openThread(threadId);
  return { tasks: made.tasks, session: made.session, log, threadId, ids };
}

/** 같은 세션과 thread 위에 서비스를 다시 만든다(프로세스 재시작 흉내) */
export function restart(world: World, settings?: StaticTasksSettings): World {
  return createWorld({
    session: world.session,
    threadId: world.threadId,
    ...(settings === undefined ? {} : { settings }),
  });
}

export function userDraft(
  threadId: ThreadId,
  requestId: string,
  overrides: Partial<InputDraft> = {},
): InputDraft {
  return {
    threadId,
    mode: "steer",
    item: { kind: "user", content: `text ${requestId}` },
    requestId,
    source: { type: "user", via: "interactive" },
    ...overrides,
  };
}

/** loop가 넘기는 turn 노드의 의도 기록기를 흉내 낸다: turn.abort_requested 한 건, 커밋 키 abort:<turnId> */
export function turnAbortIntent(world: World, turnId: TurnId): AbortIntentWriter {
  const producer = world.session.producer("core.loop");
  return (reason: AbortReason, cause: "direct" | "cascade"): CommitRequest => ({
    threadId: world.threadId,
    requestId: `abort:${turnId}`,
    fingerprintSource: { turnId },
    build: () => ({
      kind: "append",
      drafts: [
        producer.draft({
          id: world.ids.next("evt"),
          kind: "turn.abort_requested",
          threadId: world.threadId,
          turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            reason: { code: reason.code, message: reason.message },
            cause,
            background: false,
          },
        }),
      ],
      checkpoint: null,
    }),
  });
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  const holder: { resolve: (value: T) => void } = { resolve: () => {} };
  const promise = new Promise<T>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, resolve: (value) => holder.resolve(value) };
}

export interface Watched {
  /** promise가 이행했으면 참 */
  readonly done: boolean;
  /** 이행을 기다린다 */
  readonly whenDone: Promise<unknown>;
}

/** promise가 언제 이행하는지 지켜본다. 이행 순서를 기록하는 시험이 쓴다 */
export function watch(promise: Promise<unknown>, onDone?: () => void): Watched {
  const state = { done: false };
  const whenDone = promise.then((value) => {
    state.done = true;
    onDone?.();
    return value;
  });
  return {
    get done() {
      return state.done;
    },
    whenDone,
  };
}

/** 마이크로태스크를 충분히 비운다. 실제 시간을 기다리지 않는다 */
export async function flush(rounds = 10): Promise<void> {
  if (rounds <= 0) return;
  await Promise.resolve();
  await flush(rounds - 1);
}

/** thread 노드 아래 turn 노드를 연다 */
export function openTurn(
  world: World,
  options: { readonly intent?: boolean; readonly turnId?: TurnId } = {},
): { readonly thread: TaskScope; readonly turn: TaskScope; readonly turnId: TurnId } {
  const turnId = options.turnId ?? world.ids.next("trn");
  const thread =
    world.tasks.find("thread", world.threadId) ??
    world.tasks.openScope(world.tasks.root, { kind: "thread", id: world.threadId });
  const turn = world.tasks.openScope(thread, {
    kind: "turn",
    id: turnId,
    ...(options.intent === false ? {} : { abortIntent: turnAbortIntent(world, turnId) }),
  });
  return { thread, turn, turnId };
}

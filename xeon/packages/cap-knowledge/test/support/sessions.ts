import { Bug, type Clock, type Logger } from "@xeon/contracts";
import type { IdFactory, ItemId, ThreadId } from "@xeon/contracts/conversation";
import type { ProducerHandle, SessionService } from "@xeon/contracts/records";
import { createSessionService } from "@xeon/core-persistence";
import { TEST_HOLDER_A, type TestStore } from "@xeon/platform-store/testing";

// 실제 SQLite 위에 core-persistence 세션 서비스를 올리고 세션과 메시지를 커밋하는 시험 도우미(eng.testing.guide TS-07).
// 투영기 등록부도 실제 구현이라 `cap_knowledge_*` 표 이름과 소유 규칙이 그대로 검사된다.

export interface SessionKit {
  readonly session: SessionService;
  /** 새 thread를 만들고 쓰기 모드로 연다 */
  newThread(options?: {
    readonly id?: ThreadId;
    readonly title?: string;
    readonly workspace?: string;
  }): ThreadId;
  /** 사용자·어시스턴트 메시지 하나를 `item.recorded`로 커밋한다. 텍스트는 그대로 들어간다 */
  say(threadId: ThreadId, role: "user" | "assistant", text: string): void;
  /** 어시스턴트의 도구 호출과 사고만 든 메시지(색인하지 않는 파트) */
  sayWithoutText(threadId: ThreadId): void;
  /** 도구 결과 메시지(색인하지 않는다) */
  toolResult(threadId: ThreadId, text: string): void;
  /** 미리 정해 두고 쓸 thread id */
  newId(): ThreadId;
  /** 자식 thread가 생겼음을 알리는 `agent.spawned`를 부모 thread에 커밋한다 */
  spawn(parent: ThreadId, child: ThreadId, background: boolean): void;
  /** thread 제목을 바꾼다 */
  retitle(threadId: ThreadId, title: string): void;
}

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function createSessionKit(options: {
  readonly store: TestStore;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly logger: Logger;
}): SessionKit {
  const { store, clock, ids, logger } = options;
  const created = createSessionService({
    db: store.root,
    leases: store.leases,
    migrations: store.service.migrations,
    readBlob: (ref) => store.service.readBlob(ref),
    putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
    clock,
    ids,
    logger,
    holder: TEST_HOLDER_A,
  });
  if (!created.ok)
    throw new Bug("sessions: cannot create the session service", { cause: created.error });
  const session = created.value;
  const loop: ProducerHandle = session.producer("core.loop");
  const agents: ProducerHandle = session.producer("core.agents");
  let counter = 0;

  const commit = (
    threadId: ThreadId,
    producer: ProducerHandle,
    kind: "item.recorded" | "agent.spawned",
    payload: unknown,
  ): void => {
    counter += 1;
    const result = session.commit({
      threadId,
      requestId: `kit-${String(counter)}`,
      fingerprintSource: { n: counter },
      build: () => ({
        kind: "append",
        drafts: [
          producer.draft({
            id: ids.next("evt"),
            kind,
            threadId,
            turnId: null,
            stepId: null,
            causationId: null,
            correlationId: null,
            payload,
          }),
        ],
        checkpoint: null,
      }),
    });
    if (!result.ok || result.value.status !== "committed") {
      throw new Bug(`sessions: commit of ${kind} failed`, { cause: result });
    }
  };

  const itemId = (): ItemId => ids.next("itm");

  return {
    session,
    newId: () => ids.next("thr"),
    newThread(opts = {}) {
      const threadId = opts.id ?? ids.next("thr");
      const made = session.threads.create({
        threadId,
        ...(opts.title === undefined ? {} : { title: opts.title }),
        ...(opts.workspace === undefined ? {} : { workspace: opts.workspace }),
      });
      if (!made.ok) throw new Bug("sessions: thread create failed", { cause: made.error });
      const token = store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
      if (!token.ok) throw new Bug("sessions: lease failed", { cause: token.error });
      const opened = session.openForWrite(threadId, token.value);
      if (!opened.ok) throw new Bug("sessions: open failed", { cause: opened.error });
      return threadId;
    },
    say(threadId, role, text) {
      const payload =
        role === "user"
          ? {
              item: {
                itemId: itemId(),
                status: "completed",
                kind: "user",
                message: { role: "user", content: text, timestamp: clock.now() },
                requestId: null,
              },
            }
          : {
              item: {
                itemId: itemId(),
                status: "completed",
                kind: "assistant",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text }],
                  api: "test",
                  provider: "test",
                  model: "tape",
                  usage: USAGE,
                  stopReason: "stop",
                  timestamp: clock.now(),
                },
                partIds: [],
              },
            };
      commit(threadId, loop, "item.recorded", payload);
    },
    sayWithoutText(threadId) {
      commit(threadId, loop, "item.recorded", {
        item: {
          itemId: itemId(),
          status: "completed",
          kind: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "secret reasoning text" },
              { type: "toolCall", id: "call-1", name: "read", arguments: {} },
            ],
            api: "test",
            provider: "test",
            model: "tape",
            usage: USAGE,
            stopReason: "toolUse",
            timestamp: clock.now(),
          },
          partIds: [],
        },
      });
    },
    toolResult(threadId, text) {
      commit(threadId, loop, "item.recorded", {
        item: {
          itemId: itemId(),
          status: "completed",
          kind: "toolResult",
          message: {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{ type: "text", text }],
            isError: false,
            timestamp: clock.now(),
          },
          effectId: null,
        },
      });
    },
    spawn(parent, child, background) {
      commit(parent, agents, "agent.spawned", {
        childThreadId: child,
        agent: "explorer",
        requestId: `spawn-${String(counter + 1)}`,
        owner: { kind: "scope", scopeId: "scope-1" },
        caller: "subagent:explorer",
        depth: 1,
        background,
        fork: null,
        modelRole: "main",
      });
    },
    retitle(threadId, title) {
      counter += 1;
      const done = session.threads.setTitle(threadId, title, `title-${String(counter)}`);
      if (!done.ok) throw new Bug("sessions: setTitle failed", { cause: done.error });
    },
  };
}

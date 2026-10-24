import { assertNever, parse, type Result } from "@xeon/contracts";
import {
  WorkTasks,
  type CallOptions,
  type CapabilityApi,
  type TaskCreateInputValue,
  type TaskLinkInputValue,
  type TaskListInputValue,
  type TaskOp,
  type TaskUpdateInputValue,
  type TaskWriteInputValue,
  type TaskWriteOutputValue,
  type WorkTask,
  type WorkTaskId,
  type WorkTaskView,
} from "@xeon/contracts/capabilities";
import { toJsonValue, ThreadIdSchema, type ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  WorkTaskCreatedSchema,
  type CommitPlan,
  type CommitResult,
  type DraftInput,
  type ReadFailure,
  type StampedDraft,
  type StoreError,
} from "@xeon/contracts/records";
import type { WorkTasksDeps } from "../deps.ts";
import {
  abortedError,
  internalError,
  invalidInput,
  storeRejection,
  taskRejection,
} from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import { readTasks } from "../projection/read.ts";
import { decodeOpFailure, encodeOpFailure, type OpFailure } from "./failure.ts";
import { toViews } from "./model.ts";
import { createThreadQueue } from "./queue.ts";
import { planWrite, type CreatedEntry, type WritePlan } from "./write.ts";

// L2.work.spec §3.2, §4.1. work.tasks 서비스. 쓰기는 스레드마다 직렬화하고(spec §4.1.1), 규칙 검사와 이벤트 초안 만들기는
// 커밋의 build 안에서 한다. 같은 requestId의 재호출은 build를 거치지 않고 처음 결과를 되풀이한다(TX-05).

const CAPABILITY = WorkTasks.id;

/** 거부 레코드의 code. 연산이 모두 효과가 없어 커밋할 이벤트가 없을 때 쓴다 */
const NOOP_CODE = "noop";

/** 쓰기 메서드의 멱등 키 접두. 이벤트 카탈로그의 키 열(spec §3.7)과 같다 */
function commitKeyOf(requestId: string): string {
  return `work:tasks:${commitKeyPart(requestId, sha256Hex)}`;
}

interface CallScope {
  readonly threadId: ThreadId;
  readonly turnId: DraftInput["turnId"];
}

function scopeOf(method: string, options: CallOptions | undefined): CallScope {
  if (options?.signal?.aborted === true) throw abortedError(CAPABILITY, method);
  const raw = options?.context?.threadId;
  if (raw === undefined) {
    throw invalidInput(CAPABILITY, method, "The call has no thread context.");
  }
  const threadId = parse(ThreadIdSchema, raw);
  if (!threadId.ok) throw invalidInput(CAPABILITY, method, "The thread id is malformed.");
  return { threadId: threadId.value, turnId: options?.context?.turnId ?? null };
}

function requestIdOf(method: string, options: CallOptions | undefined): string {
  const requestId = options?.requestId;
  if (requestId === undefined || requestId === "") {
    throw invalidInput(CAPABILITY, method, "Write methods need a requestId.");
  }
  return requestId;
}

function nextOrdOf(tasks: readonly WorkTask[]): number {
  return tasks.reduce((max, task) => Math.max(max, Number(task.id.slice(1))), 0) + 1;
}

function orThrow<T>(method: string, read: Result<T, ReadFailure | StoreError>): T {
  if (read.ok) return read.value;
  throw storeRejection(CAPABILITY, method, read.error);
}

function viewOf(method: string, views: readonly WorkTaskView[], id: WorkTaskId): WorkTaskView {
  const view = views.find((candidate) => candidate.id === id);
  if (view === undefined) {
    throw internalError(CAPABILITY, method, `Task ${id} is missing after the write.`);
  }
  return view;
}

/** 거부 또는 효과 없음으로 끝난 커밋의 해석 */
type Settled =
  | { readonly kind: "applied"; readonly created: readonly CreatedEntry[] }
  | { readonly kind: "rejected"; readonly rejection: OpFailure };

export function createTasksApi(deps: WorkTasksDeps): CapabilityApi<typeof WorkTasks> {
  const queue = createThreadQueue();

  /** 재전송된 커밋(같은 requestId)의 work.task_created 이벤트에서 (ref, id)를 복원한다 */
  function createdOfCommit(
    method: string,
    threadId: ThreadId,
    committed: Extract<CommitResult, { status: "committed" }>,
  ): CreatedEntry[] {
    const read = deps.session.feed.read(
      committed.firstSeq - 1,
      committed.lastSeq,
      { threadIds: [threadId], kindPrefixes: ["work.task_created"] },
      committed.lastSeq - committed.firstSeq + 1,
      committed.lastSeq - committed.firstSeq + 1,
    );
    const events = orThrow(method, read).events;
    const created: CreatedEntry[] = [];
    for (const event of events) {
      const payload = parse(WorkTaskCreatedSchema, event.payload);
      if (!payload.ok) {
        throw internalError(CAPABILITY, method, "A stored work.task_created event is damaged.");
      }
      created.push({ ref: payload.value.ref, id: payload.value.task.id });
    }
    return created;
  }

  function draftsOf(scope: CallScope, plan: WritePlan): StampedDraft[] {
    return plan.events.map((event) =>
      deps.producer.draft({
        id: deps.ids.next("evt"),
        kind: event.kind,
        threadId: scope.threadId,
        turnId: scope.turnId,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: event.payload,
      }),
    );
  }

  /** 연산을 적용하고 커밋한다. 쓰기 큐 안에서만 부른다 */
  function applyInQueue(
    method: string,
    scope: CallScope,
    requestId: string,
    ops: readonly TaskOp[],
  ): Settled {
    const fingerprint = toJsonValue(ops);
    if (fingerprint === undefined) {
      throw invalidInput(CAPABILITY, method, "The operations are not plain JSON values.");
    }
    const tasks = orThrow(method, readTasks(deps.reader, scope.threadId));
    const autoStart = deps.settings(scope.threadId).tasks.autoStart;
    const box: { plan: WritePlan | undefined } = { plan: undefined };
    const build = (): CommitPlan => {
      const planned = planWrite({ tasks, nextOrd: nextOrdOf(tasks), autoStart }, ops);
      if (!planned.ok) {
        return {
          kind: "reject",
          code: planned.error.failure.kind,
          detail: encodeOpFailure(planned.error),
        };
      }
      if (planned.value.events.length === 0)
        return { kind: "reject", code: NOOP_CODE, detail: null };
      box.plan = planned.value;
      return { kind: "append", drafts: draftsOf(scope, planned.value), checkpoint: null };
    };
    const committed = deps.session.commit({
      threadId: scope.threadId,
      requestId: commitKeyOf(requestId),
      fingerprintSource: { method, ops: fingerprint },
      build,
    });
    if (!committed.ok) throw storeRejection(CAPABILITY, method, committed.error);
    const result = committed.value;
    switch (result.status) {
      case "committed":
        if (!result.replayed && box.plan !== undefined) {
          return { kind: "applied", created: box.plan.created };
        }
        return { kind: "applied", created: createdOfCommit(method, scope.threadId, result) };
      case "rejected": {
        if (result.code === NOOP_CODE) return { kind: "applied", created: [] };
        const stored = decodeOpFailure(result.detail);
        if (stored === undefined) {
          throw internalError(CAPABILITY, method, "A stored rejection is damaged.");
        }
        return { kind: "rejected", rejection: stored };
      }
      case "key_reused":
        deps.logger.error("work.tasks.key_reused", { method, requestId });
        throw internalError(
          CAPABILITY,
          method,
          "The requestId was already used with a different input.",
        );
      default:
        return assertNever(result, "commit result");
    }
  }

  async function write(
    method: string,
    ops: readonly TaskOp[],
    options: CallOptions | undefined,
  ): Promise<{ readonly views: WorkTaskView[]; readonly created: readonly CreatedEntry[] }> {
    const scope = scopeOf(method, options);
    const requestId = requestIdOf(method, options);
    const settled = await queue.run(scope.threadId, () =>
      applyInQueue(method, scope, requestId, ops),
    );
    if (settled.kind === "rejected") {
      throw taskRejection(CAPABILITY, method, settled.rejection, method === "write");
    }
    const tasks = orThrow(method, readTasks(deps.reader, scope.threadId));
    return { views: toViews(tasks), created: settled.created };
  }

  return {
    async create(input: TaskCreateInputValue, options) {
      const { views, created } = await write("create", [{ op: "create", ...input }], options);
      const first = created[0];
      if (first === undefined) {
        throw internalError(CAPABILITY, "create", "The write created no task.");
      }
      return { task: viewOf("create", views, first.id) };
    },
    async update(input: TaskUpdateInputValue, options) {
      const { views } = await write("update", [{ op: "update", ...input }], options);
      return { task: viewOf("update", views, input.id) };
    },
    async link(input: TaskLinkInputValue, options) {
      const op: TaskOp = {
        op: input.op === "add" ? "link" : "unlink",
        id: input.id,
        blockedBy: input.blockedBy,
      };
      const { views } = await write("link", [op], options);
      return { task: viewOf("link", views, input.id) };
    },
    async list(input: TaskListInputValue, options) {
      const scope = scopeOf("list", options);
      // 쓰기와 같은 큐를 지나므로 먼저 부른 쓰기가 끝난 뒤의 목록을 본다
      return await queue.run(scope.threadId, () => {
        const tasks = orThrow("list", readTasks(deps.reader, scope.threadId));
        const statuses = input.status;
        const views = toViews(tasks).filter(
          (view) =>
            (statuses === undefined || statuses.includes(view.status)) &&
            (input.owner === undefined || view.owner === input.owner),
        );
        return { tasks: views };
      });
    },
    async write(input: TaskWriteInputValue, options): Promise<TaskWriteOutputValue> {
      const { views, created } = await write("write", input.ops, options);
      return { tasks: views, created: created.map((entry) => ({ ref: entry.ref, id: entry.id })) };
    },
  };
}

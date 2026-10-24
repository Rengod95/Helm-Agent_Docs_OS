import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import {
  MAX_WORK_TASKS,
  WorkTaskIdSchema,
  type TaskOp,
  type WorkTask,
  type WorkTaskId,
  type WorkTaskStatus,
} from "@xeon/contracts/capabilities";
import type {
  WorkTaskChangedPayload,
  WorkTaskCreatedPayload,
  WorkTaskLinkPayload,
} from "@xeon/contracts/records";
import type { OpFailure, TaskFailure } from "./failure.ts";
import { findCycle } from "./graph.ts";
import { blockersOf, indexTasks, isResolved, transitionOf } from "./model.ts";

// L2.work.spec §4.1.1~§4.1.4. 연산 목록을 메모리 사본에 순서대로 적용해 이벤트 초안을 만든다.
// 한 연산이라도 실패하면 아무 것도 내보내지 않는다(전부 또는 전무). 순수 함수다.

/** 한 스레드의 작업 수 상한 대신 쓰는 선행 작업 수 상한(WorkTaskSchema.blockedBy maxItems) */
const MAX_BLOCKED_BY = 32;

type PlannedEvent =
  | { readonly kind: "work.task_created"; readonly payload: WorkTaskCreatedPayload }
  | { readonly kind: "work.task_changed"; readonly payload: WorkTaskChangedPayload }
  | { readonly kind: "work.task_linked"; readonly payload: WorkTaskLinkPayload }
  | { readonly kind: "work.task_unlinked"; readonly payload: WorkTaskLinkPayload };

export interface CreatedEntry {
  readonly ref: string | null;
  readonly id: WorkTaskId;
}

export interface WritePlan {
  readonly events: readonly PlannedEvent[];
  readonly created: readonly CreatedEntry[];
  /** 연산을 모두 적용한 뒤의 목록(생성 순서) */
  readonly tasks: readonly WorkTask[];
}

export interface WriteContext {
  /** 지금까지의 목록(생성 순서) */
  readonly tasks: readonly WorkTask[];
  /** 다음에 발급할 순번 */
  readonly nextOrd: number;
  /** 설정 l2.work.tasks.autoStart */
  readonly autoStart: boolean;
}

interface Draft {
  readonly tasks: Map<WorkTaskId, WorkTask>;
  readonly refs: Map<string, WorkTaskId>;
  readonly events: PlannedEvent[];
  readonly created: CreatedEntry[];
  nextOrd: number;
}

type Step<T> = Result<T, TaskFailure>;

function makeTaskId(ord: number): Step<WorkTaskId> {
  const parsed = parse(WorkTaskIdSchema, `t${ord}`);
  return parsed.ok ? ok(parsed.value) : err({ kind: "task_limit" });
}

/** 임시 참조("@a")는 앞선 create에서, 나머지는 현재 목록에서 찾는다 */
function resolveTarget(draft: Draft, raw: string): Step<WorkTaskId> {
  if (raw.startsWith("@")) {
    const id = draft.refs.get(raw);
    return id === undefined ? err({ kind: "task_ref_unknown", ref: raw }) : ok(id);
  }
  const parsed = parse(WorkTaskIdSchema, raw);
  if (!parsed.ok) return err({ kind: "invalid_input", message: `"${raw}" is not a task id` });
  return draft.tasks.has(parsed.value) ? ok(parsed.value) : err({ kind: "not_found", id: raw });
}

function resolveAll(draft: Draft, raws: readonly string[]): Step<WorkTaskId[]> {
  const out: WorkTaskId[] = [];
  for (const raw of raws) {
    const id = resolveTarget(draft, raw);
    if (!id.ok) return id;
    if (!out.includes(id.value)) out.push(id.value);
  }
  return ok(out);
}

function currentOf(draft: Draft, id: WorkTaskId): Step<WorkTask> {
  const task = draft.tasks.get(id);
  return task === undefined ? err({ kind: "not_found", id }) : ok(task);
}

function applyCreate(draft: Draft, op: Extract<TaskOp, { op: "create" }>): Step<undefined> {
  if (draft.tasks.size >= MAX_WORK_TASKS) return err({ kind: "task_limit" });
  if (op.ref !== undefined && draft.refs.has(op.ref)) {
    return err({ kind: "invalid_input", message: `ref ${op.ref} is used twice` });
  }
  const blockedBy = resolveAll(draft, op.blockedBy ?? []);
  if (!blockedBy.ok) return blockedBy;
  if (blockedBy.value.length > MAX_BLOCKED_BY) {
    return err({ kind: "invalid_input", message: `at most ${MAX_BLOCKED_BY} blockers per task` });
  }
  const id = makeTaskId(draft.nextOrd);
  if (!id.ok) return id;
  const status: WorkTaskStatus = op.status ?? "pending";
  const task: WorkTask = {
    id: id.value,
    content: op.content,
    activeForm: op.activeForm ?? null,
    status,
    owner: op.owner ?? null,
    blockedBy: blockedBy.value,
  };
  if (status === "in_progress") {
    const blockers = blockersOf(task, indexTasks([...draft.tasks.values()]));
    if (blockers.length > 0) return err({ kind: "task_blocked", blockers });
  }
  draft.nextOrd += 1;
  draft.tasks.set(task.id, task);
  const ref = op.ref ?? null;
  if (op.ref !== undefined) draft.refs.set(op.ref, task.id);
  draft.events.push({
    kind: "work.task_created",
    payload: { task: { ...task, blockedBy: [...task.blockedBy] }, ref },
  });
  draft.created.push({ ref, id: task.id });
  return ok(undefined);
}

type ChangeSet = WorkTaskChangedPayload["set"];

/** 상태가 끝나지 않은 쪽에서 끝난 쪽으로 넘어가며 막힘이 풀린 pending 작업을 시작 표시한다(spec §4.1.4) */
function autoStartUnblocked(draft: Draft, resolvedId: WorkTaskId): void {
  for (const candidate of draft.tasks.values()) {
    if (candidate.status !== "pending" || candidate.owner === null) continue;
    if (!candidate.blockedBy.includes(resolvedId)) continue;
    if (blockersOf(candidate, indexTasks([...draft.tasks.values()])).length > 0) continue;
    draft.tasks.set(candidate.id, { ...candidate, status: "in_progress" });
    draft.events.push({
      kind: "work.task_changed",
      payload: {
        taskId: candidate.id,
        from: "pending",
        set: { status: "in_progress" },
        cause: "auto_start",
      },
    });
  }
}

function applyUpdate(
  draft: Draft,
  op: Extract<TaskOp, { op: "update" }>,
  autoStart: boolean,
): Step<undefined> {
  const target = resolveTarget(draft, op.id);
  if (!target.ok) return target;
  const current = currentOf(draft, target.value);
  if (!current.ok) return current;
  const task = current.value;
  const set: ChangeSet = {};
  let next: WorkTask = task;
  if (op.content !== undefined && op.content !== task.content) {
    set.content = op.content;
    next = { ...next, content: op.content };
  }
  if (op.activeForm !== undefined && op.activeForm !== task.activeForm) {
    set.activeForm = op.activeForm;
    next = { ...next, activeForm: op.activeForm };
  }
  if (op.owner !== undefined && op.owner !== task.owner) {
    set.owner = op.owner;
    next = { ...next, owner: op.owner };
  }
  if (op.status !== undefined) {
    const kind = transitionOf(task.status, op.status);
    if (kind === "invalid") {
      return err({ kind: "task_transition_invalid", from: task.status, to: op.status });
    }
    if (kind === "check_blocked" && op.force !== true) {
      const blockers = blockersOf(task, indexTasks([...draft.tasks.values()]));
      if (blockers.length > 0) return err({ kind: "task_blocked", blockers });
    }
    if (kind !== "same") {
      set.status = op.status;
      next = { ...next, status: op.status };
    }
  }
  if (Object.keys(set).length === 0) return ok(undefined);
  draft.tasks.set(task.id, next);
  draft.events.push({
    kind: "work.task_changed",
    payload: { taskId: task.id, from: task.status, set, cause: "call" },
  });
  if (autoStart && !isResolved(task.status) && isResolved(next.status)) {
    autoStartUnblocked(draft, task.id);
  }
  return ok(undefined);
}

interface LinkOp {
  readonly id: string;
  readonly blockedBy: readonly string[];
}

function applyLink(draft: Draft, op: LinkOp): Step<undefined> {
  const target = resolveTarget(draft, op.id);
  if (!target.ok) return target;
  const blockers = resolveAll(draft, op.blockedBy);
  if (!blockers.ok) return blockers;
  const current = currentOf(draft, target.value);
  if (!current.ok) return current;
  // 같은 연산 안에서 앞서 더한 간선도 다음 검사에 보이도록 같은 배열에 바로 더한다
  const blockedBy = [...current.value.blockedBy];
  draft.tasks.set(current.value.id, { ...current.value, blockedBy });
  const added: WorkTaskId[] = [];
  for (const blocker of blockers.value) {
    if (blockedBy.includes(blocker)) continue;
    const cycle = findCycle(draft.tasks, current.value.id, blocker);
    if (cycle !== undefined) return err({ kind: "task_cycle", path: cycle });
    if (blockedBy.length >= MAX_BLOCKED_BY) {
      return err({ kind: "invalid_input", message: `at most ${MAX_BLOCKED_BY} blockers per task` });
    }
    blockedBy.push(blocker);
    added.push(blocker);
  }
  if (added.length > 0) {
    draft.events.push({
      kind: "work.task_linked",
      payload: { taskId: current.value.id, blockedBy: added },
    });
  }
  return ok(undefined);
}

function applyUnlink(draft: Draft, op: LinkOp): Step<undefined> {
  const target = resolveTarget(draft, op.id);
  if (!target.ok) return target;
  const blockers = resolveAll(draft, op.blockedBy);
  if (!blockers.ok) return blockers;
  const current = currentOf(draft, target.value);
  if (!current.ok) return current;
  const removed = blockers.value.filter((blocker) => current.value.blockedBy.includes(blocker));
  if (removed.length === 0) return ok(undefined);
  draft.tasks.set(current.value.id, {
    ...current.value,
    blockedBy: current.value.blockedBy.filter((id) => !removed.includes(id)),
  });
  draft.events.push({
    kind: "work.task_unlinked",
    payload: { taskId: current.value.id, blockedBy: removed },
  });
  return ok(undefined);
}

function applyOp(draft: Draft, op: TaskOp, autoStart: boolean): Step<undefined> {
  switch (op.op) {
    case "create":
      return applyCreate(draft, op);
    case "update":
      return applyUpdate(draft, op, autoStart);
    case "link":
      return applyLink(draft, op);
    case "unlink":
      return applyUnlink(draft, op);
    default:
      return assertNever(op, "applyOp");
  }
}

/**
 * 연산 목록을 적용한다. 성공이면 이벤트 초안(커밋 하나에 넣을 것), 만든 작업의 (ref, id), 적용 뒤 목록을 돌려준다.
 * 실패하면 첫 실패와 그 연산 번호를 돌려준다.
 */
export function planWrite(
  context: WriteContext,
  ops: readonly TaskOp[],
): Result<WritePlan, OpFailure> {
  const draft: Draft = {
    tasks: new Map(context.tasks.map((task) => [task.id, task])),
    refs: new Map(),
    events: [],
    created: [],
    nextOrd: context.nextOrd,
  };
  for (const [opIndex, op] of ops.entries()) {
    const applied = applyOp(draft, op, context.autoStart);
    if (!applied.ok) return err({ opIndex, failure: applied.error });
  }
  return ok({ events: draft.events, created: draft.created, tasks: [...draft.tasks.values()] });
}

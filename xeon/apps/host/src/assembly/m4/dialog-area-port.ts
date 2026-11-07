import { assertNever, attemptAsync, err, ok, parse } from "@fresnel/contracts";
import type { ReviewText, ReviewTextFailure, ReviewTextReader } from "@fresnel/cap-artifacts";
import type { ScheduleEntry, RunRecord, UpdateInput } from "@fresnel/cap-schedule";
import {
  isCapabilityError,
  PlanIdSchema,
  type CallContext,
  type CallOptions,
  type Goal,
  type PlanVersionsOutputValue,
  type SkillViewOutput,
  type WorkTaskView,
} from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  GoalView,
  ReviewGetResult,
  ScheduleRunRecord,
  ScheduleUpdateParams,
  SkillViewResult,
  TaskView,
} from "@fresnel/contracts/wire";
import type {
  DialogAreaFailure,
  DialogAreaOutcome,
  DialogAreaPort,
} from "../../handlers/m4/dialog-area.ts";
import type { MemoryApi } from "./dialog-area-bridge.ts";
import type { M4PortDeps } from "./deps.ts";

// DialogArea 포트 구현(T-WC). 목표·작업·계획은 L2.work 기능을, 스킬 본문은 L2.knowledge 기능을 호스트 호출(사람이 연 화면)로 읽고,
// 예약은 예약 서비스를 부른다. 조립 루트 코드(DR-14 예외 2). 기능이 돌려준 값만 옮기고 새 값을 만들지 않는다.

const MESSAGE_MAX = 200;
/** `WorkTasksListResult`의 상한 */
const TASKS_MAX = 500;
const BLOCKED_BY_MAX = 2000;

/** `SkillViewResultSchema`의 상한. 본문은 앞부분만 싣고 `bodyTruncated`로 알린다 [제안] */
const SKILL_BODY_MAX = 20000;
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_FILES_MAX = 500;

/** `ReviewGetResultSchema`(F wire §3.3.5)의 상한. 넘는 파일, hunk, 줄은 뒤쪽부터 버리고 긴 글은 자른다 [결정: L4 W-02] */
const REVIEW_FILES_MAX = 500;
const REVIEW_HUNKS_MAX = 500;
const REVIEW_LINES_MAX = 5000;
const REVIEW_TEXT_MAX = 20000;
const REVIEW_HEADER_MAX = 512;
const REVIEW_PATH_MAX = 4096;

/** 호스트가 사람의 입력으로 부르는 호출의 문맥(`assembly/commands.ts`의 `hostContext`와 같다. 그 파일은 순환이라 import하지 않는다) */
function hostContext(threadId: ThreadId): CallContext {
  return { threadId, caller: { kind: "host" } };
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** UTF-16 단위 `max` 안으로 자른다. 짝을 잃은 대리 문자는 남기지 않는다 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * 리뷰 본문을 와이어 값으로 옮긴다. 기능이 준 값(hunk ID, 헤더, 시작 줄, 줄 종류와 글)은 그대로 두고 와이어 상한만 적용한다
 */
export function reviewGetResultOf(review: ReviewText): ReviewGetResult {
  return {
    reviewId: review.reviewId,
    files: review.files.slice(0, REVIEW_FILES_MAX).map((file) => ({
      path: clip(file.path, REVIEW_PATH_MAX),
      hunks: file.hunks.slice(0, REVIEW_HUNKS_MAX).map((hunk) => ({
        hunkId: hunk.hunkId,
        header: clip(hunk.header, REVIEW_HEADER_MAX),
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        lines: hunk.lines
          .slice(0, REVIEW_LINES_MAX)
          .map((line) => ({ kind: line.kind, text: clip(line.text, REVIEW_TEXT_MAX) })),
      })),
    })),
  };
}

/** 리뷰 본문 읽기의 실패를 포트 실패로 옮긴다. 저장한 자료의 손상과 읽기 실패는 모두 저장소 실패다 */
function reviewFailureOf(failure: ReviewTextFailure): DialogAreaFailure {
  switch (failure.kind) {
    case "read_failed":
      return { kind: "store_failed", message: failure.failure.kind };
    case "blob_failed":
      return { kind: "store_failed", message: failure.error.kind };
    case "diff_damaged":
      return { kind: "store_failed", message: `diff_${failure.reason}` };
    default:
      return assertNever(failure, "ReviewTextFailure");
  }
}

/**
 * 리뷰가 든 대화를 찾아 본문을 읽는다. 순서는 (1) 이 프로세스가 승인을 요청한 리뷰의 대화, (2) 대기 승인이 있는 열린 대화(최근 갱신 순,
 * 상한까지)다. 같은 대화를 두 번 읽지 않는다. 어디에도 없으면 undefined이고, 읽기 실패는 찾는 일을 멈추고 실패 값으로 돌려준다 [결정: L4 W-02]
 */
function reviewOf(
  reader: ReviewTextReader,
  reviewId: string,
): DialogAreaOutcome<ReviewText | undefined> {
  const known = reader.requestedThreadOf(reviewId);
  if (known !== undefined) {
    const found = reader.read(known, reviewId);
    if (!found.ok) return err(reviewFailureOf(found.error));
    if (found.value !== undefined) return ok(found.value);
  }
  for (const threadId of reader.pendingThreads()) {
    if (threadId === known) continue;
    const found = reader.read(threadId, reviewId);
    if (!found.ok) return err(reviewFailureOf(found.error));
    if (found.value !== undefined) return ok(found.value);
  }
  return ok(undefined);
}

/** 기능이 던진 값을 실패로 바꾼다. 기능 오류가 아니면(결함) 그대로 다시 던진다 */
function rejectedOf(caught: unknown): DialogAreaFailure {
  if (isCapabilityError(caught)) {
    return {
      kind: "rejected",
      code: caught.data.code,
      message: caught.data.message.slice(0, MESSAGE_MAX),
    };
  }
  throw caught;
}

/**
 * 목표 상태를 와이어 값으로 옮긴다. `limit_reached`(판정 상한)와 `judge_failed`(판정이 끝내 실패)는 와이어 값 `exhausted`다 [제안: 와이어에
 * 판정 실패 값이 없다]. 판정 횟수는 `judgments`, 최대는 설정 시점의 `maxRuns`다
 */
export function goalViewOf(goal: Goal): GoalView {
  const status =
    goal.status === "limit_reached" || goal.status === "judge_failed" ? "exhausted" : goal.status;
  return {
    condition: goal.condition,
    status,
    judged: goal.judgments,
    maxJudgments: goal.maxRuns,
    lastVerdict:
      goal.lastVerdict === null
        ? null
        : { met: goal.lastVerdict.met, reason: goal.lastVerdict.reason },
  };
}

/**
 * 스킬 본문을 와이어 값으로 옮긴다. 기능이 준 이름, 범위, 설명, 해시, 파일 목록은 그대로 두고 와이어 상한만 적용한다.
 * 본문이 잘리면 `bodyTruncated`가 참이다
 */
export function skillViewResultOf(view: SkillViewOutput): SkillViewResult {
  const body = clip(view.content, SKILL_BODY_MAX);
  return {
    name: view.name,
    scope: view.scope,
    description: clip(view.description, SKILL_DESCRIPTION_MAX),
    body,
    bodyTruncated: body.length < view.content.length,
    files: view.files.slice(0, SKILL_FILES_MAX),
    treeHash: view.treeHash,
  };
}

/**
 * 작업을 와이어 값으로 옮긴다. `completed`는 `done`, `failed`는 `cancelled`다 [제안: 와이어에 실패 값이 없다]. 막힘 사유는 끝나지 않은
 * 선행 작업의 id를 쉼표로 이은 글이고, 막히지 않았으면 null이다
 */
export function taskViewsOf(tasks: readonly WorkTaskView[]): readonly TaskView[] {
  const open = new Set(
    tasks
      .filter((task) => task.status !== "completed" && task.status !== "cancelled")
      .map((task) => task.id),
  );
  return tasks.slice(0, TASKS_MAX).map((task) => {
    const blockers = task.blockedBy.filter((id) => open.has(id));
    return {
      taskId: task.id,
      content: task.content,
      status:
        task.status === "completed" ? "done" : task.status === "failed" ? "cancelled" : task.status,
      blockedBy:
        task.blocked && blockers.length > 0 ? blockers.join(", ").slice(0, BLOCKED_BY_MAX) : null,
    };
  });
}

/**
 * 실행 기록을 와이어 값으로 옮긴다. `claimed`·`started`와 승인을 기다리며 정착한 실행(`awaiting_approval`)은 `running`이고(끝나지 않았으므로
 * `endedAt`은 null), 끝난 실행은 `completed`면 `ok`, `aborted`·`failed`면 `failed`다 [제안]. `startedAt`은 시작하지 못한 기록(건너뜀, 실패)이면
 * 기한을 잡은 시각이다
 */
export function runRecordOf(run: RunRecord): ScheduleRunRecord {
  const waiting =
    run.status === "claimed" || run.status === "started" || run.outcome === "awaiting_approval";
  const outcome =
    run.status === "skipped"
      ? "skipped"
      : run.status === "failed"
        ? "failed"
        : waiting
          ? "running"
          : run.outcome === "completed"
            ? "ok"
            : "failed";
  const error = run.reason !== null ? run.reason : run.outcome === "aborted" ? "aborted" : null;
  return {
    runId: run.runId,
    startedAt: isoOf(run.startedAt ?? run.claimedAt),
    endedAt: waiting || run.endedAt === null ? null : isoOf(run.endedAt),
    outcome,
    threadId: run.threadId,
    error: outcome === "ok" || outcome === "running" ? null : error,
  };
}

export function createDialogAreaPort(deps: M4PortDeps): DialogAreaPort {
  const { schedule, dialogArea } = deps;

  function threadExists(threadId: ThreadId): DialogAreaFailure | undefined {
    const found = deps.threads.exists(threadId);
    // 읽기 연결의 busy·io는 오류 값이다. 존재를 모르는 채로 빈 결과를 내지 않는다
    if (!found.ok) return { kind: "read_failed", error: found.error };
    return found.value ? undefined : { kind: "thread_not_found", threadId };
  }

  async function opened(): Promise<DialogAreaFailure | undefined> {
    const loaded = await schedule.open();
    return loaded.ok ? undefined : { kind: "store_failed", message: loaded.error.message };
  }

  function entryOf(scheduleId: string): ScheduleEntry | undefined {
    return schedule.list().find((entry) => entry.id === scheduleId);
  }

  /** 기억 기능을 사람이 연 호출로 부른다. 기능 오류는 와이어가 아는 실패로 옮긴다 */
  async function memoryCall<T>(
    run: (api: MemoryApi, options: CallOptions) => Promise<T>,
    signal: AbortSignal,
  ): Promise<DialogAreaOutcome<T>> {
    const api = dialogArea.memory;
    if (api === undefined) return err({ kind: "unavailable" });
    const options: CallOptions = { signal, context: { caller: { kind: "host" } } };
    const done = await attemptAsync(() => run(api, options));
    if (done.ok) return ok(done.value);
    const cause = done.error.cause;
    if (isCapabilityError(cause)) {
      // 기억 설정이 꺼져 있으면 기능이 없는 것과 같은 답이다(-32601)
      if (cause.data.code === "unavailable") return err({ kind: "unavailable" });
      if (cause.data.code === "not_found") return err({ kind: "unknown", path: "entryId", id: "" });
      if (cause.data.code === "base_stale")
        return err({ kind: "unknown", path: "baseHash", id: "" });
    }
    return err(rejectedOf(cause));
  }

  return {
    reviewGet(reviewId) {
      // 산출물 확장이 올라와 있지 않으면 본문을 읽을 수 없다(-32601). 확장이 내려가면 자리가 비므로 그때도 같다
      const reader = dialogArea.reviews;
      if (reader === undefined) return Promise.resolve(err({ kind: "unavailable" }));
      const found = reviewOf(reader, reviewId);
      if (!found.ok) return Promise.resolve(err(found.error));
      if (found.value === undefined) {
        return Promise.resolve(err({ kind: "unknown", path: "reviewId", id: reviewId }));
      }
      return Promise.resolve(ok(reviewGetResultOf(found.value)));
    },

    async goalStatus(threadId, signal): Promise<DialogAreaOutcome<{ goal: GoalView | null }>> {
      const missing = threadExists(threadId);
      if (missing !== undefined) return err(missing);
      const api = dialogArea.goals;
      if (api === undefined) return ok({ goal: null });
      const options: CallOptions = { signal, context: hostContext(threadId) };
      const status = await attemptAsync(() => api.status({ closed: true }, options));
      if (!status.ok) return err(rejectedOf(status.error.cause));
      const { goal } = status.value;
      return ok({ goal: goal === null ? null : goalViewOf(goal) });
    },

    async tasksList(threadId, signal) {
      const missing = threadExists(threadId);
      if (missing !== undefined) return err(missing);
      const api = dialogArea.tasks;
      if (api === undefined) return ok({ tasks: [] });
      const options: CallOptions = { signal, context: hostContext(threadId) };
      const listed = await attemptAsync(() => api.list({}, options));
      if (!listed.ok) return err(rejectedOf(listed.error.cause));
      return ok({ tasks: taskViewsOf(listed.value.tasks) });
    },

    async skillView(name, threadId, signal) {
      if (threadId !== undefined) {
        const missing = threadExists(threadId);
        if (missing !== undefined) return err(missing);
      }
      const api = dialogArea.skills;
      if (api === undefined) return err({ kind: "unavailable" });
      // 작업 폴더가 없는 호출(thread 없이 부른 것)은 프로젝트 스킬을 찾지 않는다
      const context: CallContext =
        threadId === undefined ? { caller: { kind: "host" } } : hostContext(threadId);
      const options: CallOptions = { signal, context };
      const viewed = await attemptAsync(() => api.view({ name }, options));
      if (!viewed.ok) {
        const cause = viewed.error.cause;
        if (isCapabilityError(cause) && cause.data.code === "not_found") {
          return err({ kind: "unknown", path: "name", id: name });
        }
        // 스킬 설정(`l2.knowledge.skills.enabled`)이 꺼져 있으면 기능이 없는 것과 같은 답이다(-32601). 내부 오류로 내지 않는다
        if (isCapabilityError(cause) && cause.data.code === "unavailable") {
          return err({ kind: "unavailable" });
        }
        return err(rejectedOf(cause));
      }
      return ok(skillViewResultOf(viewed.value));
    },

    async skillList(threadId, signal) {
      if (threadId !== undefined) {
        const missing = threadExists(threadId);
        if (missing !== undefined) return err(missing);
      }
      const api = dialogArea.skills;
      if (api === undefined) return err({ kind: "unavailable" });
      const context: CallContext =
        threadId === undefined ? { caller: { kind: "host" } } : hostContext(threadId);
      const options: CallOptions = { signal, context };
      // 화면이 보는 목록은 지금 디스크와 신뢰 상태를 따른다: 대화 중에 둔 스킬과 그 사이에 준 폴더 신뢰가 turn을 기다리지 않고 보이게
      // 먼저 다시 훑는다. 실패해도 마지막 색인으로 답한다
      await attemptAsync(() => api.reindex({}, options));
      // 모델이 못 부르는 스킬도 슬래시로는 부를 수 있어 숨은 것까지 읽는다
      const listed = await attemptAsync(() => api.list({ includeHidden: true }, options));
      if (!listed.ok) {
        const cause = listed.error.cause;
        if (isCapabilityError(cause) && cause.data.code === "unavailable") {
          return err({ kind: "unavailable" });
        }
        return err(rejectedOf(cause));
      }
      return ok({
        skills: listed.value.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          scope: skill.scope,
          modelInvocable: skill.modelInvocable,
        })),
        diagnostics: listed.value.diagnostics,
      });
    },

    memoryRead: (params, signal) =>
      memoryCall(
        (api, options) =>
          api.read(params.stores === undefined ? {} : { stores: [...params.stores] }, options),
        signal,
      ),
    memoryAdd: (params, signal) => memoryCall((api, options) => api.add(params, options), signal),
    memoryReplace: (params, signal) =>
      memoryCall((api, options) => api.replace(params, options), signal),
    memoryRemove: (params, signal) =>
      memoryCall((api, options) => api.remove(params, options), signal),

    async plansVersions(threadId, planId, signal) {
      const missing = threadExists(threadId);
      if (missing !== undefined) return err(missing);
      const api = dialogArea.plans;
      if (api === undefined) return ok({ versions: [] });
      // 계획 id의 꼴이 맞지 않으면 그런 계획은 없다(기능을 부르지 않는다)
      const parsed = parse(PlanIdSchema, planId);
      if (!parsed.ok) return err({ kind: "unknown", path: "planId", id: planId });
      const planKey = parsed.value;
      const options: CallOptions = { signal, context: hostContext(threadId) };
      const listed = await attemptAsync(() => api.versions({ planId: planKey }, options));
      if (!listed.ok) {
        const cause = listed.error.cause;
        if (isCapabilityError(cause) && cause.data.code === "not_found") {
          return err({ kind: "unknown", path: "planId", id: planId });
        }
        return err(rejectedOf(cause));
      }
      return ok<PlanVersionsOutputValue>(listed.value);
    },

    async scheduleUpdate(params: ScheduleUpdateParams) {
      const failed = await opened();
      if (failed !== undefined) return err(failed);
      if (entryOf(params.scheduleId) === undefined) {
        return err({ kind: "unknown", path: "scheduleId", id: params.scheduleId });
      }
      const patch: UpdateInput = {
        ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
        ...(params.title === undefined ? {} : { title: params.title }),
        ...(params.prompt === undefined ? {} : { prompt: params.prompt }),
      };
      const updated = await schedule.update(params.scheduleId, patch);
      if (!updated.ok) {
        switch (updated.error.kind) {
          case "not_found":
            return err({ kind: "unknown", path: "scheduleId", id: params.scheduleId });
          case "limit_reached":
            return err({ kind: "limit_reached", max: updated.error.max });
          case "store_failed":
            return err({ kind: "store_failed", message: updated.error.message });
          default:
            return assertNever(updated.error, "UpdateError");
        }
      }
      const entry = updated.value;
      return ok({
        scheduleId: entry.id,
        enabled: entry.enabled,
        nextRunAt: entry.nextDueAt === null ? null : isoOf(entry.nextDueAt),
      });
    },

    async scheduleRuns(params) {
      const failed = await opened();
      if (failed !== undefined) return err(failed);
      if (entryOf(params.scheduleId) === undefined) {
        return err({ kind: "unknown", path: "scheduleId", id: params.scheduleId });
      }
      return ok({ runs: schedule.runs(params.scheduleId, params.limit).map(runRecordOf) });
    },
  };
}

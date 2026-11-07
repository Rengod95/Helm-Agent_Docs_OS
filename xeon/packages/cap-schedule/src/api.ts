import { assertNever, canonicalJson } from "@fresnel/contracts";
import {
  CapabilityError,
  ScheduleEntries,
  type CallerInfo,
  type CallOptions,
  type CapabilityApi,
  type DirectCreateMode,
  type ScheduleEntryView,
  type ScheduleListItem,
  type ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { approvalCallerOf, type ApprovalService } from "@fresnel/contracts/services";
import { freshRequestKey, sha256Hex } from "./hash.ts";
import type {
  RunRecord,
  ScheduleEntry,
  ScheduleService,
  StoreFailure,
  TriggerSpec,
} from "./types.ts";

// L2.schedule.spec §4.4.9. 기능 `schedule.entries`(F)의 서비스 구현. 엔진의 `Result`를 경계에서 한 번 `CapabilityError`로 바꾼다.
// 직접 호출(모델 경로 밖)은 설정 `l2.schedule.entries.directCreate`를 따른다: allow(기본), ask(승인), deny(거부) [결정: 2026-11-03 사용자].
// 모델 호출(`caller.kind === "model"`)은 이 설정을 읽지 않는다. 승인은 `schedule_create` 도구 정책이 이미 거쳤다.

const CAPABILITY = "schedule.entries" as const;
/** 호출 문맥이 없는 호출은 호스트가 직접 낸 호출이다(F.records.spec §3.3.1 caller 행) */
const HOST_CALLER: CallerInfo = { kind: "host" };
const APPROVAL_TITLE = "Approve a scheduled prompt?";
const APPROVAL_TOOL_NAME = "schedule.entries.create";

/** `ask`가 쓰는 승인 포트 모양. 전체 `ApprovalService`가 이 모양을 만족한다 */
export type ScheduleApprovals = Pick<ApprovalService, "request">;

export interface ScheduleApiOptions {
  /** 직접 호출의 만들기 방식. 호출마다 읽는다(설정 `l2.schedule.entries.directCreate`). 생략하면 allow다 */
  readonly directCreate?: (threadId: string | undefined) => DirectCreateMode;
  /** `ask`가 승인을 낼 서비스. 없으면 `ask`는 거부된다 */
  readonly approvals?: ScheduleApprovals;
  /** 참이면 서비스 모드가 꺼져 있어 틱이 돌지 않는다. `create` 결과에 `service_mode_off` 경고를 싣는다 */
  readonly serviceModeOff?: () => boolean;
  /**
   * 파일 감시 경로 중 허용 범위 밖이라 감시되지 않는 것을 고른다. 목록의 `outsideWatchPaths`가 쓴다.
   * 허용 범위는 호스트가 안다(감시를 허용하는 폴더는 L0.os의 몫이다). 생략하면 모든 경로가 허용된 것으로 본다
   */
  readonly outsideWatchPaths?: (paths: readonly string[]) => readonly string[];
}

type CreateCallInput = Parameters<CapabilityApi<typeof ScheduleEntries>["create"]>[0];

/** 트리거를 F 모양으로 옮긴다. `paths`는 복사해 엔진 상태의 배열을 호출자와 나누지 않는다 */
function triggerViewOf(trigger: TriggerSpec): ScheduleTrigger {
  return trigger.kind === "file_watch" ? { ...trigger, paths: [...trigger.paths] } : trigger;
}

function entryViewOf(entry: ScheduleEntry): ScheduleEntryView {
  return { ...entry, trigger: triggerViewOf(entry.trigger) };
}

/** `list` 한 쪽의 최대 항목 수. 입력 `limit`을 생략했을 때의 크기이기도 하다 */
const LIST_PAGE_MAX = 200;

/**
 * 저장 순서의 목록에서 한 쪽을 자른다(l2/F-01). 가장 새 쪽에서 시작하고 `before`가 있으면 그 항목보다 오래된 쪽이다.
 * 알 수 없는 `before`는 빈 쪽이다. 더 오래된 항목이 남으면 `nextBefore`가 이 쪽 가장 오래된 항목의 ID다
 */
export function pageEntries(
  entries: readonly ScheduleEntry[],
  before: string | undefined,
  limit: number = LIST_PAGE_MAX,
): { readonly page: readonly ScheduleEntry[]; readonly nextBefore: string | undefined } {
  const at = before === undefined ? entries.length : entries.findIndex((e) => e.id === before);
  const end = at < 0 ? 0 : at;
  const start = Math.max(0, end - limit);
  const page = entries.slice(start, end);
  return { page, nextBefore: start > 0 ? page[0]?.id : undefined };
}

/**
 * 보관 중인 실행 기록에서 놓친 기한의 수. `missed`인 기록마다 센다: 건너뛴 묶음은 `skippedCount`(적어도 1)이고
 * 따라잡아 실행한 기록은 1이다.
 */
export function missedRunsOf(runs: readonly RunRecord[]): number {
  return runs
    .filter((run) => run.missed)
    .reduce((total, run) => total + Math.max(1, run.skippedCount), 0);
}

/**
 * 목록 한 줄. 항목, 마지막 실행 기록, 놓친 기한 수와 허용 범위 밖 감시 경로를 싣는다. 기능 API와 와이어 처리기가 같이 쓴다
 * (`outsideWatchPaths`는 `ScheduleApiOptions`의 같은 이름 옵션이다).
 */
export function listItemOf(
  service: Pick<ScheduleService, "runs">,
  entry: ScheduleEntry,
  outsideWatchPaths: ((paths: readonly string[]) => readonly string[]) | undefined,
): ScheduleListItem {
  const outside =
    entry.trigger.kind === "file_watch" ? (outsideWatchPaths?.(entry.trigger.paths) ?? []) : [];
  return {
    entry: entryViewOf(entry),
    lastRun: service.runs(entry.id, 1)[0] ?? null,
    missedRuns: missedRunsOf(service.runs(entry.id, Number.MAX_SAFE_INTEGER)),
    ...(outside.length === 0 ? {} : { outsideWatchPaths: [...outside] }),
  };
}

function reject(
  method: string,
  code: string,
  message: string,
  detail?: JsonValue,
): CapabilityError {
  return new CapabilityError({
    capability: CAPABILITY,
    method,
    code,
    message,
    retryable: false,
    ...(detail === undefined ? {} : { detail }),
  });
}

function storeRejection(method: string, failure: StoreFailure): CapabilityError {
  return reject(method, "store_failed", "The schedule store failed.", {
    message: failure.message.slice(0, 512),
  });
}

function abortIf(method: string, signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw reject(method, "aborted", "The call was aborted.");
}

/** 승인 요청의 `args`. 호출 입력을 JSON 값으로 옮긴다(트리거의 `paths`는 복사한다) */
function argsOf(input: CreateCallInput): Readonly<Record<string, JsonValue>> {
  const trigger: ScheduleTrigger =
    input.trigger.kind === "file_watch"
      ? { ...input.trigger, paths: [...input.trigger.paths] }
      : input.trigger;
  return {
    trigger,
    prompt: input.prompt,
    ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  };
}

/**
 * `ask`: 호출한 대화에 승인을 내고 응답을 기다린다. 허용이면 돌아오고, 거부면 `denied`로 거부한다.
 * 대화가 없거나 무인 실행이면 사람이 답할 곳이 없으므로 승인을 내지 않고 거부한다(fail closed).
 */
async function askFirst(
  input: CreateCallInput,
  options: CallOptions | undefined,
  caller: CallerInfo,
  approvals: ScheduleApprovals | undefined,
): Promise<void> {
  const method = "create";
  if (approvals === undefined) {
    throw reject(method, "unavailable", "No approval service can ask for this schedule.");
  }
  const threadId = options?.context?.threadId;
  if (threadId === undefined) {
    throw reject(method, "unavailable", "No conversation is open to ask for this schedule in.");
  }
  if (options?.context?.interactive === false) {
    throw reject(method, "denied", "No one can answer the approval in an unattended run.");
  }
  const args = argsOf(input);
  const resolution = await approvals.request(
    {
      origin: {
        threadId,
        turnId: options?.context?.turnId ?? null,
        stepId: null,
        toolCallId: null,
        caller: approvalCallerOf(caller),
      },
      requestKey: freshRequestKey("schedule"),
      title: APPROVAL_TITLE,
      body: {
        kind: "tool",
        tool: {
          toolName: APPROVAL_TOOL_NAME,
          capability: { id: ScheduleEntries.id, method },
          risk: "exec",
          args,
          argsHash: sha256Hex(canonicalJson(args)),
          ruleId: null,
        },
      },
      remember: ["once"],
    },
    options?.signal ?? new AbortController().signal,
  );
  abortIf(method, options?.signal);
  if (!resolution.ok) {
    throw reject(method, "unavailable", "The approval request could not be recorded.");
  }
  if (resolution.value.decision !== "allow") {
    throw reject(method, "denied", "The approval for this schedule was not granted.");
  }
}

/** 예약 서비스를 기능 API로 감싼다. 기대한 실패는 모두 `CapabilityError`다 */
export function createScheduleApi(
  service: ScheduleService,
  deps: ScheduleApiOptions = {},
): CapabilityApi<typeof ScheduleEntries> {
  return {
    async create(input, options) {
      abortIf("create", options?.signal);
      const caller = options?.context?.caller ?? HOST_CALLER;
      if (caller.kind !== "model") {
        const mode = deps.directCreate?.(options?.context?.threadId) ?? "allow";
        if (mode === "deny") {
          throw reject(
            "create",
            "denied",
            "Direct schedule creation is turned off by l2.schedule.entries.directCreate.",
          );
        }
        if (mode === "ask") await askFirst(input, options, caller, deps.approvals);
      }
      const opened = await service.open();
      if (!opened.ok) throw storeRejection("create", opened.error);
      const created = await service.create({
        trigger: input.trigger,
        prompt: input.prompt,
        ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        createdBy: approvalCallerOf(caller),
      });
      if (created.ok) {
        // 서비스 모드가 꺼져 있으면 틱이 돌지 않는다: 호출자(모델 도구 포함)가 알도록 경고를 싣는다(L2.schedule.spec §4.4.6)
        return deps.serviceModeOff?.() === true
          ? { entry: entryViewOf(created.value), warnings: ["service_mode_off"] }
          : { entry: entryViewOf(created.value) };
      }
      const error = created.error;
      switch (error.kind) {
        case "interval_too_short":
          throw reject(
            "create",
            "interval_too_short",
            "The interval is shorter than the minimum.",
            {
              minSeconds: error.minSeconds,
            },
          );
        case "at_in_past":
          throw reject("create", "at_in_past", "The time has already passed.");
        case "invalid_trigger":
          throw reject("create", "invalid_trigger", "The trigger is not valid.", {
            reason: error.reason.slice(0, 200),
          });
        case "limit_reached":
          throw reject("create", "limit_reached", "Too many active schedules.", { max: error.max });
        case "store_failed":
          throw storeRejection("create", error);
        default:
          return assertNever(error, "createScheduleApi.create");
      }
    },

    async list(input, options) {
      abortIf("list", options?.signal);
      const opened = await service.open();
      if (!opened.ok) throw storeRejection("list", opened.error);
      const { page, nextBefore } = pageEntries(
        service
          .list()
          .filter((entry) => input.enabled === undefined || entry.enabled === input.enabled),
        input.before,
        input.limit,
      );
      const items = page.map((entry) => listItemOf(service, entry, deps.outsideWatchPaths));
      return nextBefore === undefined ? { items } : { items, nextBefore };
    },

    async cancel(input, options) {
      abortIf("cancel", options?.signal);
      const cancelled = await service.cancel(input.scheduleId);
      if (cancelled.ok) return { entry: entryViewOf(cancelled.value) };
      if (cancelled.error.kind === "not_found") {
        throw reject("cancel", "not_found", "No such schedule.");
      }
      throw storeRejection("cancel", cancelled.error);
    },

    async fire(input, options) {
      abortIf("fire", options?.signal);
      const fired = await service.fire(input.scheduleId);
      if (fired.ok) return { run: fired.value };
      const error = fired.error;
      switch (error.kind) {
        case "not_found":
          throw reject("fire", "not_found", "No such schedule.");
        case "not_remote":
          throw reject("fire", "not_remote", "The schedule is not a remote trigger.");
        case "disabled":
          throw reject("fire", "disabled", "The schedule is off.");
        case "store_failed":
          throw storeRejection("fire", error);
        default:
          return assertNever(error, "createScheduleApi.fire");
      }
    },
  };
}

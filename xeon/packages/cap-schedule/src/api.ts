import { assertNever } from "@fresnel/contracts";
import {
  CapabilityError,
  type CapabilityApi,
  type ScheduleEntries,
  type ScheduleEntryView,
  type ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { ScheduleEntry, ScheduleService, StoreFailure, TriggerSpec } from "./types.ts";

// L2.schedule.spec §4.4.9. 기능 `schedule.entries`(F)의 서비스 구현. 엔진의 `Result`를 경계에서 한 번 `CapabilityError`로 바꾼다.

const CAPABILITY = "schedule.entries" as const;

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

/** 예약 서비스를 기능 API로 감싼다. 기대한 실패는 모두 `CapabilityError`다 */
export function createScheduleApi(
  service: ScheduleService,
  behavior: { readonly serviceModeOff?: () => boolean } = {},
): CapabilityApi<typeof ScheduleEntries> {
  return {
    async create(input, options) {
      abortIf("create", options?.signal);
      const opened = await service.open();
      if (!opened.ok) throw storeRejection("create", opened.error);
      const created = await service.create({
        trigger: input.trigger,
        prompt: input.prompt,
        ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      });
      if (created.ok) {
        // 서비스 모드가 꺼져 있으면 틱이 돌지 않는다: 호출자(모델 도구 포함)가 알도록 경고를 싣는다(L2.schedule.spec §4.4.6)
        return behavior.serviceModeOff?.() === true
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
      const items = page.map((entry) => ({
        entry: entryViewOf(entry),
        lastRun: service.runs(entry.id, 1)[0] ?? null,
      }));
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

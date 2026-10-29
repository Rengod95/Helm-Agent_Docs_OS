import { assertNever } from "@xeon/contracts";
import {
  CapabilityError,
  type CapabilityApi,
  type ScheduleEntries,
  type ScheduleEntryView,
  type ScheduleTrigger,
} from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { ScheduleEntry, ScheduleService, StoreFailure, TriggerSpec } from "./types.ts";

// L2.schedule.spec §4.4.9. 능력 `schedule.entries`(F)의 서비스 구현. 엔진의 `Result`를 경계에서 한 번 `CapabilityError`로 바꾼다.

const CAPABILITY = "schedule.entries" as const;

/** 트리거를 F 모양으로 옮긴다. `paths`는 복사해 엔진 상태의 배열을 호출자와 나누지 않는다 */
function triggerViewOf(trigger: TriggerSpec): ScheduleTrigger {
  return trigger.kind === "file_watch" ? { ...trigger, paths: [...trigger.paths] } : trigger;
}

function entryViewOf(entry: ScheduleEntry): ScheduleEntryView {
  return { ...entry, trigger: triggerViewOf(entry.trigger) };
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

/** 예약 서비스를 능력 API로 감싼다. 기대한 실패는 모두 `CapabilityError`다 */
export function createScheduleApi(service: ScheduleService): CapabilityApi<typeof ScheduleEntries> {
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
      if (created.ok) return { entry: entryViewOf(created.value) };
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
      const items = service
        .list()
        .filter((entry) => input.enabled === undefined || entry.enabled === input.enabled)
        .slice(0, 200)
        .map((entry) => ({
          entry: entryViewOf(entry),
          lastRun: service.runs(entry.id, 1)[0] ?? null,
        }));
      return { items };
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

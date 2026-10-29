import type {
  CancelError,
  CreateError,
  FireError,
  ScheduleEntry,
  ScheduleService,
  StoreFailure,
} from "@xeon/cap-schedule";
import type { ScheduleEntryView, ScheduleTrigger } from "@xeon/contracts/capabilities";
import type { WireHandlers, WireResult } from "@xeon/contracts/wire";
import type { Engine } from "../types.ts";

// F wire `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`(M3b B1-SCH2, L2.schedule.spec §4.4.9).
// 예약 서비스(`EnginePorts.schedule`)를 그대로 부른다. 기대한 실패는 JSON-RPC 오류가 아니라 `ok: false`의 `error` 값이다.
// 스레드를 건드리지 않으므로 쓰기 소유를 얻지 않는다. 네 처리기는 모두 `open()`을 먼저 부른다. 읽지 못하면(파일 손상 포함)
// 어떤 호출도 서비스의 쓰기를 부르지 않고 `store_failed`를 돌려준다.
// 틱은 서비스 모드에서만 돈다. 그 밖의 모드에서 만든 항목은 저장만 되고 실행되지 않으므로 `service_mode_off` 경고를 싣는다.

type WireError = Extract<WireResult<"schedule.list">, { readonly ok: false }>["error"];
type ScheduleFailed = { readonly ok: false; readonly error: WireError };
type Opened = { readonly ok: true; readonly service: ScheduleService } | ScheduleFailed;

/** 엔진의 실패 값을 와이어 모양으로 옮긴다. 저장 실패 메시지(512자)와 트리거 사유(200자)는 스키마 상한에 맞게 자른다 */
function errorOf(error: CreateError | CancelError | FireError | StoreFailure): WireError {
  if (error.kind === "store_failed")
    return { kind: "store_failed", message: error.message.slice(0, 512) };
  if (error.kind === "invalid_trigger")
    return { kind: "invalid_trigger", reason: error.reason.slice(0, 200) };
  return error;
}

/** 항목을 와이어 모양으로 옮긴다. 엔진의 `readonly paths`는 복사해 호출자와 나누지 않는다(cap-schedule `entryViewOf`와 같은 규칙) */
function entryViewOf(entry: ScheduleEntry): ScheduleEntryView {
  const trigger: ScheduleTrigger =
    entry.trigger.kind === "file_watch"
      ? { ...entry.trigger, paths: [...entry.trigger.paths] }
      : entry.trigger;
  return { ...entry, trigger };
}

async function opened(service: ScheduleService): Promise<Opened> {
  const loaded = await service.open();
  return loaded.ok ? { ok: true, service } : { ok: false, error: errorOf(loaded.error) };
}

export function createScheduleHandlers(
  engine: Engine,
): Pick<WireHandlers, "schedule.create" | "schedule.list" | "schedule.cancel" | "schedule.fire"> {
  const service = engine.ports.schedule;
  return {
    "schedule.create": async (params) => {
      const open = await opened(service);
      if (!open.ok) return open;
      const created = await open.service.create({
        trigger: params.trigger,
        prompt: params.prompt,
        ...(params.workspace === undefined ? {} : { workspace: params.workspace }),
        ...(params.title === undefined ? {} : { title: params.title }),
        ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
      });
      if (!created.ok) return { ok: false, error: errorOf(created.error) };
      const warnings: "service_mode_off"[] = engine.mode === "service" ? [] : ["service_mode_off"];
      return { ok: true, entry: entryViewOf(created.value), warnings };
    },

    "schedule.list": async (params) => {
      const open = await opened(service);
      if (!open.ok) return open;
      const items = open.service
        .list()
        .filter((entry) => params.enabled === undefined || entry.enabled === params.enabled)
        .slice(0, 200)
        .map((entry) => ({
          entry: entryViewOf(entry),
          lastRun: open.service.runs(entry.id, 1)[0] ?? null,
        }));
      return { ok: true, items };
    },

    "schedule.cancel": async (params) => {
      const open = await opened(service);
      if (!open.ok) return open;
      const cancelled = await open.service.cancel(params.scheduleId);
      return cancelled.ok
        ? { ok: true, entry: entryViewOf(cancelled.value) }
        : { ok: false, error: errorOf(cancelled.error) };
    },

    "schedule.fire": async (params) => {
      const open = await opened(service);
      if (!open.ok) return open;
      const fired = await open.service.fire(params.scheduleId);
      return fired.ok ? { ok: true, run: fired.value } : { ok: false, error: errorOf(fired.error) };
    },
  };
}

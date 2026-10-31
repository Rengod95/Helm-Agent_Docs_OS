import { resolve } from "node:path";
import { t } from "@xeon/client/i18n";
import { assertNever, type Clock } from "@xeon/contracts";
import type {
  ScheduleError,
  ScheduleListItem,
  ScheduleTrigger,
} from "@xeon/contracts/capabilities";
import type { ScheduleCommand, ScheduleTriggerArg } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import type { Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { printFailure, withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 schedule. add는 schedule.create, list는 schedule.list, cancel은 schedule.cancel, run은 schedule.fire를 부른다.
// 기대한 실패(간격 미달, 없음, 원격 아님, 꺼짐, 상한, 저장 실패)는 `ok: false` 값이라 문구와 종료 코드로 바꾼다.
// 예약 파일 위치는 host가 정하므로 CLI는 문구에서 `schedule/state.json`만 말한다.

/** 연결한 host가 예약 명령을 모를 때의 실패. 문구는 쓸 때 현재 로케일로 만든다 */
function unsupportedFailure(): Failure {
  return {
    message: t("cli.errors.schedule.unsupported.message"),
    fix: t("cli.errors.schedule.unsupported.fix"),
    code: EXIT.environment,
  };
}

/** 서비스 모드가 꺼져 있으면 host는 저장만 하고 틱을 돌리지 않는다(apps/host handlers/schedule.ts) */
function serviceModeOffWarning(): string {
  return t("cli.schedule.serviceModeOff");
}

const LIST_NAME_MAX = 40;

type ScheduleAdd = Extract<ScheduleCommand, { kind: "schedule.add" }>;
type ScheduleList = Extract<ScheduleCommand, { kind: "schedule.list" }>;
type ScheduleCancel = Extract<ScheduleCommand, { kind: "schedule.cancel" }>;
type ScheduleRun = Extract<ScheduleCommand, { kind: "schedule.run" }>;

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 트리거 한 줄 요약. 목록과 add의 결과 줄이 같이 쓴다 */
function triggerText(trigger: ScheduleTrigger): string {
  switch (trigger.kind) {
    case "interval":
      return t("cli.schedule.trigger.interval", { seconds: trigger.everySeconds });
    case "at":
      return t("cli.schedule.trigger.at", { time: isoOf(trigger.atMs) });
    case "file_watch":
      return t("cli.schedule.trigger.watch", {
        paths: trigger.paths.join(", "),
        debounce: trigger.debounceMs,
      });
    case "remote":
      return t("cli.schedule.trigger.remote");
    case "loop":
      return t("cli.schedule.trigger.loop", {
        seconds: trigger.intervalSeconds,
        max: trigger.maxIterations,
        expires: isoOf(trigger.expiresAtMs),
      });
    default:
      return assertNever(trigger, "ScheduleTrigger");
  }
}

/** CLI의 트리거 값을 wire 모양으로 옮긴다. 상대 경로는 작업 폴더 기준으로 절대 경로가 되고, 만료는 지금 시각에서 센다 */
function wireTriggerOf(arg: ScheduleTriggerArg, root: string, clock: Clock): ScheduleTrigger {
  switch (arg.kind) {
    case "every":
      return { kind: "interval", everySeconds: arg.everySeconds };
    case "at":
      return { kind: "at", atMs: arg.atMs };
    case "remote":
      return { kind: "remote" };
    case "watch":
      return {
        kind: "file_watch",
        paths: arg.paths.map((path) => resolve(root, path)),
        debounceMs: arg.debounceMs,
      };
    case "loop":
      return {
        kind: "loop",
        intervalSeconds: arg.intervalSeconds,
        maxIterations: arg.maxIterations,
        expiresAtMs: clock.now() + arg.expiresInSeconds * 1000,
      };
    default:
      return assertNever(arg, "ScheduleTriggerArg");
  }
}

/** 목록 한 줄: id, on·off, 트리거, 다음 기한, 마지막 실행, 제목(없으면 프롬프트 앞 40자) */
function listLine(item: ScheduleListItem): string {
  const { entry, lastRun } = item;
  const next = entry.nextDueAt === null ? "-" : isoOf(entry.nextDueAt);
  const last =
    lastRun === null
      ? t("cli.secret.none")
      : `${lastRun.status}/${lastRun.outcome ?? "-"} ${isoOf(lastRun.claimedAt)}`;
  // 줄바꿈이 든 프롬프트가 목록 한 줄을 깨지 않게 공백을 한 칸으로 줄인다
  const name = Array.from((entry.title ?? entry.prompt).replace(/\s+/g, " "))
    .slice(0, LIST_NAME_MAX)
    .join("");
  const state = entry.enabled ? "on" : "off";
  return t("cli.schedule.listLine", {
    id: entry.id,
    state,
    trigger: triggerText(entry.trigger),
    next,
    last,
    name,
  });
}

/** 기대한 실패 값을 문구와 종료 코드로 바꾼다. 간격 최소값은 host가 준 값을 싣는다 */
function failureOf(error: ScheduleError): Failure {
  switch (error.kind) {
    case "interval_too_short":
      return {
        message: t("cli.errors.schedule.intervalTooShort.message", {
          minSeconds: error.minSeconds,
        }),
        fix: t("cli.errors.schedule.intervalTooShort.fix", { minSeconds: error.minSeconds }),
        code: EXIT.error,
      };
    case "at_in_past":
      return {
        message: t("cli.errors.schedule.atInPast.message"),
        fix: t("cli.errors.schedule.atInPast.fix"),
        code: EXIT.error,
      };
    case "invalid_trigger":
      return {
        message: t("cli.errors.schedule.invalidTrigger.message", { reason: error.reason }),
        fix: t("cli.errors.schedule.invalidTrigger.fix"),
        code: EXIT.error,
      };
    case "limit_reached":
      return {
        message: t("cli.errors.schedule.limitReached.message", { max: error.max }),
        fix: t("cli.errors.schedule.limitReached.fix"),
        code: EXIT.error,
      };
    case "not_found":
      return {
        message: t("cli.errors.schedule.notFound.message"),
        fix: t("cli.errors.schedule.notFound.fix"),
        code: EXIT.error,
      };
    case "not_remote":
      return {
        message: t("cli.errors.schedule.notRemote.message"),
        fix: t("cli.errors.schedule.notRemote.fix"),
        code: EXIT.error,
      };
    case "disabled":
      return {
        message: t("cli.errors.schedule.disabled.message"),
        fix: t("cli.errors.schedule.disabled.fix"),
        code: EXIT.error,
      };
    case "store_failed":
      // 저장소 실패는 환경 문제다. host가 준 메시지는 싣지 않는다(§4.10: 값과 원문을 문구에 옮기지 않는다)
      return {
        message: t("cli.errors.schedule.storeFailed.message"),
        fix: t("cli.errors.schedule.storeFailed.fix"),
        code: EXIT.environment,
      };
    default:
      return assertNever(error, "ScheduleError");
  }
}

async function fail(ctx: CommandContext, failure: Failure): Promise<ExitCode> {
  await printFailure(ctx.io, failure);
  return failure.code;
}

async function unsupported(ctx: CommandContext): Promise<ExitCode> {
  return fail(ctx, unsupportedFailure());
}

async function runAdd(
  ctx: CommandContext,
  handle: EngineHandle,
  command: ScheduleAdd,
): Promise<ExitCode> {
  if (!handle.supports("schedule.create")) return unsupported(ctx);
  const created = await handle.connection.request("schedule.create", {
    trigger: wireTriggerOf(command.trigger, ctx.workspace, ctx.deps.clock),
    prompt: command.prompt,
    ...(command.workspace === null ? {} : { workspace: resolve(ctx.workspace, command.workspace) }),
    ...(command.title === null ? {} : { title: command.title }),
    ...(command.disabled ? { enabled: false } : {}),
  });
  if (!created.ok) return fail(ctx, failureOf(created.error));
  const { entry, warnings } = created;
  const next = entry.nextDueAt === null ? t("cli.secret.none") : isoOf(entry.nextDueAt);
  await ctx.io.stdout(
    t("cli.schedule.added", { id: entry.id, trigger: triggerText(entry.trigger), next }),
  );
  if (warnings.includes("service_mode_off")) await ctx.io.stderr(serviceModeOffWarning());
  return EXIT.ok;
}

async function runList(
  ctx: CommandContext,
  handle: EngineHandle,
  command: ScheduleList,
): Promise<ExitCode> {
  if (!handle.supports("schedule.list")) return unsupported(ctx);
  // 기본은 켜진 예약만이다. --all이면 끈 예약도 본다
  const listed = await handle.connection.request(
    "schedule.list",
    command.all ? {} : { enabled: true },
  );
  if (!listed.ok) return fail(ctx, failureOf(listed.error));
  const { items } = listed;
  if (command.output === "json") {
    await ctx.io.stdout(`${JSON.stringify(items, null, 2)}\n`);
  } else if (items.length > 0) {
    await ctx.io.stdout(`${items.map(listLine).join("\n")}\n`);
  }
  if (items.length === 0) await ctx.io.stderr(t("cli.schedule.listEmpty"));
  return EXIT.ok;
}

async function runCancel(
  ctx: CommandContext,
  handle: EngineHandle,
  command: ScheduleCancel,
): Promise<ExitCode> {
  if (!handle.supports("schedule.cancel")) return unsupported(ctx);
  const cancelled = await handle.connection.request("schedule.cancel", {
    scheduleId: command.scheduleId,
  });
  if (!cancelled.ok) return fail(ctx, failureOf(cancelled.error));
  await ctx.io.stdout(t("cli.schedule.cancelled", { id: cancelled.entry.id }));
  return EXIT.ok;
}

async function runFire(
  ctx: CommandContext,
  handle: EngineHandle,
  command: ScheduleRun,
): Promise<ExitCode> {
  if (!handle.supports("schedule.fire")) return unsupported(ctx);
  const fired = await handle.connection.request("schedule.fire", {
    scheduleId: command.scheduleId,
  });
  if (!fired.ok) return fail(ctx, failureOf(fired.error));
  const { run } = fired;
  await ctx.io.stdout(
    t("cli.schedule.fired", { id: command.scheduleId, runId: run.runId, status: run.status }),
  );
  return EXIT.ok;
}

/** `xeon schedule`을 실행하고 종료 코드를 돌려준다 */
export async function runSchedule(
  ctx: CommandContext,
  command: ScheduleCommand,
): Promise<ExitCode> {
  return withEngine(ctx, (handle) => {
    switch (command.kind) {
      case "schedule.add":
        return runAdd(ctx, handle, command);
      case "schedule.list":
        return runList(ctx, handle, command);
      case "schedule.cancel":
        return runCancel(ctx, handle, command);
      case "schedule.run":
        return runFire(ctx, handle, command);
      default:
        return assertNever(command, "ScheduleCommand");
    }
  });
}

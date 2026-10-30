import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import {
  EMPTY_STATE,
  type ScheduleState,
  type ScheduleStore,
  type StoreFailure,
} from "@xeon/cap-schedule";
import { Type, type TSchema } from "typebox";
import { messageOf } from "../util.ts";

// L2.schedule.spec §4.4.9. 예약 상태를 상태 디렉터리의 JSON 파일 하나로 둔다(`<dirs.state>/schedule/state.json`).
// 쓰기는 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다(원자 교체). 파일은 0600, 디렉터리는 0700이다.
// 읽을 때는 형태를 typebox로 검사한다. 손상된 파일은 `store_failed`이고 빈 상태로 덮어 쓰지 않는다(호출자가 정한다).

const STATE_FILE_NAME = "state.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const nullable = <Inner extends TSchema>(inner: Inner) => Type.Union([inner, Type.Null()]);

const TriggerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("interval"), everySeconds: Type.Number() }),
  Type.Object({ kind: Type.Literal("at"), atMs: Type.Number() }),
  Type.Object({
    kind: Type.Literal("file_watch"),
    paths: Type.Array(Type.String()),
    debounceMs: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("remote") }),
  Type.Object({
    kind: Type.Literal("loop"),
    intervalSeconds: Type.Number(),
    maxIterations: Type.Number(),
    expiresAtMs: Type.Number(),
  }),
]);

const StopReasonSchema = Type.Union([
  Type.Literal("cancelled"),
  Type.Literal("completed"),
  Type.Literal("max_iterations"),
  Type.Literal("expired"),
  Type.Literal("host_exit"),
  Type.Literal("run_failed"),
]);

const EntrySchema = Type.Object({
  id: Type.String(),
  trigger: TriggerSchema,
  prompt: Type.String(),
  workspace: nullable(Type.String()),
  title: nullable(Type.String()),
  sessionKind: Type.Literal("cron"),
  enabled: Type.Boolean(),
  createdAt: Type.Number(),
  nextDueAt: nullable(Type.Number()),
  lastStartedAt: nullable(Type.Number()),
  iterations: Type.Number(),
  stoppedReason: nullable(StopReasonSchema),
});

const RunSchema = Type.Object({
  runId: Type.String(),
  scheduleId: Type.String(),
  firedBy: Type.Union([
    Type.Literal("interval"),
    Type.Literal("at"),
    Type.Literal("file_watch"),
    Type.Literal("remote"),
    Type.Literal("loop"),
  ]),
  dueAt: Type.Number(),
  claimedAt: Type.Number(),
  missed: Type.Boolean(),
  status: Type.Union([
    Type.Literal("claimed"),
    Type.Literal("started"),
    Type.Literal("finished"),
    Type.Literal("skipped"),
    Type.Literal("failed"),
  ]),
  threadId: nullable(Type.String()),
  startedAt: nullable(Type.Number()),
  endedAt: nullable(Type.Number()),
  outcome: nullable(
    Type.Union([
      Type.Literal("completed"),
      Type.Literal("aborted"),
      Type.Literal("failed"),
      Type.Literal("awaiting_approval"),
    ]),
  ),
  reason: nullable(
    Type.Union([
      Type.Literal("missed"),
      Type.Literal("too_old"),
      Type.Literal("min_interval"),
      Type.Literal("overlap"),
      Type.Literal("rate_limited"),
      Type.Literal("host_exit"),
      Type.Literal("start_failed"),
      Type.Literal("run_failed"),
    ]),
  ),
  skippedCount: Type.Number(),
});

const ScheduleStateSchema = Type.Object({
  version: Type.Literal(1),
  entries: Type.Array(EntrySchema),
  runs: Type.Array(RunSchema),
});

function codeOf(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : undefined;
}

function failure(message: string): Result<never, StoreFailure> {
  return err({ kind: "store_failed", message });
}

/**
 * 파일 저장소. `dir`은 상태 디렉터리 아래의 예약 폴더다. 저장은 호출 순서대로 하나씩 돈다(예약 서비스가 직렬화한다).
 * 실패는 `store_failed`로 돌려준다. 실패한 쓰기가 남긴 임시 파일은 지운다.
 */
export function createFileScheduleStore(dir: string): ScheduleStore {
  const path = join(dir, STATE_FILE_NAME);
  const tempPath = `${path}.tmp`;

  return {
    async load(): Promise<Result<ScheduleState, StoreFailure>> {
      const read = await attemptAsync(() => readFile(path, "utf8"));
      if (!read.ok) {
        // 파일이 없으면 처음 상태다
        if (codeOf(read.error.cause) === "ENOENT") return ok(EMPTY_STATE);
        return failure(`state file cannot be read: ${codeOf(read.error.cause) ?? "io"}`);
      }
      const json = parseJson(read.value);
      if (!json.ok) return failure("state file is not JSON");
      const parsed = parse(ScheduleStateSchema, json.value);
      if (!parsed.ok) {
        const paths = parsed.error.issues
          .slice(0, 3)
          .map((issue) => issue.path || "/")
          .join(", ");
        return failure(`state file has an invalid shape at ${paths}`);
      }
      return ok(parsed.value);
    },

    async save(state: ScheduleState): Promise<Result<void, StoreFailure>> {
      const text = `${JSON.stringify(state)}\n`;
      const written = await attemptAsync(async () => {
        await mkdir(dir, { recursive: true, mode: DIR_MODE });
        await chmod(dir, DIR_MODE);
        const handle = await open(tempPath, "w", FILE_MODE);
        try {
          await handle.writeFile(text);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await chmod(tempPath, FILE_MODE);
        await rename(tempPath, path);
      });
      if (written.ok) return ok(undefined);
      const cleaned = await attemptAsync(() => rm(tempPath, { force: true }));
      const cleanup = cleaned.ok
        ? ""
        : `; temp file not removed: ${messageOf(cleaned.error.cause)}`;
      return failure(
        `state file cannot be written: ${codeOf(written.error.cause) ?? messageOf(written.error.cause)}${cleanup}`,
      );
    },
  };
}

import { describe, expect, test } from "bun:test";
import type { ScheduleTicker, SchedulePolicy } from "@fresnel/cap-schedule";
import { WorkGoalsKey } from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { wireError, type HostConnection } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { startService, type ServiceHandle, type ServiceStart } from "../../src/index.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  eventually,
  manualTime,
  scratchRuntimeDir,
  wireErrorOf,
  type ManualTime,
} from "../fixtures/service-harness.ts";
import { answeringModels, sequencedModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M4 대화 영역 wire(W-05 `goal.status`, W-06 `work.tasks.list`, W-07 `schedule.update`·`schedule.runs`)와 `ThreadSummary.origin`(W-16)을
// 실제 엔진에서 본다. 목표와 작업은 인-프로세스 호스트에서, 예약 실행은 틱을 돌리는 서비스 모드에서 시험한다(in-process는 틱이 돌지 않는다, HS-40).
// 모델은 테이프가 답하고, 목표 설정은 시험용 확장이 `work.goals`의 `set`으로 건다(goal-judge.int.test.ts와 같은 방식).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 세션 범위 판정 상한. 목표가 설정될 때 `Goal.maxRuns`에 적힌다. 기본값 3과 다른 값으로 두어 연결을 확인한다 */
const MAX_RUNS = 4;
const GOAL_CONDITION = "The report section is written and checked against the sources.";
/** thread 이름을 이 값으로 바꾸면 시험용 확장이 목표를 건다(`thread.info.after`) */
const SET_GOAL_ON_RENAME = "목표를 건다";
const UNKNOWN_THREAD = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAX";
const MISSING_SCHEDULE = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAX";
const INTERVAL_MS = 300_000;
const ONE_MINUTE_MS = 60_000;
const GRACE_MS = 60_000;
const PROMPT = "nightly summary: list the open items";
const EDITED_PROMPT = "weekly summary: list the open items";
const FIRST_ANSWER = "three items are open";
const SECOND_ANSWER = "two items are open";

/** 목표 설정 확장 본체. thread 이름이 정해진 값이 되면 `work.goals`의 `set`을 부른다 */
const goalExtension: ExtensionEntry = ({ manifest: loaded, register }) => {
  register(loaded.name, {}, (g) => {
    g.on("thread.info.after", async ({ threadId, name }) => {
      if (name !== SET_GOAL_ON_RENAME) return;
      await g
        .capability(WorkGoalsKey)
        .set({ condition: GOAL_CONDITION }, { requestId: `goal-probe:${threadId}` });
    });
  });
};

/** 목표 설정 확장의 모듈. 확장이 쓰는 기능(`work.goals`)을 `requires`에 적는다 */
function goalProbe(): HostPluginModule {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: "dialog-area-goal-probe",
    version: "0.1.0",
    entry: "./index.ts",
    plugins: [
      {
        layer: "plugin",
        hooks: ["thread.info.after"],
        requires: [{ id: "work.goals", range: "^1.0.0" }],
      },
    ],
    trust: { level: "builtin" },
  });
  return { manifest, extension: goalExtension };
}

/** 틱을 시험이 돌린다. `every`가 건 콜백을 잡아 두고, 틱 한 번은 `handle.schedule().tick()`으로 부른다 */
function manualTicker(): ScheduleTicker {
  const state: { tick: (() => void) | undefined } = { tick: undefined };
  return {
    every(_periodMs: number, tick: () => void) {
      state.tick = tick;
      return () => {
        state.tick = undefined;
      };
    },
  };
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

interface Service {
  readonly handle: ServiceHandle;
  readonly client: HostConnection;
  readonly time: ManualTime;
  dispose(): Promise<void>;
}

/** 틱을 시험이 돌리는 서비스를 세우고 소켓으로 붙는다. 예약 실행의 대화는 `answers`를 차례로 답한다 */
async function startSchedulingService(
  answers: readonly string[],
  policy?: Partial<SchedulePolicy>,
): Promise<Service> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
  const runtime = scratchRuntimeDir();
  const time = manualTime();
  const started: ServiceStart = await startService({
    runtimeDir: runtime.dir,
    assemble: {
      devChecks: true,
      defaultGroups: false,
      buildModels: sequencedModels("dialog-area-schedule", answers),
      schedule: {
        clock: time.clock,
        ticker: manualTicker(),
        ...(policy === undefined ? {} : { policy }),
      },
    },
    time,
    handleSignals: false,
    startupGraceMs: 0,
    idleGraceMs: GRACE_MS,
  });
  if (!started.started) {
    runtime.dispose();
    home.dispose();
    throw new Error(`the service did not start: ${started.reason}`);
  }
  const handle = started.handle;
  const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
  return {
    handle,
    client,
    time,
    async dispose() {
      await client.close();
      await handle.shutdown("stop");
      runtime.dispose();
      home.dispose();
    },
  };
}

describe("dialog area over the wire, on the real engine", () => {
  realTest(
    "goal.status reports no goal until a probe sets one, shows it as active with the configured maximum, and answers an unknown thread with thread.notFound",
    async () => {
      const home = useEngineHome();
      writeUserSettings(home, { ...TAPE_SETTINGS, "l1.agents.judge.maxRuns": MAX_RUNS });
      const host = await startInProcessHost({
        devChecks: true,
        defaultGroups: false,
        buildModels: answeringModels("dialog-area-goal", "unused"),
        extraPlugins: [goalProbe()],
      });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      expect(await connection.request("goal.status", { threadId: created.threadId })).toEqual({
        goal: null,
      });
      await connection.request("thread.rename", {
        threadId: created.threadId,
        title: SET_GOAL_ON_RENAME,
      });
      await collector.waitFor((event) => event.kind === "work.goal_set");
      expect(await connection.request("goal.status", { threadId: created.threadId })).toEqual({
        goal: {
          condition: GOAL_CONDITION,
          status: "active",
          judged: 0,
          maxJudgments: MAX_RUNS,
          lastVerdict: null,
        },
      });
      const missing = await wireErrorOf(
        connection.request("goal.status", { threadId: UNKNOWN_THREAD }),
      );
      expect(missing.code).toBe(wireError("thread.notFound").code);
      expect(missing.data.details).toEqual({ threadId: UNKNOWN_THREAD });
      await connection.close();
      await host.close();
      home.dispose();
    },
    30_000,
  );

  realTest(
    "work.tasks.list is empty for a new thread, then shows what a turn wrote with task_write, with each blocker resolved as the engine resolves it",
    async () => {
      const home = useEngineHome();
      writeUserSettings(home, TAPE_SETTINGS);
      const host = await startInProcessHost({
        devChecks: true,
        defaultGroups: false,
        buildModels: callingModels("dialog-area-tasks", [
          {
            name: "task_write",
            args: {
              ops: [
                { op: "create", ref: "@a", content: "write the code" },
                { op: "create", ref: "@b", content: "test it", blockedBy: ["@a"] },
                { op: "create", ref: "@c", content: "set up the fixture" },
                { op: "create", ref: "@d", content: "check the fixture", blockedBy: ["@c"] },
                { op: "update", id: "@c", status: "completed" },
                { op: "create", ref: "@f", content: "flaky step" },
                { op: "update", id: "@f", status: "in_progress" },
                { op: "update", id: "@f", status: "failed" },
                { op: "create", ref: "@r", content: "retry", blockedBy: ["@f"] },
              ],
            },
          },
        ]),
      });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      expect(await connection.request("work.tasks.list", { threadId: created.threadId })).toEqual({
        tasks: [],
      });
      await connection.request("turn.start", {
        threadId: created.threadId,
        input: "plan the work",
      });
      await collector.waitFor((event) => event.kind === "turn.completed");
      expect(await connection.request("work.tasks.list", { threadId: created.threadId })).toEqual({
        tasks: [
          // 막힌 작업: 선행이 끝나지 않았으므로 그 id가 막힘 사유다
          { taskId: "t1", content: "write the code", status: "pending", blockedBy: null },
          { taskId: "t2", content: "test it", status: "pending", blockedBy: "t1" },
          // 끝난 선행이 있는 작업은 막히지 않는다
          { taskId: "t3", content: "set up the fixture", status: "done", blockedBy: null },
          { taskId: "t4", content: "check the fixture", status: "pending", blockedBy: null },
          // 실패한 작업은 취소로 보이지만 선행으로서는 막힘을 유지한다(L2.work §4.1.3)
          { taskId: "t5", content: "flaky step", status: "cancelled", blockedBy: null },
          { taskId: "t6", content: "retry", status: "pending", blockedBy: "t5" },
        ],
      });
      await connection.close();
      await host.close();
      home.dispose();
    },
    30_000,
  );

  realTest(
    "schedule.update switches a schedule off and on, edits it, and answers an unknown id with invalid params; a one-time schedule whose time has passed stays off",
    async () => {
      const service = await startSchedulingService([FIRST_ANSWER]);
      try {
        const created = await service.client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
          title: "nightly",
        });
        if (!created.ok) throw new Error(`the interval was not created: ${created.error.kind}`);
        const scheduleId = created.entry.id;
        const nextAt = isoOf(service.time.clock.now() + INTERVAL_MS);

        expect(await service.client.request("schedule.runs", { scheduleId })).toEqual({ runs: [] });
        expect(
          await service.client.request("schedule.update", { scheduleId, enabled: false }),
        ).toEqual({ scheduleId, enabled: false, nextRunAt: null });
        expect(
          await service.client.request("schedule.update", { scheduleId, enabled: true }),
        ).toEqual({ scheduleId, enabled: true, nextRunAt: nextAt });
        expect(
          await service.client.request("schedule.update", {
            scheduleId,
            title: "weekly",
            prompt: EDITED_PROMPT,
          }),
        ).toEqual({ scheduleId, enabled: true, nextRunAt: nextAt });
        expect(await service.client.request("schedule.list", {})).toEqual({
          ok: true,
          items: [
            {
              entry: expect.objectContaining({
                id: scheduleId,
                enabled: true,
                title: "weekly",
                prompt: EDITED_PROMPT,
                nextDueAt: service.time.clock.now() + INTERVAL_MS,
              }),
              lastRun: null,
            },
          ],
        });

        const unknown = await wireErrorOf(
          service.client.request("schedule.update", {
            scheduleId: MISSING_SCHEDULE,
            enabled: false,
          }),
        );
        expect(unknown.code).toBe(-32602);
        expect(unknown.data.details).toEqual({
          issues: [{ path: "scheduleId", message: "unknown schedule" }],
        });

        // 지난 시각 항목은 다시 켜지 않는다. 꺼진 채 남고 응답은 오류가 아니다
        const onceAt = service.time.clock.now() + 10 * ONE_MINUTE_MS;
        const once = await service.client.request("schedule.create", {
          trigger: { kind: "at", atMs: onceAt },
          prompt: PROMPT,
          enabled: false,
        });
        if (!once.ok) throw new Error(`the timer was not created: ${once.error.kind}`);
        service.time.advance(11 * ONE_MINUTE_MS);
        expect(
          await service.client.request("schedule.update", {
            scheduleId: once.entry.id,
            enabled: true,
          }),
        ).toEqual({ scheduleId: once.entry.id, enabled: false, nextRunAt: null });
      } finally {
        await service.dispose();
      }
    },
    60_000,
  );

  realTest(
    "schedule.runs lists a schedule's runs newest first after two ticks fire it, and the limit keeps only the newest",
    async () => {
      const service = await startSchedulingService([FIRST_ANSWER, SECOND_ANSWER]);
      try {
        const created = await service.client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
        });
        if (!created.ok) throw new Error(`the interval was not created: ${created.error.kind}`);
        const scheduleId = created.entry.id;
        const schedule = service.handle.schedule();

        service.time.advance(INTERVAL_MS + 1_000);
        const firstAt = service.time.clock.now();
        await schedule.tick();
        await eventually(() => schedule.runs(scheduleId)[0]?.status === "finished", 15_000);

        service.time.advance(INTERVAL_MS + 1_000);
        const secondAt = service.time.clock.now();
        await schedule.tick();
        await eventually(
          () =>
            schedule.runs(scheduleId).length === 2 &&
            schedule.runs(scheduleId)[0]?.status === "finished",
          15_000,
        );

        const [newest, oldest] = schedule.runs(scheduleId);
        if (newest === undefined || oldest === undefined) {
          throw new Error("the two runs are not recorded");
        }
        expect(newest.threadId).not.toBeNull();
        expect(oldest.threadId).not.toBeNull();
        expect(await service.client.request("schedule.runs", { scheduleId })).toEqual({
          runs: [
            {
              runId: newest.runId,
              startedAt: isoOf(secondAt),
              endedAt: isoOf(secondAt),
              outcome: "ok",
              threadId: newest.threadId,
              error: null,
            },
            {
              runId: oldest.runId,
              startedAt: isoOf(firstAt),
              endedAt: isoOf(firstAt),
              outcome: "ok",
              threadId: oldest.threadId,
              error: null,
            },
          ],
        });
        expect(await service.client.request("schedule.runs", { scheduleId, limit: 1 })).toEqual({
          runs: [
            {
              runId: newest.runId,
              startedAt: isoOf(secondAt),
              endedAt: isoOf(secondAt),
              outcome: "ok",
              threadId: newest.threadId,
              error: null,
            },
          ],
        });
        // 한도는 1부터 200까지다. 밖의 값은 스키마가 -32602로 거부한다
        expect(
          (await wireErrorOf(service.client.request("schedule.runs", { scheduleId, limit: 0 })))
            .code,
        ).toBe(-32602);
        const unknown = await wireErrorOf(
          service.client.request("schedule.runs", { scheduleId: MISSING_SCHEDULE }),
        );
        expect(unknown.code).toBe(-32602);
        expect(unknown.data.details).toEqual({
          issues: [{ path: "scheduleId", message: "unknown schedule" }],
        });
      } finally {
        await service.dispose();
      }
    },
    60_000,
  );

  realTest(
    "a thread that a schedule run made shows its origin in thread.list, and a thread the user made shows none",
    async () => {
      const service = await startSchedulingService([FIRST_ANSWER]);
      try {
        const created = await service.client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
        });
        if (!created.ok) throw new Error(`the interval was not created: ${created.error.kind}`);
        const scheduleId = created.entry.id;
        const schedule = service.handle.schedule();
        service.time.advance(INTERVAL_MS + 1_000);
        await schedule.tick();
        await eventually(() => schedule.runs(scheduleId)[0]?.status === "finished", 15_000);
        const [run] = schedule.runs(scheduleId);
        if (run === undefined || run.threadId === null) {
          throw new Error("the schedule run did not start a thread");
        }

        const mine = await service.client.request("thread.create", { title: "mine" });
        const listed = await service.client.request("thread.list", {});
        const scheduled = listed.threads.find((thread) => thread.threadId === run.threadId);
        if (scheduled === undefined) throw new Error("the scheduled thread is not listed");
        expect(scheduled.origin).toEqual({ kind: "schedule", scheduleId });
        const own = listed.threads.find((thread) => thread.threadId === mine.threadId);
        if (own === undefined) throw new Error("the user's thread is not listed");
        expect(Object.hasOwn(own, "origin")).toBe(false);
      } finally {
        await service.dispose();
      }
    },
    60_000,
  );

  realTest(
    "enabling a schedule past the active limit is invalid params on enabled",
    async () => {
      const service = await startSchedulingService([FIRST_ANSWER], { maxActive: 1 });
      try {
        const active = await service.client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
        });
        if (!active.ok) throw new Error(`the first interval was not created: ${active.error.kind}`);
        const parked = await service.client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
          enabled: false,
        });
        if (!parked.ok)
          throw new Error(`the second interval was not created: ${parked.error.kind}`);
        const refused = await wireErrorOf(
          service.client.request("schedule.update", { scheduleId: parked.entry.id, enabled: true }),
        );
        expect(refused.code).toBe(-32602);
        expect(refused.data.details).toEqual({
          issues: [{ path: "enabled", message: "active schedule limit reached (max 1)" }],
        });
      } finally {
        await service.dispose();
      }
    },
    60_000,
  );
});

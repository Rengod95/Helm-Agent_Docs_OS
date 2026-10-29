import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import type { RunRecord, ScheduleTicker } from "@xeon/cap-schedule";
import { parse, repeatAsync } from "@xeon/contracts";
import { ThreadIdSchema } from "@xeon/contracts/conversation";
import type { WireResult } from "@xeon/contracts/wire";
import { createFileScheduleStore } from "../../src/assembly/schedule-store.ts";
import { startService, type ServiceStart } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  eventually,
  manualTime,
  scratchRuntimeDir,
} from "../fixtures/service-harness.ts";
import { answeringModels, sequencedModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";

// M3b B1-SCH2 끝 시험(X4): 서비스 소켓으로 붙은 클라이언트가 예약 메서드 네 개로 항목을 만들고, 보고, 끄고, 원격으로 실행한다.
// 기한이 된 타이머는 틱이 실행하고 실행 기록과 thread가 남는다. 저장 파일이 손상되면 만들기와 목록은 `store_failed`이고 파일은 그대로다.
// 실제 엔진, 실제 저장소 파일, 실제 Unix 소켓, 모델 테이프. 틱은 시험이 직접 돌리고 시간은 수동 시계다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const GRACE_MS = 60_000;
/** 타이머 기한. 유휴 유예의 여러 배 뒤다 */
const DUE_MS = 10 * 60_000;
const INTERVAL_MS = 300_000;
const PROMPT = "nightly summary: list the open items";
const ANSWER = "three items are open";
const REMOTE_ANSWER = "the remote run is done";
const MISSING_ID = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAX";

const home = useEngineHome();
writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
const workspace = mkdtempSync(join(tmpdir(), "xsvc-schw-ws-"));
const previousCwd = process.cwd();
// 엔진은 시작할 때의 작업 폴더를 도구의 읽기·쓰기 root로 잡는다(service-schedule과 같은 설정)
process.chdir(workspace);
afterAll(() => {
  process.chdir(previousCwd);
  home.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

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

/** 상태 파일에 실행 기록이 `finished`로 쓰일 때까지 기다린다. 파일 쓰기는 메모리 상태보다 늦게 끝난다 */
async function persistedFinishedRun(stateDir: string, runId: string): Promise<RunRecord> {
  const store = createFileScheduleStore(stateDir);
  const deadline = Date.now() + 15_000;
  return repeatAsync<RunRecord>(async () => {
    const loaded = await store.load();
    if (!loaded.ok) throw new Error(loaded.error.message);
    const found = loaded.value.runs.find((run) => run.runId === runId);
    if (found?.status === "finished") return { value: found };
    if (Date.now() > deadline) {
      throw new Error("the finished run did not reach the state file in time");
    }
    await Bun.sleep(10);
    return undefined;
  });
}

type ListedOk = Extract<WireResult<"schedule.list">, { readonly ok: true }>;

/** 와이어 목록에서 항목 하나의 마지막 실행 기록을 찾는다. 항목이 없으면 시험을 실패시킨다 */
function lastRunOf(
  listed: WireResult<"schedule.list">,
  scheduleId: string,
): ListedOk["items"][number]["lastRun"] {
  if (!listed.ok) throw new Error(`the list failed: ${listed.error.kind}`);
  const item = listed.items.find((candidate) => candidate.entry.id === scheduleId);
  if (item === undefined) throw new Error(`the list has no entry ${scheduleId}`);
  return item.lastRun;
}

describe("service schedule over the wire", () => {
  realTest(
    "a client creates, lists, cancels and fires schedules over the socket, and the due timer runs and records its run",
    async () => {
      const runtime = scratchRuntimeDir();
      const time = manualTime();
      const ticker = manualTicker();
      const started: ServiceStart = await startService({
        runtimeDir: runtime.dir,
        assemble: {
          devChecks: true,
          defaultGroups: false,
          buildModels: sequencedModels("svc-schedule-wire", [ANSWER, REMOTE_ANSWER]),
          schedule: { clock: time.clock, ticker },
        },
        time,
        handleSignals: false,
        startupGraceMs: 0,
        idleGraceMs: GRACE_MS,
      });
      if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
      const handle = started.handle;
      const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
      try {
        // (a) 간격 항목: 켜져 있고 다음 기한은 지금 + 5분이다. 서비스 모드라 경고가 없다
        const interval = await client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 300 },
          prompt: PROMPT,
        });
        if (!interval.ok) throw new Error(`the interval was not created: ${interval.error.kind}`);
        const intervalId = interval.entry.id;
        expect(interval).toMatchObject({
          ok: true,
          warnings: [],
          entry: {
            trigger: { kind: "interval", everySeconds: 300 },
            prompt: PROMPT,
            enabled: true,
            nextDueAt: time.clock.now() + INTERVAL_MS,
            sessionKind: "cron",
          },
        });

        // (b) 한 번의 시각 항목: 기한은 지금 + 10분이다
        const dueAtMs = time.clock.now() + DUE_MS;
        const once = await client.request("schedule.create", {
          trigger: { kind: "at", atMs: dueAtMs },
          prompt: PROMPT,
        });
        if (!once.ok) throw new Error(`the timer was not created: ${once.error.kind}`);
        const timerId = once.entry.id;
        expect(once).toMatchObject({
          ok: true,
          warnings: [],
          entry: { trigger: { kind: "at", atMs: dueAtMs }, nextDueAt: dueAtMs, enabled: true },
        });

        // (c) 기대한 실패는 오류 값이다: 간격이 짧고, 시각이 이미 지났다
        const tooShort = await client.request("schedule.create", {
          trigger: { kind: "interval", everySeconds: 60 },
          prompt: PROMPT,
        });
        expect(tooShort).toEqual({
          ok: false,
          error: { kind: "interval_too_short", minSeconds: 300 },
        });
        const past = await client.request("schedule.create", {
          trigger: { kind: "at", atMs: time.clock.now() - 1_000 },
          prompt: PROMPT,
        });
        expect(past).toEqual({ ok: false, error: { kind: "at_in_past" } });

        // (d) 목록은 두 항목을 만든 순서로 보이고, 실행 기록은 아직 없다
        const listed = await client.request("schedule.list", {});
        expect(listed).toEqual({
          ok: true,
          items: [
            {
              entry: expect.objectContaining({ id: intervalId, enabled: true }),
              lastRun: null,
            },
            {
              entry: expect.objectContaining({ id: timerId, enabled: true }),
              lastRun: null,
            },
          ],
        });
        if (!listed.ok) throw new Error("the list failed");
        expect(listed.items.map((item) => item.entry.trigger)).toEqual([
          { kind: "interval", everySeconds: 300 },
          { kind: "at", atMs: dueAtMs },
        ]);

        // (e) 간격 항목을 끈다. 멈춘 이유는 cancelled다. 켜진 항목만 보면 시각 항목 하나가 남는다
        const cancelled = await client.request("schedule.cancel", { scheduleId: intervalId });
        expect(cancelled).toMatchObject({
          ok: true,
          entry: { id: intervalId, enabled: false, stoppedReason: "cancelled", nextDueAt: null },
        });
        const enabledOnly = await client.request("schedule.list", { enabled: true });
        expect(enabledOnly).toMatchObject({ ok: true });
        if (!enabledOnly.ok) throw new Error("the list failed");
        expect(enabledOnly.items.map((item) => item.entry.id)).toEqual([timerId]);
        expect(await client.request("schedule.cancel", { scheduleId: MISSING_ID })).toEqual({
          ok: false,
          error: { kind: "not_found" },
        });

        // (f) 기한이 지나고 틱 한 번이 실행을 시작한다. 턴이 끝나면 실행 기록이 완료된다
        time.advance(DUE_MS + 1_000);
        await handle.schedule().tick();
        await eventually(() => handle.schedule().runs(timerId)[0]?.status === "finished", 15_000);
        const afterRun = await client.request("schedule.list", {});
        const lastRun = lastRunOf(afterRun, timerId);
        expect(lastRun).toMatchObject({
          scheduleId: timerId,
          firedBy: "at",
          status: "finished",
          outcome: "completed",
          missed: false,
          reason: null,
        });
        if (lastRun === null) throw new Error("the timer has no run record");
        const threadId = parse(ThreadIdSchema, lastRun.threadId);
        if (!threadId.ok) throw new Error("the run did not start a thread");
        expect(lastRunOf(afterRun, intervalId)).toBeNull();

        const read = await client.request("thread.read", { threadId: threadId.value });
        expect(read.threadId).toBe(threadId.value);
        expect(read.items.find((item) => item.kind === "user")).toMatchObject({
          kind: "user",
          message: { content: PROMPT },
        });
        expect(read.items.find((item) => item.kind === "assistant")).toMatchObject({
          kind: "assistant",
          message: { content: [{ type: "text", text: ANSWER }] },
        });

        const persisted = await persistedFinishedRun(
          join(home.root, "state", "schedule"),
          lastRun.runId,
        );
        expect(persisted).toEqual(lastRun);

        // (g) 원격 항목은 `schedule.fire`로만 돈다. 실행은 원격 기록으로 남는다
        const remote = await client.request("schedule.create", {
          trigger: { kind: "remote" },
          prompt: PROMPT,
        });
        if (!remote.ok)
          throw new Error(`the remote schedule was not created: ${remote.error.kind}`);
        const remoteId = remote.entry.id;
        const fired = await client.request("schedule.fire", { scheduleId: remoteId });
        expect(fired).toMatchObject({
          ok: true,
          run: { scheduleId: remoteId, firedBy: "remote" },
        });
        await eventually(() => handle.schedule().runs(remoteId)[0]?.status === "finished", 15_000);
        const remoteListed = await client.request("schedule.list", {});
        expect(lastRunOf(remoteListed, remoteId)).toMatchObject({
          firedBy: "remote",
          status: "finished",
          outcome: "completed",
        });
        expect(await client.request("schedule.fire", { scheduleId: timerId })).toEqual({
          ok: false,
          error: { kind: "not_remote" },
        });
      } finally {
        await client.close();
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "a corrupt state file makes create and list answer store_failed and is left byte-identical",
    async () => {
      // 손상된 파일이 있는 새 홈에서 서비스를 연다. 이 시험은 앞 시험의 홈과 따로 쓴다
      const fresh = useEngineHome();
      writeUserSettings(fresh, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
      const stateDir = join(fresh.root, "state", "schedule");
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      const statePath = join(stateDir, "state.json");
      const garbage = Buffer.from('{"version":1,"entries":[truncated', "utf8");
      writeFileSync(statePath, garbage);

      const runtime = scratchRuntimeDir();
      const time = manualTime();
      try {
        const started = await startService({
          runtimeDir: runtime.dir,
          assemble: {
            devChecks: true,
            defaultGroups: false,
            buildModels: answeringModels("svc-schedule-corrupt", ANSWER),
            schedule: { clock: time.clock, ticker: manualTicker() },
          },
          time,
          handleSignals: false,
          startupGraceMs: 0,
          idleGraceMs: GRACE_MS,
        });
        if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
        const handle = started.handle;
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        try {
          const created = await client.request("schedule.create", {
            trigger: { kind: "interval", everySeconds: 300 },
            prompt: PROMPT,
          });
          expect(created).toEqual({
            ok: false,
            error: { kind: "store_failed", message: expect.any(String) },
          });
          const listed = await client.request("schedule.list", {});
          expect(listed).toEqual({
            ok: false,
            error: { kind: "store_failed", message: expect.any(String) },
          });
          expect(readFileSync(statePath)).toEqual(garbage);
        } finally {
          await client.close();
          await handle.shutdown("stop");
        }
      } finally {
        runtime.dispose();
        fresh.dispose();
      }
    },
    60_000,
  );
});

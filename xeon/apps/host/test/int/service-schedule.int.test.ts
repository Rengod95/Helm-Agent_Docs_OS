import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import type { RunRecord, ScheduleTicker } from "@xeon/cap-schedule";
import { parse, repeatAsync } from "@xeon/contracts";
import { ThreadIdSchema } from "@xeon/contracts/conversation";
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
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";

// X4 뒤 절반(M3b B1-SCH): 서비스 모드에서 클라이언트를 모두 끊은 뒤에도 타이머 예약이 실행을 시작하고 기록을 남긴다.
// 대기 예약이 있는 동안 서비스는 유휴 종료하지 않고, 실행이 끝나 대기 예약이 0이 되면 유예 뒤 종료한다.
// 실제 엔진, 실제 저장소 파일, 실제 Unix 소켓, 모델 테이프. 틱은 시험이 직접 돌리고 시간은 수동 시계다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const GRACE_MS = 60_000;
/** 타이머 기한. 유휴 유예의 여러 배 뒤다 */
const DUE_MS = 10 * 60_000;
const PROMPT = "nightly summary: list the open items";
const ANSWER = "three items are open";

const home = useEngineHome();
writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
const workspace = mkdtempSync(join(tmpdir(), "xsvc-sch-ws-"));
const previousCwd = process.cwd();
// 엔진은 시작할 때의 작업 폴더를 도구의 읽기·쓰기 root로 잡는다(service-idle과 같은 설정)
process.chdir(workspace);
afterAll(() => {
  process.chdir(previousCwd);
  home.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

/** 틱을 시험이 돌린다. `every`가 건 콜백을 잡아 두고, 틱 한 번은 `handle.schedule().tick()`으로 부른다 */
function manualTicker(): ScheduleTicker & { readonly armed: () => boolean } {
  const state: { tick: (() => void) | undefined } = { tick: undefined };
  return {
    every(_periodMs: number, tick: () => void) {
      state.tick = tick;
      return () => {
        state.tick = undefined;
      };
    },
    armed: () => state.tick !== undefined,
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

describe("service schedule", () => {
  realTest(
    "after every client disconnects, a timer still runs and records its run; the service stays up while the timer is pending and idles out after the run",
    async () => {
      const runtime = scratchRuntimeDir();
      const time = manualTime();
      const ticker = manualTicker();
      const started: ServiceStart = await startService({
        runtimeDir: runtime.dir,
        assemble: {
          devChecks: true,
          defaultGroups: false,
          buildModels: answeringModels("svc-schedule", ANSWER),
          schedule: { clock: time.clock, ticker },
        },
        time,
        handleSignals: false,
        startupGraceMs: 0,
        idleGraceMs: GRACE_MS,
      });
      if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
      const handle = started.handle;
      try {
        // 서비스 시작이 예약 서비스를 돌렸다: 틱이 걸렸다
        expect(ticker.armed()).toBe(true);

        // 1. 연결 하나가 `at` 타이머를 만들고 떠난다
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        const created = await handle.schedule().create({
          trigger: { kind: "at", atMs: time.clock.now() + DUE_MS },
          prompt: PROMPT,
        });
        if (!created.ok) throw new Error(`the timer was not created: ${created.error.kind}`);
        const timerId = created.value.id;
        await client.close();
        await eventually(() => handle.connections() === 0);

        // 2. 연결 0, 대기 예약 1: 유예를 여러 번 지나도 유휴 종료를 잡지 않고 서비스가 응답한다
        expect(handle.schedule().pendingSchedules()).toBe(1);
        expect(handle.idleShutdownAt()).toBeNull();
        time.advance(GRACE_MS * 3);
        expect(handle.idleShutdownAt()).toBeNull();
        expect(existsSync(handle.registration.socket)).toBe(true);
        const probe = await connectedClient({ kind: "unix", path: handle.registration.socket });
        expect(await probe.request("host.status", {})).toMatchObject({
          mode: "service",
          connections: 1,
          idleShutdownAt: null,
        });
        await probe.close();
        await eventually(() => handle.connections() === 0);

        // 3. 기한이 지난 뒤 틱 한 번이 실행을 시작하고, 턴이 끝나면 실행 기록이 완료된다
        time.advance(DUE_MS - GRACE_MS * 3 + 1_000);
        await handle.schedule().tick();
        await eventually(() => handle.schedule().runs(timerId)[0]?.status === "finished", 15_000);
        const run = handle.schedule().runs(timerId)[0];
        if (run === undefined) throw new Error("the timer has no run record");
        expect(run).toMatchObject({
          scheduleId: timerId,
          firedBy: "at",
          status: "finished",
          outcome: "completed",
          missed: false,
          reason: null,
        });
        const threadId = parse(ThreadIdSchema, run.threadId);
        if (!threadId.ok) throw new Error("the run did not start a thread");
        const persisted = await persistedFinishedRun(
          join(home.root, "state", "schedule"),
          run.runId,
        );
        expect(existsSync(join(home.root, "state", "schedule", "state.json"))).toBe(true);
        expect(persisted).toEqual(run);

        // 4. 새 연결이 thread를 읽으면 사용자 입력과 답이 보인다
        const reader = await connectedClient({ kind: "unix", path: handle.registration.socket });
        const read = await reader.request("thread.read", { threadId: threadId.value });
        expect(read.threadId).toBe(threadId.value);
        expect(read.items.find((item) => item.kind === "user")).toMatchObject({
          kind: "user",
          message: { content: PROMPT },
        });
        expect(read.items.find((item) => item.kind === "assistant")).toMatchObject({
          kind: "assistant",
          message: { content: [{ type: "text", text: ANSWER }] },
        });
        await reader.close();
        await eventually(() => handle.connections() === 0);

        // 5. 실행이 끝나 타이머는 완료로 꺼지고 대기 예약은 0이다. 연결이 없으니 유예 뒤 종료한다
        expect(
          handle
            .schedule()
            .list()
            .find((entry) => entry.id === timerId),
        ).toMatchObject({
          enabled: false,
          stoppedReason: "completed",
          nextDueAt: null,
        });
        expect(handle.schedule().pendingSchedules()).toBe(0);
        await eventually(() => handle.idleShutdownAt() !== null);
        time.advance(GRACE_MS);
        expect(await handle.exited).toEqual({ code: 0, reason: "idle" });
        expect(existsSync(join(runtime.dir, "xeon.sock"))).toBe(false);
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );
});

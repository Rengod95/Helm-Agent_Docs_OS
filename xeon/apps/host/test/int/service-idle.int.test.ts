import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { startService, type ServiceHandle, type ServiceStart } from "../../src/index.ts";
import { approvalModels } from "../fixtures/approval-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  eventually,
  manualTime,
  scratchRuntimeDir,
} from "../fixtures/service-harness.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents } from "../fixtures/wire-client.ts";

// X4 앞 절반(M3b B1-SVC): 서비스 모드의 유휴 종료. 연결 0 + live 0 + 대기 예약 0이 유예 동안 이어질 때만 종료하고,
// 승인 대기 세션(연결 없음)이 있으면 종료하지 않는다. 실제 엔진, 실제 저장소, 실제 Unix 소켓, 모델 테이프, 수동 시간.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const GRACE_MS = 60_000;

const home = useEngineHome();
writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
const workspace = mkdtempSync(join(tmpdir(), "xsvc-ws-"));
const previousCwd = process.cwd();
// 엔진은 시작할 때의 작업 폴더를 도구의 읽기·쓰기 root로 잡는다(cap-workspace)
process.chdir(workspace);
afterAll(() => {
  process.chdir(previousCwd);
  home.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

/** 서비스에 붙어 있는 연결 수. 시험이 직접 세지 않고 서비스의 유휴 판정 입력이 바뀌기를 기다린다 */
function connectionsOf(handle: ServiceHandle): number {
  return handle.connections();
}

function startedHandle(started: ServiceStart): ServiceHandle {
  if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
  return started.handle;
}

describe("service idle shutdown", () => {
  realTest(
    "an approval-pending session keeps the service up with 0 connections; it shuts down only after the grace once nothing is live",
    async () => {
      const runtime = scratchRuntimeDir();
      const time = manualTime();
      const pendingSchedules = { value: 0 };
      const scheduleListeners = new Set<() => void>();
      const handle = startedHandle(
        await startService({
          runtimeDir: runtime.dir,
          assemble: {
            devChecks: true,
            defaultGroups: false,
            buildModels: approvalModels("svc-idle"),
            pendingSchedules: {
              count: () => pendingSchedules.value,
              onChange: (listener) => {
                scheduleListeners.add(listener);
                return () => {
                  scheduleListeners.delete(listener);
                };
              },
            },
          },
          time,
          handleSignals: false,
          startupGraceMs: 0,
          idleGraceMs: GRACE_MS,
        }),
      );
      try {
        // 1. 연결 하나가 승인 대기 turn을 만들고 떠난다
        const first = await connectedClient({ kind: "unix", path: handle.registration.socket });
        const collector = collectEvents(first);
        await first.request("events.subscribe", { from: "head" });
        const created = await first.request("thread.create", { workspace });
        await first.request("turn.start", { threadId: created.threadId, input: "run it" });
        const asked = await collector.waitFor((event) => event.kind === "approval.requested");
        await first.close();
        await eventually(() => connectionsOf(handle) === 0);

        // 연결 0, 승인 대기 1: 유예를 여러 번 지나도 종료하지 않는다
        expect(handle.idleShutdownAt()).toBeNull();
        time.advance(GRACE_MS * 3);
        const stillUp = await Promise.race([
          handle.exited.then(() => "exited" as const),
          Promise.resolve("running" as const),
        ]);
        expect(stillUp).toBe("running");
        expect(existsSync(handle.registration.socket)).toBe(true);

        // 2. 다시 접속해 승인하고 turn이 끝나면 한가해진다
        const second = await connectedClient({ kind: "unix", path: handle.registration.socket });
        const collector2 = collectEvents(second);
        await second.request("events.subscribe", { from: "head" });
        await second.request("thread.open", { threadId: created.threadId, mode: "write" });
        const status = await second.request("host.status", {});
        expect(status).toMatchObject({ mode: "service", connections: 1 });
        expect(status.idleShutdownAt).toBeNull();
        await second.request("approval.respond", { approvalId: asked.id, decision: "allow" });
        await collector2.waitFor((event) => event.kind === "turn.completed");
        await second.close();
        await eventually(() => handle.idleShutdownAt() !== null);

        // 3. 연결 0, live 0, 대기 예약 0: 유예가 끝나기 전에는 종료하지 않고 끝나면 종료한다
        const planned = handle.idleShutdownAt();
        expect(planned).not.toBeNull();
        time.advance(GRACE_MS - 1);
        expect(handle.idleShutdownAt()).toBe(planned);
        expect(existsSync(handle.registration.socket)).toBe(true);
        time.advance(1);
        const exit = await handle.exited;
        expect(exit).toEqual({ code: 0, reason: "idle" });
        expect(existsSync(runtime.dir + "/service.json")).toBe(false);
        expect(existsSync(runtime.dir + "/xeon.sock")).toBe(false);
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "a pending schedule keeps an otherwise idle service up and a connection resets the timer",
    async () => {
      const runtime = scratchRuntimeDir();
      const time = manualTime();
      const pending = { value: 1 };
      const listeners = new Set<() => void>();
      const handle = startedHandle(
        await startService({
          runtimeDir: runtime.dir,
          assemble: {
            devChecks: true,
            defaultGroups: false,
            pendingSchedules: {
              count: () => pending.value,
              onChange: (listener) => {
                listeners.add(listener);
                return () => {
                  listeners.delete(listener);
                };
              },
            },
          },
          time,
          handleSignals: false,
          startupGraceMs: 0,
          idleGraceMs: GRACE_MS,
        }),
      );
      try {
        // 대기 예약 1: 연결이 없어도 종료하지 않는다
        expect(handle.idleShutdownAt()).toBeNull();
        time.advance(GRACE_MS * 2);
        expect(existsSync(runtime.dir + "/xeon.sock")).toBe(true);

        // 예약이 사라지면 유예가 시작되고, 유예 안의 새 연결이 타이머를 취소한다
        pending.value = 0;
        for (const listener of listeners) listener();
        expect(handle.idleShutdownAt()).not.toBeNull();
        time.advance(GRACE_MS - 1000);
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        expect(handle.idleShutdownAt()).toBeNull();
        time.advance(GRACE_MS * 2);
        expect(existsSync(runtime.dir + "/xeon.sock")).toBe(true);
        await client.close();
        await eventually(() => handle.idleShutdownAt() !== null);
        time.advance(GRACE_MS);
        expect(await handle.exited).toEqual({ code: 0, reason: "idle" });
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "host.status reports the planned idle shutdown time as an ISO time and null while something is live",
    async () => {
      const runtime = scratchRuntimeDir();
      const time = manualTime();
      const handle = startedHandle(
        await startService({
          runtimeDir: runtime.dir,
          assemble: { devChecks: true, defaultGroups: false },
          time,
          handleSignals: false,
          startupGraceMs: 0,
          idleGraceMs: GRACE_MS,
        }),
      );
      try {
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        expect((await client.request("host.status", {})).idleShutdownAt).toBeNull();
        await client.close();
        await eventually(() => handle.idleShutdownAt() !== null);
        expect(handle.idleShutdownAt()).toBe(time.clock.now() + GRACE_MS);
        // 연결이 있는 동안에는 status가 null을 보이고, 계획 시각은 ISO 시각으로 나간다
        const again = await connectedClient({ kind: "unix", path: handle.registration.socket });
        expect((await again.request("host.status", {})).idleShutdownAt).toBeNull();
        await again.close();
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );
});

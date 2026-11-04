import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M4 wire 조립(`m4/wire`): 실제 엔진에서 계측 읽기(`trace.turn`, 설정 `x.operations.trace.*`)와 Test run 제어(`testRun.*`)가 ext-host 구현에 닿는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

realTest(
  "trace.turn returns the handler entries the real ext-host buffer kept for a finished turn",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("m4-trace", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      const started = await connection.request("turn.start", {
        threadId: created.threadId,
        input: "질문",
      });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const traced = await connection.request("trace.turn", {
        threadId: created.threadId,
        turnId: started.turnId,
      });
      expect(traced.traceEnabled).toBe(true);
      expect(traced.retained).toBe(true);
      expect(traced.entries.length).toBeGreaterThan(0);
      expect(traced.entries.map((entry) => entry.hook)).toContain("boundary.step.after");
      // 모르는 turn은 버퍼 밖이다
      const other = await connection.request("trace.turn", {
        threadId: created.threadId,
        turnId: "trn_00000000000000000000000000",
      });
      expect(other).toEqual({ traceEnabled: true, retained: false, entries: [] });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "x.operations.trace.enabled false in the user settings reaches the buffer: trace.turn says traceEnabled false",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "x.operations.trace.enabled": false });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("m4-trace-off", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      const started = await connection.request("turn.start", {
        threadId: created.threadId,
        input: "질문",
      });
      await collector.waitFor((event) => event.kind === "turn.completed");
      expect(
        await connection.request("trace.turn", {
          threadId: created.threadId,
          turnId: started.turnId,
        }),
      ).toEqual({ traceEnabled: false, retained: false, entries: [] });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "a Test run thread pauses at the step boundary, steps one boundary, and resumes; an ordinary thread is not a test run",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("m4-test-run", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const plain = await connection.request("thread.create", {});
      expect(
        await failureOf(connection.request("testRun.pause", { threadId: plain.threadId })),
      ).toMatchObject({ data: { kind: "testRun.notATestRun" } });

      const created = await connection.request("thread.create", { testRun: true });
      expect(await connection.request("testRun.phase", { threadId: created.threadId })).toEqual({
        phase: null,
        group: null,
        seq: null,
        paused: false,
        lock: { holder: null, status: "none", epoch: null },
        guardHits: 0,
        traceEnabled: true,
        boundaries: [],
      });
      // 멈춘 적 없는 Test run에 resume은 notPaused
      expect(
        await failureOf(connection.request("testRun.resume", { threadId: created.threadId })),
      ).toMatchObject({ data: { kind: "testRun.notPaused" } });
      expect(await connection.request("testRun.pause", { threadId: created.threadId })).toEqual({
        paused: true,
      });
      await connection.request("turn.start", { threadId: created.threadId, input: "질문" });
      await collector.waitFor((event) => event.kind === "turn.started");
      // 멈춘 동안 첫 단계 경계에서 turn이 끝나지 않는다
      await sleep(400);
      expect(collector.events.some((event) => event.kind === "turn.completed")).toBe(false);

      // step은 경계 하나를 지나가게 한다: turn이 끝나고 멈춤 요청은 남는다
      expect(await connection.request("testRun.step", { threadId: created.threadId })).toEqual({
        paused: true,
      });
      await collector.waitFor((event) => event.kind === "turn.completed");
      expect(await connection.request("testRun.resume", { threadId: created.threadId })).toEqual({
        paused: false,
      });
      expect(
        await failureOf(connection.request("testRun.step", { threadId: created.threadId })),
      ).toMatchObject({ data: { kind: "testRun.notPaused" } });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

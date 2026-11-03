import { afterEach, describe, expect, test } from "bun:test";
import type { ScheduleTicker } from "@fresnel/cap-schedule";
import { assemble } from "../../src/assemble.ts";
import type { Engine } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { eventually, manualTime } from "../fixtures/service-harness.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";

// l2/F-03, prod/P-AUTOSTART, apps/H1-01 (int): 서비스 모드가 꺼져 있어도 데스크톱 앱 엔진(stdio)이 떠 있는 동안 기한이 된 예약이 실행된다.
// 틱을 쥐는 프로세스는 `scheduler` 임대로 하나뿐이고, 쥔 쪽이 닫히면 다른 쪽이 이어받는다. 놓친 실행은 한 번만 따라잡고 최소 간격은 300초다.
// 실제 엔진과 실제 저장소 파일, 모델 테이프. 틱과 시간은 시험이 돌린다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const HOUR = 3_600_000;
const EVERY_SECONDS = 600;

/** 시험마다 새 엔진 홈을 쓴다: 앞선 시험의 항목이 남아 테이프의 답을 먼저 쓰지 않게 한다 */
const homes: ReturnType<typeof useEngineHome>[] = [];
function freshHome(): void {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
  homes.push(home);
}
afterEach(() => {
  for (const home of homes.splice(0).toReversed()) home.dispose();
});

interface ManualTicker extends ScheduleTicker {
  readonly armed: () => boolean;
}

/** 틱을 시험이 돌린다. 건 콜백은 `service.tick()`을 직접 부르므로 잡아 두기만 한다 */
function manualTicker(): ManualTicker {
  const state: { tick: (() => void) | undefined } = { tick: undefined };
  return {
    every(_period, tick) {
      state.tick = tick;
      return () => {
        state.tick = undefined;
      };
    },
    armed: () => state.tick !== undefined,
  };
}

async function engineOf(mode: "stdio" | "in-process", time: ReturnType<typeof manualTime>) {
  const ticker = manualTicker();
  const engine = await assemble({
    mode,
    devChecks: true,
    defaultGroups: false,
    buildModels: answeringModels(`app-schedule-${mode}`, "done"),
    schedule: { clock: time.clock, ticker },
  });
  return { engine, ticker };
}

async function created(engine: Engine, prompt: string) {
  const result = await engine.ports.schedule.create({
    trigger: { kind: "interval", everySeconds: EVERY_SECONDS },
    prompt,
  });
  if (!result.ok) throw new Error(`create failed: ${result.error.kind}`);
  return result.value;
}

describe("app-mode schedule ticks", () => {
  realTest(
    "an app engine without service mode runs a due entry, while an in-process engine neither ticks nor claims the entry will run",
    async () => {
      freshHome();
      const time = manualTime();
      const cli = await engineOf("in-process", time);
      try {
        expect(cli.ticker.armed()).toBe(false);
        // 돌리는 leader가 없으니 만든 예약은 실행되지 않는다: 경고가 참이다
        expect(cli.engine.scheduleRuns()).toBe(false);
      } finally {
        await cli.engine.close();
      }

      const app = await engineOf("stdio", time);
      try {
        expect(app.ticker.armed()).toBe(true);
        expect(app.engine.scheduleRuns()).toBe(true);
        const entry = await created(app.engine, "app tick");
        time.advance(EVERY_SECONDS * 1000 + 1_000);
        await app.engine.ports.schedule.tick();
        await eventually(
          () => app.engine.ports.schedule.runs(entry.id)[0]?.status === "finished",
          15_000,
        );
        expect(app.engine.ports.schedule.runs(entry.id)).toHaveLength(1);
        expect(app.engine.ports.schedule.runs(entry.id)[0]).toMatchObject({
          firedBy: "interval",
          missed: false,
          outcome: "completed",
        });
      } finally {
        await app.engine.close();
      }
    },
    60_000,
  );

  realTest(
    "after a long close the app catches the entry up once, records the rest as skipped, and refuses an interval under 300 seconds",
    async () => {
      freshHome();
      const time = manualTime();
      const app = await engineOf("stdio", time);
      try {
        const schedule = app.engine.ports.schedule;
        const tooShort = await schedule.create({
          trigger: { kind: "interval", everySeconds: 299 },
          prompt: "too short",
        });
        expect(tooShort).toEqual({
          ok: false,
          error: { kind: "interval_too_short", minSeconds: 300 },
        });

        const entry = await created(app.engine, "catch up");
        // 앱을 닫은 5시간 동안 기한이 30번 지났다
        time.advance(5 * HOUR + 300_000);
        await schedule.tick();
        await eventually(
          () => schedule.runs(entry.id).some((run) => run.status === "finished"),
          15_000,
        );
        const records = schedule.runs(entry.id);
        const fired = records.filter((run) => run.status === "finished");
        const skipped = records.filter((run) => run.status === "skipped");
        expect(fired).toHaveLength(1);
        expect(fired[0]).toMatchObject({ missed: true });
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toMatchObject({ reason: "missed", skippedCount: 29 });
      } finally {
        await app.engine.close();
      }
    },
    60_000,
  );

  realTest(
    "two app engines on one state directory: only the leader fires, and the other takes over once the leader closes",
    async () => {
      freshHome();
      const time = manualTime();
      const first = await engineOf("stdio", time);
      const second = await engineOf("stdio", time);
      try {
        // 먼저 선 쪽이 임대를 쥔다. 다른 쪽도 틱은 걸려 있지만 쥐지 못해 실행하지 않는다
        const entry = await created(first.engine, "who fires");
        time.advance(EVERY_SECONDS * 1000 + 1_000);
        await first.engine.ports.schedule.tick();
        await second.engine.ports.schedule.tick();
        await eventually(
          () => first.engine.ports.schedule.runs(entry.id)[0]?.status === "finished",
          15_000,
        );
        expect(first.engine.ports.schedule.runs(entry.id)).toHaveLength(1);
        expect(second.engine.ports.schedule.runs(entry.id)).toHaveLength(0);

        // leader가 닫히면 임대를 반납한다: 다음 기한에 다른 쪽이 실행한다
        await first.engine.close();
        time.advance(EVERY_SECONDS * 1000 + 1_000);
        await second.engine.ports.schedule.tick();
        // 이어받은 첫 기록도 finished라, 두 번째 실행까지 끝나기를 기다리려면 개수를 봐야 한다
        const finished = () =>
          second.engine.ports.schedule.runs(entry.id).filter((run) => run.status === "finished");
        await eventually(() => finished().length >= 2, 15_000);
        // 첫 실행(leader였던 쪽)의 기록은 파일에서 이어받았다
        expect(finished()).toHaveLength(2);
      } finally {
        await second.engine.close();
      }
    },
    90_000,
  );
});

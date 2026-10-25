import { afterEach, describe, expect, test } from "bun:test";
import { type EngineProcess, processesWithHome, startEngine } from "./harness.ts";
import { CLI_MAIN, runScenario, sidecarPath } from "./scenario.ts";

// G4-03 (E2, E3): 컴파일한 사이드카 바이너리를 stdio로 몰아 소스 진입과 같은 응답·이벤트열이 나오는지, 정상 종료 뒤 프로세스가 남지 않는지 본다.
// 사이드카가 없으면(빌드하지 않았으면) 바이너리 시험은 건너뛴다: `just desktop-sidecar host` 뒤에 돈다. 소스 진입 시험은 항상 돈다.
// "needs the binary" 시험의 건너뜀은 종료 조건 증거가 되지 못한다(review.fake-only). 종료 조건 판정 때는 건너뜀 0을 확인한다.

const SOURCE = [process.execPath, CLI_MAIN, "host", "--stdio"] as const;
const binary = sidecarPath();
const withBinary = binary === null ? test.skip : test;
const engines: EngineProcess[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.dispose()));
});

async function start(command: readonly string[]): Promise<EngineProcess> {
  const engine = await startEngine(command);
  engines.push(engine);
  return engine;
}

describe("source entry (harness regression)", () => {
  test("the scenario runs, stdout carries only JSON-RPC and stdin EOF after host.shutdown exits 0", async () => {
    const engine = await start(SOURCE);
    const run = await runScenario(engine);
    expect(run.strayStdout).toEqual([]);
    // 기본 켜짐 scope가 하나 이상 있고 한 묶음으로 커밋된다
    expect(run.scopeCount).toBeGreaterThan(0);
    const kinds = run.events.map((event): unknown =>
      typeof event === "object" && event !== null ? Reflect.get(event, "kind") : undefined,
    );
    expect(kinds[0]).toBe("thread.started");
    expect(kinds.filter((k) => k === "scope.changed")).toHaveLength(run.scopeCount);
    const exit = await engine.shutdown({ message: true });
    expect(exit.code, engine.stderr()).toBe(0);
  }, 60_000);

  test("two runs of the source entry give identical normalized responses and events", async () => {
    const first = await start(SOURCE);
    const a = await runScenario(first);
    await first.shutdown({ message: true });
    const second = await start(SOURCE);
    const b = await runScenario(second);
    await second.shutdown({ message: true });
    // 정규화가 홈마다 다른 값(저장소 id, 시각)을 지운다는 근거: 같은 엔진을 두 번 돌려도 같다
    expect(b.responses).toEqual(a.responses);
    expect(b.events).toEqual(a.events);
  }, 90_000);
});

describe("compiled sidecar binary", () => {
  withBinary(
    "gives the same normalized responses and events as the source entry (E2)",
    async () => {
      if (binary === null) return;
      const source = await start(SOURCE);
      const fromSource = await runScenario(source);
      await source.shutdown({ message: true });
      const compiled = await start([binary, "host", "--stdio"]);
      const fromBinary = await runScenario(compiled);
      expect(fromBinary.strayStdout).toEqual([]);
      expect(fromBinary.scopeCount).toBe(fromSource.scopeCount);
      expect(fromBinary.responses).toEqual(fromSource.responses);
      expect(fromBinary.events).toEqual(fromSource.events);
      const exit = await compiled.shutdown({ message: true });
      expect(exit.code, compiled.stderr()).toBe(0);
    },
    120_000,
  );

  withBinary(
    "exits 0 on stdin EOF alone and leaves no process holding its home (E3)",
    async () => {
      if (binary === null) return;
      const compiled = await start([binary, "host", "--stdio"]);
      await runScenario(compiled);
      // host.shutdown 없이 EOF만: 셸이 비정상으로 사라졌을 때의 방어(E5)와 같은 경로다
      const exit = await compiled.shutdown({ message: false });
      expect(exit.code, compiled.stderr()).toBe(0);
      const left = processesWithHome(compiled.home);
      if (left !== null) expect(left).toEqual([]);
    },
    120_000,
  );

  withBinary(
    "answers host.shutdown, then exits 0 within the grace period (E3)",
    async () => {
      if (binary === null) return;
      const compiled = await start([binary, "host", "--stdio"]);
      await runScenario(compiled);
      const exit = await compiled.shutdown({ message: true });
      expect(exit.code, compiled.stderr()).toBe(0);
      // l0.process.shutdown.timeoutMs 기본 3000 ms 안이다
      expect(exit.ms).toBeLessThan(3000);
      const left = processesWithHome(compiled.home);
      if (left !== null) expect(left).toEqual([]);
    },
    120_000,
  );
});

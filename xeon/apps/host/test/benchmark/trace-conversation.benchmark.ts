// B18 (T-MEAS2). 핸들러 계측(X-15 트레이스) 전체 기록이 실제 대화 속도를 느리게 하는지 잰다. 실제 모델 호출은 없다(모델 테이프).
// 실제 엔진(in-process 호스트, 기본 그룹 포함)에서 한 대화에 같은 입력을 여러 turn 보내고, turn 하나의 시작부터 `turn.completed`까지 걸린 시간을 모은다.
// 조건은 계측 끔, 켬(thread마다 8턴), 켬(20턴, 기본값), 켬(200턴, 설정 상한)이다. 조건을 번갈아 가며 라운드를 되풀이해 시간에 따른 흐름이 한 조건에 몰리지 않게 한다.
// 실행(xeon/에서): bash scripts/guard.sh run -- bun apps/host/test/benchmark/trace-conversation.benchmark.ts [--turns <n>] [--rounds <n>]
// 출력: stdout에 JSON 한 줄씩(metric, unit, value, note). 판정은 하지 않는다. 버퍼 크기(8 또는 20)는 사용자 결정 대기(B18)라 값을 바꾸지 않는다.
// 한계: 모델 응답이 즉시라 모델 시간이 0에 가깝다. 계측 비용이 turn 시간에서 차지하는 비중의 상한에 가깝고, 실제 대화에서는 모델 시간만큼 비중이 작아진다.
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

interface Condition {
  readonly name: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

const CONDITIONS: readonly Condition[] = [
  { name: "trace_off", settings: { "x.operations.trace.enabled": false } },
  {
    name: "trace_on_8",
    settings: { "x.operations.trace.enabled": true, "x.operations.trace.turnsPerThread": 8 },
  },
  {
    name: "trace_on_20",
    settings: { "x.operations.trace.enabled": true, "x.operations.trace.turnsPerThread": 20 },
  },
  {
    name: "trace_on_200",
    settings: { "x.operations.trace.enabled": true, "x.operations.trace.turnsPerThread": 200 },
  },
];

function flag(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const raw = at < 0 ? undefined : process.argv[at + 1];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const TURNS = flag("--turns", 30);
const ROUNDS = flag("--rounds", 3);
const WARMUP = 3;

function emit(metric: string, unit: "ms" | "count" | "mb", value: number, note: string): void {
  process.stdout.write(
    `${JSON.stringify({ metric, unit, value: Math.round(value * 1000) / 1000, note })}\n`,
  );
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
}

/** 한 조건으로 호스트를 세워 한 대화에 `WARMUP + TURNS`개 turn을 보내고, 워밍업을 뺀 turn 시간(ms)과 힙 증가(MB)를 돌려준다 */
async function runOnce(condition: Condition): Promise<{ turnMs: number[]; heapMb: number }> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...condition.settings });
  const models = recordingModels(
    `trace-${condition.name}`,
    Array.from({ length: WARMUP + TURNS }, (_, index) => `answer ${String(index + 1)}`),
    { contextWindow: 200_000 },
  );
  const host = await startInProcessHost({
    devChecks: false,
    defaultGroups: true,
    buildModels: models.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const turnMs: number[] = [];
  try {
    const created = await connection.request("thread.create", {});
    let heapBefore = 0;
    for (let index = 0; index < WARMUP + TURNS; index += 1) {
      if (index === WARMUP) {
        Bun.gc(true);
        heapBefore = process.memoryUsage().heapUsed;
      }
      const began = performance.now();
      // oxlint-disable-next-line no-await-in-loop -- turn은 하나씩 순서대로 잰다 (eng.testing.guide TS-05)
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: `turn ${String(index + 1)}: summarize the build notes in one line`,
      });
      // oxlint-disable-next-line no-await-in-loop -- turn은 하나씩 순서대로 잰다 (eng.testing.guide TS-05)
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        30_000,
      );
      if (index >= WARMUP) turnMs.push(performance.now() - began);
    }
    Bun.gc(true);
    return { turnMs, heapMb: (process.memoryUsage().heapUsed - heapBefore) / 1_048_576 };
  } finally {
    await host.close();
    home.dispose();
  }
}

const all = new Map<string, { turnMs: number[]; heapMb: number[] }>();
for (const condition of CONDITIONS) all.set(condition.name, { turnMs: [], heapMb: [] });

for (let round = 0; round < ROUNDS; round += 1) {
  for (const condition of CONDITIONS) {
    // oxlint-disable-next-line no-await-in-loop -- turn은 하나씩 순서대로 잰다 (eng.testing.guide TS-05)
    const result = await runOnce(condition);
    const bucket = all.get(condition.name);
    if (bucket === undefined) throw new Error("benchmark: missing bucket");
    bucket.turnMs.push(...result.turnMs);
    bucket.heapMb.push(result.heapMb);
  }
}

const baseline = [...(all.get("trace_off")?.turnMs ?? [])].toSorted((a, b) => a - b);
const baseMedian = percentile(baseline, 0.5);
for (const condition of CONDITIONS) {
  const bucket = all.get(condition.name);
  if (bucket === undefined) continue;
  const sorted = [...bucket.turnMs].toSorted((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const note = `${String(TURNS)} turns x ${String(ROUNDS)} rounds, tape model, default groups`;
  emit(`turn_ms_p50_${condition.name}`, "ms", median, note);
  emit(`turn_ms_p95_${condition.name}`, "ms", percentile(sorted, 0.95), note);
  emit(
    `heap_growth_mb_${condition.name}`,
    "mb",
    bucket.heapMb.reduce((sum, value) => sum + value, 0) / bucket.heapMb.length,
    `mean heap growth over ${String(TURNS)} turns after warmup`,
  );
  if (condition.name !== "trace_off") {
    emit(
      `turn_p50_overhead_pct_${condition.name}`,
      "count",
      baseMedian === 0 ? Number.NaN : ((median - baseMedian) / baseMedian) * 100,
      "percent over trace_off p50 (noise floor: compare with the spread between rounds)",
    );
  }
}

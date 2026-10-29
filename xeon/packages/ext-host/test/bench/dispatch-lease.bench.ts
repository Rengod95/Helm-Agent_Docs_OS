// M3-REQ-41, M3-REQ-40 (M3b B5-PERF). 탐구가 없는 턴마다 생기는 임대 부여·idle 반납의 비용(lease_turn_overhead, lease_records_per_turn),
// tap 지점 핸들러 하나를 시간 예산 아래에서 실행할 때 더해지는 시간(dispatch_overhead_per_handler), 기본 예산 값(budget_default_<class>)을 잰다.
// 실행(xeon/에서): bash ../scripts/guard.sh run -- bun packages/ext-host/test/bench/dispatch-lease.bench.ts
// 출력은 scripts/bench-server.ts의 줄 프로토콜이다. stdout에는 JSON 한 줄씩만 쓴다. 판정은 bench-server.ts와 bench-gate.ts가 한다.
// 샘플 하나는 배치 평균(ms)이다. 배치는 호출을 여러 번 한 번에 부르고 나눈다. 빼는 기준은 기준 배치 평균들의 평균이고 음수도 그대로 낸다.
// 턴은 t.boundary(thread).turnSettled()와 settled()의 한 쌍이다. 시험 호스트는 loop.turn을 실행하지 않으므로
// 기록은 임대 부여·반납과 상태 커밋에서만 생긴다. 실제 턴의 모델 호출과 그 기록 비용은 이 값에 들지 않는다.
import { Bug } from "@xeon/contracts";
import { DEFAULT_BUDGETS_MS } from "../../src/operations/index.ts";
import type { BudgetClass } from "../../src/operations/budget.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeGroupUnit, makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "../operations/support/harness.ts";

type Line =
  | {
      readonly metric: string;
      readonly unit: "ms";
      readonly samples: readonly number[];
      readonly note: string;
    }
  | {
      readonly metric: string;
      readonly unit: "ms" | "count";
      readonly value: number;
      readonly note: string;
    };

function emit(line: Line): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** 마이크로초 자리까지 남긴다. JSON이 부동소수 긴 꼬리를 싣지 않게 한다 */
function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Bug("dispatch-lease bench: mean of an empty batch list");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const WARMUPS = 3;
const RUNS = 30;
/**
 * 임대 순환은 턴 3개 주기로 돈다(부여 → 호출 → idle 반납 → 대기). 배치 턴 수를 주기의 배수로 두어
 * 모든 배치가 같은 위상에서 시작하게 한다
 */
const TURNS_PER_BATCH = 48;
const DISPATCHES_PER_BATCH = 200;
const TAP_POINT = "boundary.settle.after";

// ── 1. 임대: 턴마다 드라이브 임대를 받고 반납하는 비용 ─────────────────────────

interface TurnBatch {
  /** 배치 하나(턴 TURNS_PER_BATCH개)의 시간 */
  readonly elapsedMs: number;
  /** 배치 안에 쌓인 기록 개수, 종류별 */
  readonly kinds: ReadonlyMap<string, number>;
  /** 배치 안의 drive 호출 수 */
  readonly drives: number;
}

/** 새 호스트에서 thread를 열고 턴 TURNS_PER_BATCH개를 돌린 시간과 기록을 잰다. withDrive가 거짓이면 그룹이 없다 */
async function turnBatch(withDrive: boolean): Promise<TurnBatch> {
  const t = await createTestHost();
  const thread = t.newThread();
  let drives = 0;
  if (withDrive) {
    await t.host.install(
      makeGroupUnit({ name: "bench-drive" }, (g) => {
        g.drive(() => {
          drives += 1;
          return Promise.resolve();
        });
      }),
    );
  }
  await t.host.openThread(thread);
  await t.settled();
  const before = t.records.events(thread).length;
  const drivesBefore = drives;
  const started = performance.now();
  await eachInOrder(range(TURNS_PER_BATCH), async () => {
    await t.boundary(thread).turnSettled();
    await t.settled();
    return "continue";
  });
  const elapsedMs = performance.now() - started;
  const kinds = new Map<string, number>();
  for (const event of t.records.events(thread).slice(before)) {
    kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
  }
  return { elapsedMs, kinds, drives: drives - drivesBefore };
}

/** 턴 하나당 종류별 기록 평균(배치들의 합을 턴 수로 나눈다) */
function perTurnKinds(batches: readonly TurnBatch[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const batch of batches) {
    for (const [kind, count] of batch.kinds) sums.set(kind, (sums.get(kind) ?? 0) + count);
  }
  const turns = batches.length * TURNS_PER_BATCH;
  return new Map([...sums].map(([kind, total]): [string, number] => [kind, total / turns]));
}

function totalOf(kinds: ReadonlyMap<string, number>): number {
  return [...kinds.values()].reduce((sum, value) => sum + value, 0);
}

function formatKinds(kinds: ReadonlyMap<string, number>): string {
  const parts = [...kinds].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (parts.length === 0) return "none";
  return parts.map(([kind, value]) => `${kind}=${value.toFixed(3)}`).join(", ");
}

async function measureLease(): Promise<void> {
  const plain: TurnBatch[] = [];
  const driven: TurnBatch[] = [];
  // 두 팔을 번갈아 부른다. 배치 사이의 시간 흐름이 한쪽에만 쏠리지 않게 한다
  await eachInOrder(range(WARMUPS + RUNS), async (run) => {
    const base = await turnBatch(false);
    const withDrive = await turnBatch(true);
    if (run >= WARMUPS) {
      plain.push(base);
      driven.push(withDrive);
    }
    return "continue";
  });

  const baselineMs = mean(plain.map((batch) => batch.elapsedMs / TURNS_PER_BATCH));
  emit({
    metric: "lease_turn_overhead",
    unit: "ms",
    samples: driven.map((batch) => ms(batch.elapsedMs / TURNS_PER_BATCH - baselineMs)),
    note: `턴당 시간 차이(group 있음 − 없음). 빼는 값은 group 없는 배치 ${String(plain.length)}개의 턴당 평균 ${baselineMs.toFixed(4)} ms. 턴 ${String(TURNS_PER_BATCH)}개씩, 3턴 주기`,
  });

  const drivenKinds = perTurnKinds(driven);
  const plainKinds = perTurnKinds(plain);
  const records = ms(totalOf(drivenKinds) - totalOf(plainKinds));
  const calls = mean(driven.map((batch) => batch.drives / TURNS_PER_BATCH));
  emit({
    metric: "lease_records_per_turn",
    unit: "count",
    value: records,
    note: `턴당 기록 차이(group 있음 − 없음). group 있음: ${formatKinds(drivenKinds)}. group 없음: ${formatKinds(plainKinds)}. drive 호출 ${calls.toFixed(3)}회/턴. t.records.events(thread)의 kind로 셌다`,
  });
}

// ── 2. 예산 래퍼: tap 지점 핸들러 하나를 디스패치하는 비용 ───────────────────

/** 디스패치 배치 하나의 핸들러 하나당 평균 시간(ms). budgeted가 참이면 OperationsPolicy(기본 예산) 경로다 */
async function dispatchBatch(budgeted: boolean): Promise<number> {
  let handled = 0;
  const unit = makeUnit({ name: "bench-tap", points: [TAP_POINT] }, (g) => {
    g.on(TAP_POINT, () => {
      handled += 1;
    });
  });
  let t: TestHost;
  if (budgeted) {
    // 조립 루트와 같은 순서: 정책을 만들고, 확장을 admit하고, 호스트에 정책을 꽂는다(harness.ts)
    const harness = await createOperationsHarness();
    const admitted = harness.policy.admit(
      { name: "bench-tap", source: "user", trust: "user", essential: false },
      "plugin",
    );
    if (!admitted.ok) throw new Error(`dispatch-lease bench: admit failed: ${admitted.error.kind}`);
    t = harness.t;
  } else {
    t = await createTestHost();
  }
  await t.host.install(unit);
  const thread = t.newThread();
  const turnId = t.ids.next("trn");
  await t.host.openThread(thread);
  await t.settled();
  let failures = 0;
  const started = performance.now();
  await eachInOrder(range(DISPATCHES_PER_BATCH), async (index) => {
    const outcome = await t.host.dispatch(
      TAP_POINT,
      { turnId, aborted: false },
      { threadId: thread, dispatchKey: `bench-${String(index)}` },
    );
    failures += outcome.failures.length;
    return "continue";
  });
  const elapsedMs = performance.now() - started;
  if (failures !== 0) throw new Error(`dispatch-lease bench: ${String(failures)} handler failures`);
  if (handled !== DISPATCHES_PER_BATCH) {
    throw new Bug(
      `dispatch-lease bench: ${String(handled)} handler calls for ${String(DISPATCHES_PER_BATCH)} dispatches`,
    );
  }
  return elapsedMs / DISPATCHES_PER_BATCH;
}

async function measureDispatch(): Promise<void> {
  const plain: number[] = [];
  const budgeted: number[] = [];
  await eachInOrder(range(WARMUPS + RUNS), async (run) => {
    const base = await dispatchBatch(false);
    const withBudget = await dispatchBatch(true);
    if (run >= WARMUPS) {
      plain.push(base);
      budgeted.push(withBudget);
    }
    return "continue";
  });
  const baselineMs = mean(plain);
  emit({
    metric: "dispatch_overhead_per_handler",
    unit: "ms",
    samples: budgeted.map((perHandler) => ms(perHandler - baselineMs)),
    note: `핸들러당 시간 차이(OperationsPolicy 기본 예산 tap ${String(DEFAULT_BUDGETS_MS.tap)} ms − 정책 없는 기본 디스패치). 빼는 값 ${baselineMs.toFixed(4)} ms. 차이에는 runWithBudget의 타이머와 Promise 감싸기, onHandlerSettled의 장부 기록, tierOf 정렬 비용이 같이 든다(예산만의 값이 아니다). 디스패치 ${String(DISPATCHES_PER_BATCH)}회씩`,
  });
}

// ── 3. 기본 예산 값 ─────────────────────────────────────────────────────────

const BUDGET_CLASSES: readonly BudgetClass[] = [
  "first",
  "chain",
  "tap",
  "streamTap",
  "shutdown",
  "setup",
  "hook",
];

// budgetClassOf(budget.ts)의 분류를 따른다. setup과 hook은 그 함수를 거치지 않는다
const BUDGET_NOTES: Readonly<Record<BudgetClass, string>> = {
  first: "fold first 지점",
  chain: "fold chain·collect 지점",
  tap: "fold tap 지점 중 streamTap과 shutdown을 뺀 것",
  streamTap: "고빈도 관찰 지점 boundary.message.update, request.stream, tool.execution.update",
  shutdown: "session.shutdown 지점",
  setup: "확장 scope setup 시간(OperationsPolicy.setupBudgetMs)",
  hook: "외부 훅",
};

function emitBudgetDefaults(): void {
  for (const budgetClass of BUDGET_CLASSES) {
    emit({
      metric: `budget_default_${budgetClass}`,
      unit: "ms",
      value: DEFAULT_BUDGETS_MS[budgetClass],
      note: `DEFAULT_BUDGETS_MS.${budgetClass} (X.operations §4.2.2 기본값). 대상: ${BUDGET_NOTES[budgetClass]}`,
    });
  }
}

async function main(): Promise<void> {
  await measureLease();
  await measureDispatch();
  emitBudgetDefaults();
}

await main();

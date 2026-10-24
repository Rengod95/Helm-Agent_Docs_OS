import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// L4.desktop.plan §3.1 S4: 부모가 SIGKILL될 때 컴파일된 엔진이 stdin EOF를 읽고 끝나는지, 손자는 어떻게 되는지.
// usage: bun s4.ts <spike out 디렉터리> [반복 횟수]   결과는 JSON 한 줄씩 stdout에 낸다.

const outDirArg = process.argv[2];
const runs = Number(process.argv[3] ?? "10");
if (outDirArg === undefined || !Number.isInteger(runs) || runs < 1) {
  process.stderr.write("usage: bun s4.ts <out dir> [runs]\n");
  process.exit(2);
}
const outDir = resolve(outDirArg);
const stubPath = join(import.meta.dir, "parent-stub.ts");

interface Variant {
  readonly name: string;
  readonly binary: string;
  readonly args: readonly string[];
  /** 엔진이 --state 파일로 손자 pid를 알리는지 */
  readonly state: boolean;
}

const engine = join(outDir, "engine");
const variants: readonly Variant[] = [
  {
    name: "engine grandchild=none eof=exit-clean",
    binary: engine,
    args: ["--grandchild=none"],
    state: true,
  },
  {
    name: "engine grandchild=group eof=exit-clean",
    binary: engine,
    args: ["--grandchild=group"],
    state: true,
  },
  {
    name: "engine grandchild=detached eof=exit-clean",
    binary: engine,
    args: ["--grandchild=detached"],
    state: true,
  },
  {
    name: "engine grandchild=group eof=exit-noclean",
    binary: engine,
    args: ["--grandchild=group", "--eof=exit-noclean"],
    state: true,
  },
  {
    name: "engine grandchild=detached eof=exit-noclean",
    binary: engine,
    args: ["--grandchild=detached", "--eof=exit-noclean"],
    state: true,
  },
  {
    name: "engine grandchild=group eof=ignore",
    binary: engine,
    args: ["--grandchild=group", "--eof=ignore"],
    state: true,
  },
  {
    name: "host --stdio (compiled, plain)",
    binary: join(outDir, "s2", "host-plain"),
    args: ["host", "--stdio"],
    state: false,
  },
  {
    name: "host --stdio (compiled, minify)",
    binary: join(outDir, "s2", "host-minify"),
    args: ["host", "--stdio"],
    state: false,
  },
  {
    name: "host --stdio (compiled, minify+bytecode)",
    binary: join(outDir, "s2", "hostp-minify+bytecode"),
    args: ["host", "--stdio"],
    state: false,
  },
];

function isAlive(pid: number): boolean {
  const stat = `/proc/${String(pid)}/stat`;
  if (!existsSync(stat)) return false;
  try {
    const text = readFileSync(stat, "utf8");
    // "pid (comm) S ..." 상태가 Z(좀비)나 X면 끝난 것으로 본다
    const state = text.slice(text.lastIndexOf(")") + 2, text.lastIndexOf(")") + 3);
    return state !== "Z" && state !== "X";
    // oxlint-disable-next-line preserve-caught-error -- 없는 파일이나 깨진 입력이 정상 경로인 조회라 원인 보존이 필요 없다 (L4.desktop.plan 3.1.1)
  } catch {
    return false;
  }
}

function stats(values: readonly number[]): {
  min: number;
  median: number;
  p95: number;
  max: number;
} {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
  return { min: at(0), median: at(0.5), p95: at(0.95), max: at(1) };
}

interface GrandchildState {
  readonly engine: number;
  readonly grandchildren: readonly number[];
}

function readState(path: string): GrandchildState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const engineId = "engine" in parsed ? parsed.engine : undefined;
    const kids = "grandchildren" in parsed ? parsed.grandchildren : undefined;
    if (typeof engineId !== "number" || !Array.isArray(kids)) return undefined;
    return {
      engine: engineId,
      grandchildren: kids.filter((k): k is number => typeof k === "number"),
    };
    // oxlint-disable-next-line preserve-caught-error -- 없는 파일이나 깨진 입력이 정상 경로인 조회라 원인 보존이 필요 없다 (L4.desktop.plan 3.1.1)
  } catch {
    return undefined;
  }
}

async function readEnginePid(stdout: ReadableStream<Uint8Array>): Promise<number | undefined> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
    const next = await reader.read();
    if (next.done) break;
    text += decoder.decode(next.value);
  }
  reader.releaseLock();
  const match = /^engine=(\d+)/.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

async function oneRun(
  variant: Variant,
  index: number,
): Promise<{ exitMs: number | undefined; leftover: number; startMs: number }> {
  const statePrefix = join(outDir, `s4-state-${String(process.pid)}-${String(index)}`);
  const args = variant.state ? [...variant.args, `--state=${statePrefix}`] : [...variant.args];
  const spawnedAt = performance.now();
  const stub = Bun.spawn([process.execPath, stubPath, variant.binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const enginePid = await readEnginePid(stub.stdout);
  if (enginePid === undefined) {
    stub.kill("SIGKILL");
    return { exitMs: undefined, leftover: -1, startMs: Number.NaN };
  }
  // 엔진이 준비됐는지: state 파일이 생길 때까지(없는 변형은 300ms 고정 대기)
  let state: GrandchildState | undefined;
  if (variant.state) {
    for (let i = 0; i < 500 && state === undefined; i += 1) {
      state = readState(`${statePrefix}.json`);
      // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
      if (state === undefined) await Bun.sleep(5);
    }
  } else {
    await Bun.sleep(1500);
  }
  const startMs = performance.now() - spawnedAt;
  await Bun.sleep(300);
  const killedAt = performance.now();
  stub.kill("SIGKILL");
  await stub.exited;
  let exitMs: number | undefined;
  for (let i = 0; i < 4000; i += 1) {
    if (!isAlive(enginePid)) {
      exitMs = performance.now() - killedAt;
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
    await Bun.sleep(2);
  }
  await Bun.sleep(1000);
  const kids = state?.grandchildren ?? [];
  const alive = kids.filter(isAlive);
  for (const pid of [enginePid, ...kids]) {
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  }
  rmSync(`${statePrefix}.json`, { force: true });
  rmSync(`${statePrefix}.log`, { force: true });
  return { exitMs, leftover: alive.length, startMs };
}

// 콜드 스타트: 컴파일된 호스트에 빈 stdin을 주고 종료까지 걸리는 시간(기동 + 즉시 EOF)
async function coldRun(binary: string): Promise<number> {
  const startedAt = performance.now();
  const child = Bun.spawn([binary, "host", "--stdio"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await child.exited;
  return performance.now() - startedAt;
}

for (const variant of variants) {
  if (!existsSync(variant.binary)) {
    process.stdout.write(
      `${JSON.stringify({ variant: variant.name, skipped: "binary missing" })}\n`,
    );
    continue;
  }
  const exits: number[] = [];
  const starts: number[] = [];
  let leftoverRuns = 0;
  let neverExited = 0;
  for (let i = 0; i < runs; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
    const result = await oneRun(variant, i);
    if (result.exitMs === undefined) neverExited += 1;
    else exits.push(result.exitMs);
    if (result.leftover > 0) leftoverRuns += 1;
    starts.push(result.startMs);
  }
  const cold: number[] = [];
  if (!variant.state) {
    // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
    for (let i = 0; i < runs; i += 1) cold.push(await coldRun(variant.binary));
  }
  process.stdout.write(
    `${JSON.stringify({
      variant: variant.name,
      runs,
      eofToExitMs: exits.length === 0 ? null : stats(exits),
      neverExited,
      runsWithLeftoverGrandchild: leftoverRuns,
      spawnToReadyMs: variant.state ? stats(starts) : null,
      coldStartThenEofExitMs: cold.length === 0 ? null : stats(cold),
    })}\n`,
  );
}

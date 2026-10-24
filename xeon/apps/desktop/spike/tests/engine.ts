import { appendFileSync, writeFileSync } from "node:fs";

// L4.desktop.plan §3.1 S1·S3·S4 측정용 가짜 엔진. 제품 코드가 아니다.
// `bun build --compile`로 묶어서 쓴다. stdin은 JSON Lines 명령, stdout은 JSON Lines 프레임이다.
//
// 인자: --grandchild=none|group|detached  손자 `sleep 600`을 같은 그룹/새 세션으로 띄운다
//       --eof=exit-clean|exit-noclean|ignore  stdin EOF를 읽었을 때: 손자까지 정리하고 종료 / 손자를 두고 종료 / 무시
//       --state=<경로>  pid와 사건 시각을 남기는 파일 접두사(<경로>.json, <경로>.log)

interface EngineConfig {
  readonly grandchild: "none" | "group" | "detached";
  readonly eof: "exit-clean" | "exit-noclean" | "ignore";
  readonly state: string | undefined;
}

function flagOf(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseConfig(args: readonly string[]): EngineConfig {
  const grandchild = flagOf(args, "grandchild");
  const eof = flagOf(args, "eof");
  return {
    grandchild: grandchild === "group" || grandchild === "detached" ? grandchild : "none",
    eof: eof === "exit-noclean" || eof === "ignore" ? eof : "exit-clean",
    state: flagOf(args, "state"),
  };
}

const config = parseConfig(process.argv.slice(2));
const grandchildPids: number[] = [];

/** 사건을 파일에 남긴다. 부모가 죽으면 stderr 파이프가 끊기므로 stderr에는 쓰지 않는다 */
function note(event: string): void {
  if (config.state === undefined) return;
  appendFileSync(`${config.state}.log`, `${Date.now()} ${event}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
    // oxlint-disable-next-line preserve-caught-error -- 없는 파일이나 깨진 입력이 정상 경로인 조회라 원인 보존이 필요 없다 (L4.desktop.plan 3.1.1)
  } catch {
    return undefined;
  }
}

function numberOf(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" ? value : fallback;
}

if (config.grandchild !== "none") {
  const child = Bun.spawn(["sleep", "600"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: config.grandchild === "detached",
  });
  child.unref();
  grandchildPids.push(child.pid);
}
if (config.state !== undefined) {
  writeFileSync(
    `${config.state}.json`,
    JSON.stringify({ engine: process.pid, grandchildren: grandchildPids }),
  );
}
note(`start pid=${String(process.pid)} grandchildren=${grandchildPids.join(",")}`);

const out = Bun.stdout.writer();
const encoder = new TextEncoder();

async function emit(text: string, flush: boolean): Promise<void> {
  void out.write(encoder.encode(text));
  if (flush) await out.flush();
}

function frame(seq: number, tag: string, pad: string): string {
  return `${JSON.stringify({ ev: "frame", tag, seq, t: Date.now(), pad })}\n`;
}

async function blast(command: Record<string, unknown>): Promise<void> {
  const count = numberOf(command, "count", 1);
  const size = numberOf(command, "size", 0);
  const pace = numberOf(command, "paceMs", 0);
  const batch = numberOf(command, "batch", 1);
  const tag = typeof command["tag"] === "string" ? command["tag"] : "x";
  const pad = "x".repeat(size);
  if (pace > 0) {
    let seq = 0;
    while (seq < count) {
      for (let i = 0; i < batch && seq < count; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
        await emit(frame(seq, tag, pad), false);
        seq += 1;
      }
      // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
      await out.flush();
      // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
      await Bun.sleep(pace);
    }
  } else {
    for (let seq = 0; seq < count; seq += 1) {
      // 큰 프레임은 하나씩 밀어 내고, 작은 프레임은 256개씩 모아 flush한다
      // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
      await emit(frame(seq, tag, pad), size >= 4096 || seq % 256 === 255);
    }
    await out.flush();
  }
  await emit(`${JSON.stringify({ ev: "done", tag, count })}\n`, true);
}

const rx = { lines: 0, bytes: 0, missing: 0, dup: 0, last: -1, bad: 0 };

async function handle(line: string): Promise<void> {
  const command = parseLine(line);
  if (command === undefined) {
    rx.bad += 1;
    return;
  }
  const name = command["cmd"];
  if (name === "blast") {
    await blast(command);
  } else if (name === "rx") {
    const seq = numberOf(command, "seq", -1);
    rx.lines += 1;
    rx.bytes += line.length + 1;
    if (seq === rx.last + 1) rx.last = seq;
    else if (seq <= rx.last) rx.dup += 1;
    else {
      rx.missing += seq - rx.last - 1;
      rx.last = seq;
    }
  } else if (name === "stats") {
    await emit(`${JSON.stringify({ ev: "stats", ...rx })}\n`, true);
  } else if (name === "partial-and-die") {
    // 줄바꿈 없이 프레임 절반만 쓰고 죽는다(S3 세대 교체)
    await emit(`{"ev":"frame","tag":"partial","seq":0,"pad":"AAAA`, true);
    process.exit(1);
  } else if (name === "ping") {
    await emit(`${JSON.stringify({ ev: "pong", t: Date.now() })}\n`, true);
  } else {
    rx.bad += 1;
  }
}

function killAll(): void {
  for (const pid of grandchildPids) {
    try {
      process.kill(pid, "SIGKILL");
      // oxlint-disable-next-line preserve-caught-error -- 없는 파일이나 깨진 입력이 정상 경로인 조회라 원인 보존이 필요 없다 (L4.desktop.plan 3.1.1)
    } catch {
      // 이미 없다
    }
  }
}

function onEof(): void {
  note(`eof policy=${config.eof}`);
  if (config.eof === "ignore") return;
  if (config.eof === "exit-clean") killAll();
  note("exit");
  process.exit(0);
}

async function main(): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  let queue: Promise<void> = Promise.resolve();
  for await (const chunk of Bun.stdin.stream()) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      // stall 명령은 읽기를 멈춘다: 처리가 끝날 때까지 다음 chunk를 가져오지 않는다
      if (line.startsWith('{"cmd":"stall"')) {
        const stall = parseLine(line);
        // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
        await queue;
        // oxlint-disable-next-line no-await-in-loop -- 측정 하네스는 단계를 순서대로 실행하는 것이 목적이다 (L4.desktop.plan 3.1.1)
        await Bun.sleep(stall === undefined ? 0 : numberOf(stall, "ms", 0));
      } else {
        queue = queue.then(() => handle(line));
      }
      newline = pending.indexOf("\n");
    }
  }
  await queue;
  onEof();
}

await main();
// ignore 모드: stdin이 끝나도 살아 있는다(수명 임대를 구현하지 않은 엔진을 흉내 낸다)
if (config.eof === "ignore") {
  setInterval(() => undefined, 1000);
}

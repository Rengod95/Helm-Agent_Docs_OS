import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CancelScope } from "@xeon/contracts/services";
import type { LogFields, Logger, Result } from "@xeon/contracts";
import { createExecService, type ExecServiceOptions } from "../src/service.ts";
import { hostPlatform } from "./support/platform.ts";

// L0.exec.spec §3.8, §3.8.2, §10 4, PATCHES P19: spill 파일과 임시 디렉터리를 호출자가 준 상태 디렉터리 아래 소유자 전용으로 만든다.

const none: CancelScope = { abortSignal: undefined };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-exec-spill-"));
  roots.push(dir);
  return dir;
}

function service(cwd: string, overrides: Partial<ExecServiceOptions>, logger?: Logger) {
  return createExecService(
    {
      cwd,
      shellPath: "/bin/bash",
      defaultTimeoutMs: 0,
      outputSpillBytes: 10,
      envExtra: [],
      ...overrides,
    },
    {
      platform: hostPlatform(),
      secrets: undefined,
      parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
      ...(logger === undefined ? {} : { logger }),
    },
  );
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
}

interface LogRecord {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(): { readonly logger: Logger; readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const write =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      records.push({ level, event, fields });
    };
  const logger: Logger = {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => logger,
  };
  return { logger, records };
}

const OUTPUT = "12345678901234567890";

describe("spill location", () => {
  test("with tempDir the spill file lives under it, owner-only, with the full output", async () => {
    const work = root();
    const state = join(work, "state", "spill");
    const exec = service(work, { tempDir: state });
    const result = await exec.exec(`printf ${OUTPUT}`, undefined, none);
    if (!result.ok) throw new Error(`exec failed: ${result.error.message}`);
    const spillPath = result.value.spillPath;
    if (spillPath === undefined) throw new Error("expected a spill file");
    // <tempDir>/tmp-XXXX/pi-output-<uuid>.log
    expect(dirname(dirname(spillPath))).toBe(state);
    expect(readFileSync(spillPath, "utf8")).toBe(OUTPUT);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(spillPath)).mode & 0o777).toBe(0o700);
    expect(statSync(spillPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(state)).toHaveLength(1);
  });

  test("without tempDir the spill file stays in the OS temp folder (original behavior)", async () => {
    const work = root();
    const exec = service(work, {});
    const result = await exec.exec(`printf ${OUTPUT}`, undefined, none);
    if (!result.ok) throw new Error(`exec failed: ${result.error.message}`);
    const spillPath = result.value.spillPath;
    if (spillPath === undefined) throw new Error("expected a spill file");
    expect(spillPath.startsWith(tmpdir())).toBe(true);
    expect(statSync(spillPath).mode & 0o777).toBe(0o600);
    rmSync(dirname(spillPath), { recursive: true, force: true });
  });

  test("createTempDir uses the same root", async () => {
    const work = root();
    const state = join(work, "state", "spill");
    const exec = service(work, { tempDir: state });
    const made = await exec.createTempDir("scratch-", none);
    if (!made.ok) throw new Error("createTempDir failed");
    expect(dirname(made.value)).toBe(state);
    expect(made.value.startsWith(join(state, "scratch-"))).toBe(true);
  });
});

/** 상태 디렉터리에 이미 쌓인 출력 파일을 흉내 낸다 */
function stateWith(work: string, bytes: number): string {
  const state = join(work, "state", "spill");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "old-output.log"), "x".repeat(bytes));
  return state;
}

describe("disk cap (L0.exec.spec §3.8.2 [결정: M3-REQ-47])", () => {
  const OUT = "12345678901234567890";

  test("with the cap reached no spill file starts and the output still arrives, under the cap it spills", async () => {
    const work = root();
    const state = stateWith(work, 200);
    const capped = service(work, { tempDir: state, spillMaxBytes: 100, now: () => 0 });
    const chunks: string[] = [];
    const blocked = valueOf(
      await capped.exec(`printf ${OUT}`, { onOutput: (text) => chunks.push(text) }, none),
    );
    expect(blocked.spillPath).toBeUndefined();
    expect(chunks.join("")).toBe(OUT);
    expect(readdirSync(state)).toEqual(["old-output.log"]);

    const roomy = service(work, { tempDir: state, spillMaxBytes: 1000, now: () => 0 });
    const spilled = valueOf(await roomy.exec(`printf ${OUT}`, undefined, none));
    if (spilled.spillPath === undefined) throw new Error("expected a spill file under the cap");
    expect(readFileSync(spilled.spillPath, "utf8")).toBe(OUT);
  });

  test("0 means no cap", async () => {
    const work = root();
    const state = stateWith(work, 200);
    const unlimited = service(work, { tempDir: state, spillMaxBytes: 0, now: () => 0 });
    expect(valueOf(await unlimited.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeDefined();
  });

  test("without tempDir the cap is not applied, because the OS temp folder holds other files", async () => {
    const work = root();
    const exec = service(work, { spillMaxBytes: 1, now: () => 0 });
    const spilled = valueOf(await exec.exec(`printf ${OUT}`, undefined, none));
    if (spilled.spillPath === undefined) throw new Error("expected a spill file");
    rmSync(dirname(spilled.spillPath), { recursive: true, force: true });
  });

  test("the usage is cached for 30 seconds on the injected clock", async () => {
    const work = root();
    const state = stateWith(work, 200);
    let clock = 0;
    const exec = service(work, { tempDir: state, spillMaxBytes: 100, now: () => clock });
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeUndefined();
    // 실제 사용량은 0이 되지만 캐시 구간(30초) 안에서는 여전히 상한에 닿은 것으로 본다
    rmSync(join(state, "old-output.log"));
    clock = 29_999;
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeUndefined();
    clock = 30_000;
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeDefined();
  });

  test("a command that wrote a spill file makes the next command measure the usage again", async () => {
    const work = root();
    const state = join(work, "state", "spill");
    let clock = 0;
    const exec = service(work, { tempDir: state, spillMaxBytes: 30, now: () => clock });
    // 측정 0바이트, 20바이트 기록
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeDefined();
    // 측정 20바이트(< 30), 40바이트 기록
    clock = 1000;
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeDefined();
    // 측정 40바이트(>= 30)면 막힌다. 캐시가 남아 있었다면 여기서도 기록했을 것이다
    clock = 2000;
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeUndefined();
    expect(readdirSync(state)).toHaveLength(2);
  });

  test("the cap event is logged once per usage window", async () => {
    const work = root();
    const state = stateWith(work, 200);
    const { logger, records } = recordingLogger();
    let clock = 0;
    const exec = service(work, { tempDir: state, spillMaxBytes: 100, now: () => clock }, logger);
    await exec.exec(`printf ${OUT}`, undefined, none);
    await exec.exec(`printf ${OUT}`, undefined, none);
    const reached = {
      level: "warn",
      event: "exec.spill_cap_reached",
      fields: { usedBytes: 200, capBytes: 100 },
    };
    expect(records).toEqual([reached]);
    clock = 30_000;
    await exec.exec(`printf ${OUT}`, undefined, none);
    expect(records).toEqual([reached, reached]);
  });

  test("a usage that cannot be measured stops the spill and logs exec.spill_usage_failed", async () => {
    const work = root();
    // 상태 경로가 디렉터리가 아니면 사용량을 잴 수 없다
    const notADir = join(work, "state-file");
    writeFileSync(notADir, "x");
    const { logger, records } = recordingLogger();
    const exec = service(work, { tempDir: notADir, spillMaxBytes: 100, now: () => 0 }, logger);
    expect(valueOf(await exec.exec(`printf ${OUT}`, undefined, none)).spillPath).toBeUndefined();
    expect(records).toEqual([
      { level: "warn", event: "exec.spill_usage_failed", fields: { kind: "unreadable" } },
    ]);
  });
});

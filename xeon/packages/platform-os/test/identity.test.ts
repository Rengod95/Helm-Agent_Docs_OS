import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import {
  createFingerprintReader,
  parseBootTimeSeconds,
  parseIoPlatformUuid,
  parseProcStatStartTicks,
  parsePsLstart,
  procStartToEpochMs,
  readMachineId,
  readUserId,
  type ReadTextFile,
  type ReadTextFileSync,
} from "../src/identity.ts";
import type { RunCommand, RunCommandSync } from "../src/proc.ts";
import { readOsRuntime } from "../src/runtime.ts";
import { detectPlatform, selectProviders } from "../src/select.ts";
import { memoryLogger } from "./support/clock.ts";

// pid 1234, comm "(my (prog) x)", 22번째 필드 = 987654 tick
const STAT_LINE =
  "1234 (my (prog) x) S 1 1234 1234 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000000 200 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0";

const fakePs: RunCommandSync = (argv) => {
  expect(argv.slice(0, 4)).toEqual(["ps", "-o", "lstart=", "-p"]);
  return argv[4] === "42"
    ? ok({ exitCode: 0, stdout: "Wed Oct 21 10:11:12 2026\n" })
    : ok({ exitCode: 1, stdout: "" });
};

const noRun: RunCommand = () => Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT" }));

const machineIdFile: ReadTextFile = (path) =>
  Promise.resolve(path === "/etc/machine-id" ? ok("abc123def456\n") : err({ code: "ENOENT" }));

const fakeIoreg: RunCommand = (argv) => {
  expect(argv).toEqual(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"]);
  return Promise.resolve(
    ok({
      exitCode: 0,
      stdout: '  | {\n  |   "IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"\n  | }\n',
    }),
  );
};

describe("processStartFingerprint", () => {
  test("Linux /proc 지문: comm에 공백과 괄호가 있어도 22번째 필드를 읽는다", () => {
    expect(parseProcStatStartTicks(STAT_LINE)).toBe(987_654);
    expect(parseProcStatStartTicks("garbage")).toBeUndefined();
    expect(parseProcStatStartTicks("1 (x) S 1 2")).toBeUndefined();
  });

  test("btime 파싱과 epoch ms 변환(주입한 파일 내용)", () => {
    expect(parseBootTimeSeconds("cpu  1 2 3\nbtime 1700000000\nprocesses 5\n")).toBe(1_700_000_000);
    expect(parseBootTimeSeconds("cpu 1")).toBeUndefined();
    expect(procStartToEpochMs(1_700_000_000, 987_654, 100)).toBe(1_700_000_000_000 + 9_876_540);

    const files: Record<string, string> = {
      "/proc/1234/stat": STAT_LINE,
      "/proc/stat": "cpu 1\nbtime 1700000000\n",
    };
    const readFileSync: ReadTextFileSync = (path) => {
      const content = files[path];
      return content === undefined ? err({ code: "ENOENT" }) : ok(content);
    };
    const fingerprint = createFingerprintReader({
      source: "proc",
      platform: "linux",
      readFileSync,
      runSync: () => err({ kind: "spawn_failed", code: "ENOENT" }),
      clkTck: 100,
    });
    expect(fingerprint(1234)).toEqual(ok(1_700_000_000_000 + 9_876_540));
    expect(fingerprint(1234)).toEqual(ok(1_700_000_000_000 + 9_876_540));
    expect(fingerprint(9999)).toEqual(ok(null));
  });

  test("부팅 시각은 처음 읽은 값으로 고정한다(NTP 보정에도 같은 pid는 같은 값)", () => {
    let btime = 1_700_000_000;
    const readFileSync: ReadTextFileSync = (path) =>
      path === "/proc/stat" ? ok(`btime ${btime}\n`) : ok(STAT_LINE);
    const fingerprint = createFingerprintReader({
      source: "proc",
      platform: "linux",
      readFileSync,
      runSync: () => err({ kind: "spawn_failed", code: "ENOENT" }),
      clkTck: 100,
    });
    const first = fingerprint(1234);
    btime += 3;
    expect(fingerprint(1234)).toEqual(first);
  });

  test("Linux 오류: 읽기 권한 없음은 io, 형식 깨짐은 io", () => {
    const base = {
      source: "proc",
      platform: "linux",
      runSync: () => err({ kind: "spawn_failed" as const, code: "ENOENT" }),
      clkTck: 100,
    } as const;
    const denied = createFingerprintReader({
      ...base,
      readFileSync: () => err({ code: "EACCES" }),
    });
    expect(denied(5)).toEqual(err({ kind: "io", code: "EACCES" }));
    const broken = createFingerprintReader({ ...base, readFileSync: () => ok("not a stat line") });
    expect(broken(5)).toEqual(err({ kind: "io", code: "PROC_STAT_FORMAT" }));
  });

  test("잘못된 pid는 ok(null)", () => {
    const fingerprint = createFingerprintReader({
      source: "proc",
      platform: "linux",
      readFileSync: () => ok(STAT_LINE),
      runSync: () => err({ kind: "spawn_failed", code: "ENOENT" }),
      clkTck: 100,
    });
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(fingerprint(pid)).toEqual(ok(null));
  });

  test("macOS ps lstart 파싱", () => {
    const expected = new Date(2026, 9, 21, 10, 11, 12).getTime();
    expect(parsePsLstart("Wed Oct 21 10:11:12 2026\n")).toBe(expected);
    expect(parsePsLstart("Tue Oct  7 03:04:05 2026")).toBe(new Date(2026, 9, 7, 3, 4, 5).getTime());
    expect(parsePsLstart("nonsense")).toBeUndefined();
    expect(parsePsLstart("Wed Foo 21 10:11:12 2026")).toBeUndefined();
  });

  test("macOS: ps 출력으로 지문을 만들고 없는 pid는 ok(null)", () => {
    const fingerprint = createFingerprintReader({
      source: "ps",
      platform: "darwin",
      readFileSync: () => err({ code: "ENOENT" }),
      runSync: fakePs,
      clkTck: 100,
    });
    expect(fingerprint(42)).toEqual(ok(new Date(2026, 9, 21, 10, 11, 12).getTime()));
    expect(fingerprint(43)).toEqual(ok(null));
  });

  test("Windows는 unsupported", () => {
    const fingerprint = createFingerprintReader({
      source: "unsupported",
      platform: "win32",
      readFileSync: () => err({ code: "ENOENT" }),
      runSync: () => err({ kind: "spawn_failed", code: "ENOENT" }),
      clkTck: 100,
    });
    expect(fingerprint(5)).toEqual(err({ kind: "unsupported", platform: "win32" }));
  });
});

describe("processStartFingerprint: 실제 프로세스 (Linux·macOS)", () => {
  test("같은 pid는 같은 값, 끝난 자식 pid는 ok(null)", () => {
    const runtime = readOsRuntime();
    const info = detectPlatform(runtime.probe);
    if (!info.ok || info.value.platform === "win32") return;
    const providers = selectProviders(info.value);
    const fingerprint = createFingerprintReader({
      source: providers.fingerprint,
      platform: info.value.platform,
      readFileSync: runtime.readFileSync,
      runSync: runtime.runSync,
      clkTck: runtime.clkTck,
    });
    const own = fingerprint(process.pid);
    expect(own.ok && own.value !== null).toBe(true);
    expect(fingerprint(process.pid)).toEqual(own);

    const child = Bun.spawnSync(["true"]);
    expect(fingerprint(child.pid)).toEqual(ok(null));
  });
});

describe("machineId", () => {
  const signal = new AbortController().signal;

  test("Linux: /etc/machine-id를 trim해서 쓴다", async () => {
    const { logger, records } = memoryLogger();
    const id = await readMachineId(
      {
        source: "etc-machine-id",
        readFile: machineIdFile,
        run: noRun,
        hostname: () => "h",
        logger,
      },
      signal,
    );
    expect(id).toBe("abc123def456");
    expect(records).toEqual([]);
  });

  test("macOS: ioreg의 IOPlatformUUID", async () => {
    const { logger } = memoryLogger();
    const id = await readMachineId(
      {
        source: "ioreg",
        readFile: () => Promise.resolve(err({ code: "ENOENT" })),
        run: fakeIoreg,
        hostname: () => "h",
        logger,
      },
      signal,
    );
    expect(id).toBe("11111111-2222-3333-4444-555555555555");
    expect(parseIoPlatformUuid("nothing")).toBeUndefined();
  });

  test("읽지 못하면 hostname의 SHA-256 앞 32자를 쓰고 경고를 남긴다", async () => {
    const { logger, records } = memoryLogger();
    const deps = {
      source: "etc-machine-id",
      readFile: () => Promise.resolve(err({ code: "ENOENT" })),
      run: noRun,
      hostname: () => "build-host",
      logger,
    } as const;
    const first = await readMachineId(deps, signal);
    const second = await readMachineId(deps, signal);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
    const expected = new Bun.CryptoHasher("sha256").update("build-host").digest("hex").slice(0, 32);
    expect(first).toBe(expected);
    expect(records[0]).toMatchObject({ level: "warn", event: "os.machine_id.fallback" });
  });

  test("빈 machine-id 파일도 대체한다", async () => {
    const { logger } = memoryLogger();
    const id = await readMachineId(
      {
        source: "etc-machine-id",
        readFile: () => Promise.resolve(ok("  \n")),
        run: noRun,
        hostname: () => "h",
        logger,
      },
      signal,
    );
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

test("readUserId: getuid가 없으면 null", () => {
  expect(readUserId(undefined)).toBeNull();
  expect(readUserId(() => 501)).toBe(501);
});

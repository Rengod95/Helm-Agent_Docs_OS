import { createHash } from "node:crypto";
import { assertNever, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { FingerprintError, OsPlatform } from "@xeon/contracts/services";
import type { FingerprintSource, MachineIdSource } from "./select.ts";
import type { RunCommand, RunCommandSync } from "./proc.ts";

// 기계 식별자, 사용자 번호, 프로세스 시작 시각 지문(OS-18, L0.os.spec §3.10).
// OS 분기는 select.ts가 고른 source 값으로만 한다.

interface TextFileError {
  readonly code: string;
}
export type ReadTextFile = (path: string) => Promise<Result<string, TextFileError>>;
export type ReadTextFileSync = (path: string) => Result<string, TextFileError>;

export interface MachineIdDeps {
  readonly source: MachineIdSource;
  readonly readFile: ReadTextFile;
  readonly run: RunCommand;
  readonly hostname: () => string;
  readonly logger: Logger;
}

function hostnameHash(hostname: string): string {
  return createHash("sha256").update(hostname).digest("hex").slice(0, 32);
}

const IO_PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{8,64})"/;

/** ioreg 출력에서 IOPlatformUUID를 꺼낸다. 없으면 undefined */
export function parseIoPlatformUuid(output: string): string | undefined {
  return IO_PLATFORM_UUID.exec(output)?.[1];
}

async function readPrimaryMachineId(
  deps: MachineIdDeps,
  signal: AbortSignal,
): Promise<string | undefined> {
  switch (deps.source) {
    case "etc-machine-id": {
      const text = await deps.readFile("/etc/machine-id");
      const trimmed = text.ok ? text.value.trim() : "";
      return trimmed === "" ? undefined : trimmed;
    }
    case "ioreg": {
      const out = await deps.run(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], { signal });
      if (!out.ok || out.value.exitCode !== 0) return undefined;
      return parseIoPlatformUuid(out.value.stdout);
    }
    case "hostname":
      return undefined;
    default:
      return assertNever(deps.source, "MachineIdSource");
  }
}

/**
 * 기계 식별자. Linux는 /etc/machine-id, macOS는 ioreg의 IOPlatformUUID. 읽지 못하면 hostname의 SHA-256 hex 앞 32자를
 * 쓰고 경고 로그를 남긴다. Windows 레지스트리 MachineGuid는 2차라 hostname 해시를 쓴다. 서비스 등록 때 한 번 읽는다.
 */
export async function readMachineId(deps: MachineIdDeps, signal: AbortSignal): Promise<string> {
  const primary = await readPrimaryMachineId(deps, signal);
  if (primary !== undefined) return primary;
  deps.logger.warn("os.machine_id.fallback", { source: deps.source });
  return hostnameHash(deps.hostname());
}

/** POSIX uid. getuid가 없는 환경(Windows)은 null */
export function readUserId(getuid: (() => number) | undefined): number | null {
  return getuid === undefined ? null : getuid();
}

export interface FingerprintDeps {
  readonly source: FingerprintSource;
  readonly platform: OsPlatform;
  readonly readFileSync: ReadTextFileSync;
  readonly runSync: RunCommandSync;
  /** sysconf(_SC_CLK_TCK). Linux에서는 100이다 [가정] */
  readonly clkTck: number;
}

/**
 * /proc/<pid>/stat 내용에서 부팅 뒤 시작 시각(clock tick)을 꺼낸다. 22번째 필드다.
 * comm 필드에 공백과 괄호가 들어갈 수 있으므로 마지막 ')' 뒤에서 센다.
 */
export function parseProcStatStartTicks(content: string): number | undefined {
  const close = content.lastIndexOf(")");
  if (close < 0) return undefined;
  // 닫는 괄호 뒤 첫 필드가 3번째(state)다. 22번째는 그 뒤 19칸이다
  const fields = content
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const raw = fields[19];
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/** /proc/stat 내용에서 btime(부팅 시각, epoch 초)을 꺼낸다 */
export function parseBootTimeSeconds(content: string): number | undefined {
  const match = /^btime\s+(\d+)$/m.exec(content);
  const raw = match?.[1];
  return raw === undefined ? undefined : Number(raw);
}

/** 부팅 시각(초)과 시작 tick을 epoch ms로 바꾼다 */
export function procStartToEpochMs(
  bootSeconds: number,
  startTicks: number,
  clkTck: number,
): number {
  return bootSeconds * 1000 + Math.floor((startTicks * 1000) / clkTck);
}

const MONTHS: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const PS_LSTART = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

/** `ps -o lstart=` 출력(예: "Tue Oct 21 10:11:12 2026", 지역 시각, 초 단위)을 epoch ms로 바꾼다 */
export function parsePsLstart(output: string): number | undefined {
  const match = PS_LSTART.exec(output.trim());
  if (match === null) return undefined;
  const month = MONTHS.indexOf(match[1] ?? "");
  if (month < 0) return undefined;
  const [day, hour, minute, second, year] = [match[2], match[3], match[4], match[5], match[6]].map(
    Number,
  );
  if (
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    year === undefined
  ) {
    return undefined;
  }
  return new Date(year, month, day, hour, minute, second).getTime();
}

/**
 * 프로세스 시작 시각 지문(epoch ms). 그 pid의 프로세스가 없으면 ok(null). 같은 pid에 같은 값을 돌려주는 것만
 * 보장한다. Linux는 부팅 시각을 처음 읽은 값으로 고정해 호출마다 같은 값이 나오게 한다.
 */
export function createFingerprintReader(
  deps: FingerprintDeps,
): (pid: number) => Result<number | null, FingerprintError> {
  let bootSeconds: number | undefined;
  const linux = (pid: number): Result<number | null, FingerprintError> => {
    const stat = deps.readFileSync(`/proc/${pid}/stat`);
    if (!stat.ok) {
      return stat.error.code === "ENOENT" || stat.error.code === "ESRCH"
        ? ok(null)
        : err({ kind: "io", code: stat.error.code });
    }
    const ticks = parseProcStatStartTicks(stat.value);
    if (ticks === undefined) return err({ kind: "io", code: "PROC_STAT_FORMAT" });
    if (bootSeconds === undefined) {
      const boot = deps.readFileSync("/proc/stat");
      if (!boot.ok) return err({ kind: "io", code: boot.error.code });
      bootSeconds = parseBootTimeSeconds(boot.value);
      if (bootSeconds === undefined) return err({ kind: "io", code: "PROC_BTIME_MISSING" });
    }
    return ok(procStartToEpochMs(bootSeconds, ticks, deps.clkTck));
  };
  const ps = (pid: number): Result<number | null, FingerprintError> => {
    const out = deps.runSync(["ps", "-o", "lstart=", "-p", String(pid)]);
    if (!out.ok) return err({ kind: "io", code: out.error.kind });
    // 없는 pid는 종료 코드 1과 빈 출력이다
    if (out.value.stdout.trim() === "")
      return out.value.exitCode === 0 ? err({ kind: "io", code: "PS_EMPTY" }) : ok(null);
    const started = parsePsLstart(out.value.stdout);
    return started === undefined ? err({ kind: "io", code: "PS_FORMAT" }) : ok(started);
  };
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return ok(null);
    switch (deps.source) {
      case "proc":
        return linux(pid);
      case "ps":
        return ps(pid);
      case "unsupported":
        return err({ kind: "unsupported", platform: deps.platform });
      default:
        return assertNever(deps.source, "FingerprintSource");
    }
  };
}

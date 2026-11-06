import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, uptime } from "node:os";
import { dirname, join } from "node:path";
import { attempt, type Logger } from "@fresnel/contracts";
import type { ExecPlatformProvider } from "./provider.ts";

// L0.exec.spec §3.8 자식 프로세스 정리. 도구가 띄운 셸은 새 프로세스 그룹이라 부모(사이드카)가 SIGKILL로 죽으면 고아로 남는다.
// 띄울 때 장부에 적고, 정상 종료는 `cleanup`이 그룹을 죽이며, 비정상 종료로 남은 줄은 다음 시작에서 거둔다.

interface LedgerEntry {
  readonly hostPid: number;
  readonly pid: number;
  /** 재부팅 뒤 같은 pid를 다른 프로세스가 쓰는 일을 가르는 부팅 시각(ms, 근사) */
  readonly bootMs: number;
}

export interface ChildLedger {
  add(pid: number): void;
  /** 이 프로세스가 아직 지켜보는 자식 그룹 전부에 SIGKILL을 보낸다. 프로세스 종료 때 동기로 부른다 */
  killAll(): void;
  remove(pid: number): void;
  /** 죽은 호스트가 남긴 그룹 리더 프로세스의 그룹을 정리하고 장부 줄을 지운다. 정리한 개수를 돌려준다 */
  sweep(): number;
}

const BOOT_TOLERANCE_MS = 5000;

// `exit` 리스너는 프로세스에 하나만 둔다. SIGTERM·SIGINT·exit(1)로 끝나도 `exit`는 불린다(SIGKILL은 장부가 다음 시작에 거둔다)
const ledgers = new Set<ChildLedger>();
let exitHooked = false;
function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", () => {
    for (const ledger of ledgers) ledger.killAll();
  });
}

function bootMsNow(): number {
  return Date.now() - Math.round(uptime() * 1000);
}

function isAlive(pid: number): boolean {
  const sent = attempt(() => process.kill(pid, 0));
  if (sent.ok) return true;
  // EPERM이면 살아 있지만 우리 것이 아니다
  return sent.error.cause instanceof Error && "code" in sent.error.cause
    ? sent.error.cause.code === "EPERM"
    : false;
}

/** 이 pid가 자기 그룹의 리더인가(우리가 detached로 띄운 자식의 모양). 확인하지 못하면 거짓 */
function isGroupLeader(pid: number): boolean {
  const ran = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  return ran.status === 0 && Number(ran.stdout.trim()) === pid;
}

function parseEntry(text: string): LedgerEntry | undefined {
  const parsed = attempt((): unknown => JSON.parse(text));
  if (!parsed.ok) return undefined;
  const value = parsed.value;
  if (typeof value !== "object" || value === null) return undefined;
  const hostPid: unknown = Reflect.get(value, "hostPid");
  const pid: unknown = Reflect.get(value, "pid");
  const bootMs: unknown = Reflect.get(value, "bootMs");
  if (typeof hostPid !== "number" || typeof pid !== "number" || typeof bootMs !== "number")
    return undefined;
  return { hostPid, pid, bootMs };
}

export function createChildLedger(options: {
  /** `l0.exec.tempDir`. 장부는 그 옆에 둔다. 없으면 OS 임시 폴더 */
  readonly dir: string | undefined;
  readonly platform: ExecPlatformProvider;
  readonly logger?: Logger;
}): ChildLedger {
  // 임시 폴더(`tempDir`)는 디스크 상한이 사용량을 재므로 그 옆(상태 디렉터리)에 둔다
  const dir = join(
    options.dir === undefined ? tmpdir() : dirname(options.dir),
    "fresnel-exec-children",
  );
  const hostPid = process.pid;
  const bootMs = bootMsNow();
  const fileOf = (host: number, pid: number): string =>
    join(dir, `${String(host)}-${String(pid)}.json`);
  const live = new Set<number>();
  const ledger: ChildLedger = {
    add(pid) {
      live.add(pid);
      const made = attempt(() => {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(fileOf(hostPid, pid), JSON.stringify({ hostPid, pid, bootMs }), {
          mode: 0o600,
        });
      });
      if (!made.ok) options.logger?.warn("exec.child_ledger_write_failed", { pid });
    },
    killAll() {
      for (const pid of live) options.platform.killProcessTree(pid);
      live.clear();
    },
    remove(pid) {
      live.delete(pid);
      attempt(() => rmSync(fileOf(hostPid, pid), { force: true }));
    },
    sweep() {
      const names = attempt(() => readdirSync(dir));
      if (!names.ok) return 0;
      let swept = 0;
      for (const name of names.value) {
        if (!name.endsWith(".json")) continue;
        const path = join(dir, name);
        const read = attempt(() => readFileSync(path, "utf8"));
        const entry = read.ok ? parseEntry(read.value) : undefined;
        if (entry === undefined) {
          attempt(() => rmSync(path, { force: true }));
          continue;
        }
        // 호스트가 살아 있으면 그 호스트의 자식이다(다른 인스턴스 또는 이 프로세스)
        if (isAlive(entry.hostPid)) continue;
        attempt(() => rmSync(path, { force: true }));
        const sameBoot = Math.abs(entry.bootMs - bootMs) <= BOOT_TOLERANCE_MS;
        if (!sameBoot || !isAlive(entry.pid) || !isGroupLeader(entry.pid)) continue;
        options.platform.killProcessTree(entry.pid);
        swept += 1;
        options.logger?.warn("exec.orphan_swept", { pid: entry.pid, hostPid: entry.hostPid });
      }
      return swept;
    },
  };
  ledgers.add(ledger);
  hookExit();
  return ledger;
}

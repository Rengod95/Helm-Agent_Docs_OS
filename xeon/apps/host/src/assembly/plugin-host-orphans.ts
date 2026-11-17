import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attempt, attemptAsync, detach, parse, parseJson, type Logger } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import type { OsRuntime } from "@fresnel/platform-os";
import { Type } from "typebox";

// L4.host-service §4.9, review.m5-drive-isolation §3.6 "고아 프로세스". 엔진이 띄운 플러그인 호스트 자식마다 기록(`plugin-hosts/<pid>.json`)을
// 상태 디렉터리에 남기고 끝나면 지운다. 엔진 시작 때 기록을 읽어, 엔진이 죽고 남은 자식을 정리한다. 조립 루트 코드(DR-14 예외 2).
// 파일과 프로세스 호출은 `attempt`로 감싸고, 실패는 주입된 Logger로 남긴다. 엔진 시작을 막지 않는다.

/** 상태 디렉터리 아래 기록 폴더 이름 */
export const PLUGIN_HOSTS_DIR = "plugin-hosts";

/** SIGTERM을 보낸 뒤 남은 자식에게 SIGKILL을 보내기까지 기다리는 시간(ms) */
export const ORPHAN_GRACE_MS = 2_000;

const RecordSchema = Type.Object({
  pid: Type.Integer(),
  label: Type.String(),
  startedAt: Type.Number(),
  enginePid: Type.Integer(),
});

/** 기록 한 줄. `enginePid`는 띄운 엔진의 pid다. 읽을 때는 `RecordSchema`로 검증한다 */
interface PluginHostRecord {
  readonly pid: number;
  readonly label: string;
  readonly startedAt: number;
  readonly enginePid: number;
}

/** 기록 폴더의 파일 입출력. 실제 구현은 `nodePluginHostFiles`다. 실패는 던져도 된다(호출자가 `attemptAsync`로 받는다) */
export interface PluginHostFiles {
  /** 폴더의 항목 이름. 폴더가 없으면 빈 목록이다 */
  list(dir: string): Promise<readonly string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

function isMissing(caught: unknown): boolean {
  return (
    typeof caught === "object" && caught !== null && "code" in caught && caught.code === "ENOENT"
  );
}

export const nodePluginHostFiles: PluginHostFiles = {
  async list(dir) {
    try {
      return await readdir(dir);
    } catch (caught) {
      if (isMissing(caught)) return [];
      throw caught;
    }
  },
  read: (path) => readFile(path, "utf8"),
  async write(path, text) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, text, { mode: 0o600 });
  },
  remove: (path) => rm(path, { force: true }),
};

function recordPathOf(dir: string, pid: number): string {
  return join(dir, `${String(pid)}.json`);
}

async function forget(files: PluginHostFiles, logger: Logger, path: string): Promise<void> {
  const removed = await attemptAsync(() => files.remove(path));
  if (!removed.ok) logger.warn("plugin_host.record_remove_failed", { path });
}

async function readRecord(
  files: PluginHostFiles,
  path: string,
): Promise<PluginHostRecord | undefined> {
  const text = await attemptAsync(() => files.read(path));
  if (!text.ok) return undefined;
  const json = parseJson(text.value);
  if (!json.ok) return undefined;
  const checked = parse(RecordSchema, json.value);
  return checked.ok ? checked.value : undefined;
}

/**
 * 명령줄이 플러그인 호스트 자식인가. `plugin-host`와 `--stdio` 인자가 모두 있어야 한다.
 * pid가 다른 프로세스로 재사용되었을 때 남의 프로세스를 죽이지 않게 하는 확인이다
 */
function isPluginHostCommand(command: string | null): boolean {
  if (command === null) return false;
  const words = command.split(/\s+/);
  return words.includes("plugin-host") && words.includes("--stdio");
}

/**
 * `ps -o command= -p <pid>`로 명령줄을 읽는다. 프로세스가 없으면 null이다.
 * 실행 포트(`OsRuntime.runSync`)를 받는다. `ps`를 실행하지 못해도 null이라 아무 프로세스도 죽이지 않는다
 */
export function psCommandOf(runSync: OsRuntime["runSync"]): (pid: number) => string | null {
  return (pid) => {
    const out = runSync(["ps", "-o", "command=", "-p", String(pid)]);
    if (!out.ok || out.value.exitCode !== 0) return null;
    const text = out.value.stdout.trim();
    return text === "" ? null : text;
  };
}

export interface PluginHostTracking {
  /** 기록 폴더(`<상태 디렉터리>/plugin-hosts`) */
  readonly dir: string;
  readonly enginePid: number;
  readonly now: () => number;
  readonly files: PluginHostFiles;
  readonly logger: Logger;
}

/**
 * 띄우기 포트를 감싼다. 띄운 자식의 기록을 남기고, 자식이 끝나면 지운다. 띄우기 결과는 그대로 돌려준다.
 * 기록을 쓰지 못해도 자식은 그대로 띄운다(정리 대상만 줄어든다)
 */
export function trackedPluginHostPort(
  port: IsolationProcessPort,
  tracking: PluginHostTracking,
): IsolationProcessPort {
  return {
    async spawn(spec: IsolationSpawnSpec) {
      const spawned = await port.spawn(spec);
      if (!spawned.ok) return spawned;
      const child: IsolatedChild = spawned.value;
      const path = recordPathOf(tracking.dir, child.pid);
      const record: PluginHostRecord = {
        pid: child.pid,
        label: spec.label,
        startedAt: tracking.now(),
        enginePid: tracking.enginePid,
      };
      const written = await attemptAsync(() =>
        tracking.files.write(path, `${JSON.stringify(record)}\n`),
      );
      if (!written.ok) tracking.logger.warn("plugin_host.record_write_failed", { pid: child.pid });
      detach(
        child.exited.then(() => forget(tracking.files, tracking.logger, path)),
        () => {
          tracking.logger.error("plugin_host.record_forget_failed", { pid: child.pid });
        },
      );
      return spawned;
    },
  };
}

export interface OrphanSweepDeps {
  /** 기록 폴더 */
  readonly dir: string;
  /** 이 엔진의 pid. 이 엔진이 쓴 기록은 건드리지 않는다 */
  readonly enginePid: number;
  readonly files: PluginHostFiles;
  /** 명령줄. 없는 프로세스면 null */
  readonly commandOf: (pid: number) => string | null;
  /** 프로세스 트리에 신호를 보낸다. 이미 끝난 트리는 오류가 아니다 */
  readonly signalTree: (pid: number, signal: "graceful" | "force") => void;
  readonly wait: (ms: number) => Promise<void>;
  readonly graceMs: number;
  readonly logger: Logger;
}

function signalOf(deps: OrphanSweepDeps, pid: number, signal: "graceful" | "force"): void {
  const sent = attempt(() => deps.signalTree(pid, signal));
  if (!sent.ok) deps.logger.warn("plugin_host.orphan_signal_failed", { pid, signal });
}

type Verdict =
  /** 살아 있는 엔진의 자식이거나 이 엔진의 기록이라 그대로 둔다 */
  | { readonly kind: "keep" }
  /** 죽었거나 pid가 다른 프로세스로 바뀌었다. 기록만 지운다 */
  | { readonly kind: "forget" }
  /** 죽은 엔진의 자식이 아직 플러그인 호스트로 살아 있다. 신호를 보낸다 */
  | { readonly kind: "stop"; readonly pid: number };

async function judgeRecord(
  deps: OrphanSweepDeps,
  path: string,
): Promise<{ readonly path: string; readonly verdict: Verdict }> {
  const record = await readRecord(deps.files, path);
  if (record === undefined) return { path, verdict: { kind: "forget" } };
  // 이 엔진의 기록이거나 아직 살아 있는 엔진의 기록이면 그 엔진의 자식이다
  if (record.enginePid === deps.enginePid || deps.commandOf(record.enginePid) !== null) {
    return { path, verdict: { kind: "keep" } };
  }
  if (!isPluginHostCommand(deps.commandOf(record.pid)))
    return { path, verdict: { kind: "forget" } };
  return { path, verdict: { kind: "stop", pid: record.pid } };
}

/**
 * 엔진 시작 때 남은 자식을 정리한다. 기록의 엔진이 살아 있으면(이 엔진 포함) 그 엔진의 자식이라 건드리지 않는다.
 * 죽은 엔진의 기록은 pid가 살아 있고 명령줄이 플러그인 호스트일 때만 SIGTERM을 보낸다. 유예 뒤에도 같은 명령이면 SIGKILL을 보낸다.
 * 기록은 살아 있는 엔진의 것만 남기고 모두 지운다. 정리 대상으로 고른 pid 목록을 돌려준다. 던지지 않는다.
 */
export async function sweepOrphanPluginHosts(deps: OrphanSweepDeps): Promise<readonly number[]> {
  const names = await attemptAsync(() => deps.files.list(deps.dir));
  if (!names.ok) {
    deps.logger.warn("plugin_host.orphan_scan_failed", {});
    return [];
  }
  const paths = names.value
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(deps.dir, name));
  const judged = await Promise.all(paths.map((path) => judgeRecord(deps, path)));
  const targets = judged.flatMap((entry) =>
    entry.verdict.kind === "stop" ? [{ pid: entry.verdict.pid, path: entry.path }] : [],
  );
  await Promise.all(
    judged.flatMap((entry) =>
      entry.verdict.kind === "forget" ? [forget(deps.files, deps.logger, entry.path)] : [],
    ),
  );

  for (const target of targets) signalOf(deps, target.pid, "graceful");
  if (targets.length > 0) {
    const waited = await attemptAsync(() => deps.wait(deps.graceMs));
    if (!waited.ok) deps.logger.warn("plugin_host.orphan_wait_failed", {});
  }
  for (const target of targets) {
    if (isPluginHostCommand(deps.commandOf(target.pid))) signalOf(deps, target.pid, "force");
    deps.logger.warn("plugin_host.orphan_swept", { pid: target.pid });
  }
  await Promise.all(targets.map((target) => forget(deps.files, deps.logger, target.path)));
  return targets.map((target) => target.pid);
}

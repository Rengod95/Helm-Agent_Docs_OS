import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
  attempt,
  err,
  ok,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import type { ProcessPlatformProvider, TreeSignal } from "../select.ts";

// L0.process.spec §4.9, L0.process.plan PR-23. 표준 입출력을 파이프로 받는 자식 프로세스 기동.
// 1. argv를 셸 없이 직접 실행한다. env는 받은 값만 쓰고 부모 env를 상속하지 않는다(허용 목록 구성은 호출자 몫).
// 2. POSIX에서 새 프로세스 그룹에 두어 신호를 트리 전체에 보낼 수 있게 한다.
// 3. `exited`는 프로세스 종료와 표준 출력 닫힘이 모두 끝난 뒤 이행한다. 프로세스가 끝나면 남은 손자를 force로 정리하고,
//    그래도 파이프가 `drainMs` 안에 닫히지 않으면 스트림을 닫고 이행한다.

export interface PipedSpawnInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  /** 자식 env 전체 */
  readonly env: Readonly<Record<string, string>>;
  /** 로그와 오류 문구에 쓰는 이름. 비밀 값을 넣지 않는다 */
  readonly label: string;
}

export interface PipedSpawnDeps {
  readonly platform: ProcessPlatformProvider;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
  readonly drainMs: number;
}

export interface PipedExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface PipedChild {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** 프로세스가 끝나고 표준 출력이 닫힌 뒤(또는 닫히지 않아 시한이 지난 뒤) 이행한다 */
  readonly exited: Promise<PipedExit>;
  /** 프로세스 트리 전체에 종료를 요청한다. 이미 끝났으면 아무 일도 없다 */
  signalTree(signal: TreeSignal): void;
}

export type PipedSpawnError = {
  readonly kind: "spawn_failed";
  readonly code: string;
  readonly message: string;
};

/** `error.code`가 문자열이면 그 값, 없으면 `UNKNOWN` */
function errnoCodeOf(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code: unknown = cause.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function spawnFailed(code: string, message: string): Result<never, PipedSpawnError> {
  return err({ kind: "spawn_failed", code, message });
}

function watchExit(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  pid: number,
  deps: PipedSpawnDeps,
): Promise<PipedExit> {
  return new Promise((resolve) => {
    let info: PipedExit = { code: null, signal: null };
    let timer: TimerHandle | undefined;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) deps.scheduler.clearTimeout(timer);
      resolve(info);
    };
    child.once("exit", (code, signal) => {
      info = { code, signal };
      deps.platform.signalTree(pid, "force");
      timer = deps.scheduler.setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle();
      }, deps.drainMs);
    });
    // 'close'를 기다리는 이유: 서버가 마지막 응답을 쓰고 바로 끝나도 그 출력을 읽게 하려는 것이다
    child.once("close", settle);
  });
}

/**
 * 자식을 띄워 파이프와 종료 약속을 돌려준다. 기동하지 못하면(`ENOENT`, `EACCES`) 거부하지 않고 `spawn_failed`와 errno 코드를 돌려준다.
 * 레지스트리 등록은 하지 않는다. 등록과 정지 순서는 호출자(`createMcpProcessPort`)가 정한다.
 */
export function spawnPiped(
  input: PipedSpawnInput,
  deps: PipedSpawnDeps,
): Promise<Result<PipedChild, PipedSpawnError>> {
  return new Promise((resolve) => {
    const spawned = attempt(() =>
      spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: { ...input.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: deps.platform.detachedSpawn,
        windowsHide: true,
        shell: false,
      }),
    );
    if (!spawned.ok) {
      resolve(spawnFailed(errnoCodeOf(spawned.error.cause), "spawn threw"));
      return;
    }
    const child = spawned.value;
    // 기동에 실패하면(ENOENT, EACCES) pid 없이 'error'가 비동기로 온다
    child.once("error", (cause) => {
      if (child.pid === undefined) {
        resolve(spawnFailed(errnoCodeOf(cause), `cannot start ${input.label}`));
        return;
      }
      deps.logger.warn("process.piped_child_error", {
        label: input.label,
        code: errnoCodeOf(cause),
      });
    });
    child.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) {
        resolve(spawnFailed("UNKNOWN", `cannot start ${input.label}`));
        return;
      }
      // 전송이 붙기 전에 서버가 stdin을 닫아도 처리되지 않은 오류로 엔진이 죽지 않게 한다. 전송은 시작할 때 자기 처리기를 단다
      child.stdin.on("error", (cause) => {
        deps.logger.debug("process.piped_stdin_error", {
          label: input.label,
          code: errnoCodeOf(cause),
        });
      });
      resolve(
        ok({
          pid,
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          exited: watchExit(child, pid, deps),
          signalTree: (signal) => {
            deps.platform.signalTree(pid, signal);
          },
        }),
      );
    });
  });
}

import { spawn } from "node:child_process";
import { attempt, err, ok, type Clock, type Result, type Scheduler } from "@xeon/contracts";

// L0.process.spec §4.4.6 기동과 분리, 감독. 서비스는 detached + unref로 띄워 띄운 CLI가 끝나도 남는다. stdio는 모두 닫는다
// (로그는 서비스가 L0.os 로그 파일에 쓴다). cwd는 호출자가 정한다(홈 디렉터리).

export interface SpawnServiceInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type SpawnServiceError = { readonly kind: "spawn_failed"; readonly code: string };

export function spawnDetachedService(
  input: SpawnServiceInput,
): Result<{ readonly pid: number }, SpawnServiceError> {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    ...(input.env === undefined ? {} : { env: { ...input.env } }),
  });
  const pid = child.pid;
  // 실행 파일이 없으면 pid가 없고 오류는 이벤트로 온다. 그 이벤트가 처리되지 않은 오류로 번지지 않게 받아 둔다
  child.once("error", () => {
    // 아래 pid 검사가 실패를 값으로 돌려준다. 늦게 오는 오류는 더 할 일이 없다
  });
  if (pid === undefined) return err({ kind: "spawn_failed", code: "ENOENT" });
  child.unref();
  return ok({ pid });
}

/** 신호 0으로 살아 있는지 본다. 권한이 없어도(EPERM) 프로세스는 있다 */
export function isProcessAlive(pid: number): boolean {
  const sent = attempt(() => process.kill(pid, 0));
  if (sent.ok) return true;
  const cause = sent.error.cause;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM";
}

export interface StopProcessDeps {
  readonly kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly alive: (pid: number) => boolean;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** 종료 확인 간격. 기본 50ms */
  readonly pollMs?: number;
}

export type StopOutcome = "already_gone" | "terminated" | "killed" | "still_alive";

function waitGone(deps: StopProcessDeps, pid: number, timeoutMs: number): Promise<boolean> {
  const pollMs = deps.pollMs ?? 50;
  const deadline = deps.clock.now() + timeoutMs;
  return new Promise<boolean>((resolve) => {
    const check = (): void => {
      if (!deps.alive(pid)) {
        resolve(true);
        return;
      }
      if (deps.clock.now() >= deadline) {
        resolve(false);
        return;
      }
      deps.scheduler.setTimeout(check, pollMs);
    };
    check();
  });
}

/**
 * 서비스 정지의 감독 절차(adr.0006 §3.7 7번): SIGTERM을 보내고 `termWaitMs` 안에 끝나기를 기다린다.
 * 남아 있으면 SIGKILL을 보내고 `killWaitMs` 기다린다. 호출자는 먼저 `host.shutdown`을 보내 협조 종료를 시도한 뒤 이 함수를 부른다.
 */
export async function stopProcess(
  deps: StopProcessDeps,
  pid: number,
  waits: { readonly termWaitMs: number; readonly killWaitMs: number },
): Promise<StopOutcome> {
  if (!deps.alive(pid)) return "already_gone";
  deps.kill(pid, "SIGTERM");
  if (await waitGone(deps, pid, waits.termWaitMs)) return "terminated";
  deps.kill(pid, "SIGKILL");
  return (await waitGone(deps, pid, waits.killWaitMs)) ? "killed" : "still_alive";
}

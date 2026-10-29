import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { attempt, err, ok, type Clock, type Result, type Scheduler } from "@xeon/contracts";
import { UNIX_SOCKET_PATH_LIMIT } from "./socket.ts";

// L0.process.spec §4.4.8 소켓 터널. 원격 사용(M3-REQ-44)은 서비스 소켓을 SSH 터널이나 사설망으로 이어 쓴다. 이 파일은 터널 프로세스를 띄우고,
// 로컬 Unix 소켓이 생겼을 때 준비된 것으로 보고, 닫을 때 프로세스를 정리한다. 전송(Transport)은 만들지 않는다: 호출자가 `localSocket`에
// 접속한다. 터널 명령은 호출자가 정한다(실제는 `ssh -L`, 시험은 `socat` 중계).

export interface TunnelSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** 터널 프로세스가 만들 로컬 Unix 소켓. 이 파일이 생기면 준비된 것이다. 호출자가 만든 비공개 디렉터리 안의 새 경로여야 한다 */
  readonly localSocket: string;
  /** 준비를 기다리는 시한. 기본 15000ms */
  readonly readyTimeoutMs?: number;
  /** 준비 확인 간격. 기본 25ms */
  readonly pollMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type TunnelError =
  | { readonly kind: "spawn_failed"; readonly code: string }
  | { readonly kind: "path_too_long"; readonly path: string; readonly limit: number }
  /** 준비되기 전에 프로세스가 끝났다. `stderr`는 마지막 부분(최대 2048바이트)이다 */
  | {
      readonly kind: "exited";
      readonly code: number | null;
      readonly signal: string | null;
      readonly stderr: string;
    }
  | { readonly kind: "timeout"; readonly stderr: string };

export interface TunnelExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface SocketTunnel {
  readonly localSocket: string;
  /** 터널 프로세스가 끝나면 이행한다(`close()`로 끝난 것도 포함) */
  readonly exited: Promise<TunnelExit>;
  /** SIGTERM을 보내고 `killAfterMs`(기본 2000) 안에 끝나지 않으면 SIGKILL을 보낸다. 로컬 소켓 파일을 지운다. 여러 번 불러도 된다 */
  close(): Promise<void>;
}

export interface TunnelDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
}

const STDERR_TAIL_BYTES = 2048;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 25;
const KILL_AFTER_MS = 2000;

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export async function openTunnel(
  spec: TunnelSpec,
  deps: TunnelDeps,
): Promise<Result<SocketTunnel, TunnelError>> {
  if (Buffer.byteLength(spec.localSocket) > UNIX_SOCKET_PATH_LIMIT) {
    return err({
      kind: "path_too_long",
      path: spec.localSocket,
      limit: UNIX_SOCKET_PATH_LIMIT,
    });
  }
  const child = spawn(spec.command, [...spec.args], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    ...(spec.env === undefined ? {} : { env: { ...spec.env } }),
  });
  const state: { stderr: string; spawnError: string | undefined; exit: TunnelExit | undefined } = {
    stderr: "",
    spawnError: undefined,
    exit: undefined,
  };
  const exitSignal = Promise.withResolvers<TunnelExit>();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    state.stderr = (state.stderr + chunk).slice(-STDERR_TAIL_BYTES);
  });
  // 실행 파일이 없으면 'error'가 오고 'exit'은 오지 않을 수 있다. 둘 다 같은 종료 신호로 모은다
  child.once("error", (caught) => {
    state.spawnError = codeOf(caught);
    state.exit ??= { code: null, signal: null };
    exitSignal.resolve(state.exit);
  });
  child.once("exit", (code, signal) => {
    state.exit ??= { code, signal };
    exitSignal.resolve(state.exit);
  });

  const closing: { promise: Promise<void> | undefined } = { promise: undefined };
  const tunnel: SocketTunnel = {
    localSocket: spec.localSocket,
    exited: exitSignal.promise,
    close() {
      closing.promise ??= (async () => {
        if (state.exit === undefined) {
          child.kill("SIGTERM");
          const killTimer = deps.scheduler.setTimeout(() => {
            if (state.exit === undefined) child.kill("SIGKILL");
          }, KILL_AFTER_MS);
          await exitSignal.promise;
          deps.scheduler.clearTimeout(killTimer);
        }
        // 지울 파일이 없는 것은 문제가 아니다(소켓이 만들어지기 전에 닫힌 경우)
        attempt(() => {
          rmSync(spec.localSocket, { force: true });
        });
      })();
      return closing.promise;
    },
  };

  const deadline = deps.clock.now() + (spec.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
  const pollMs = spec.pollMs ?? DEFAULT_POLL_MS;
  const ready = await new Promise<Result<void, TunnelError>>((resolve) => {
    const check = (): void => {
      if (state.spawnError !== undefined) {
        resolve(err({ kind: "spawn_failed", code: state.spawnError }));
        return;
      }
      if (existsSync(spec.localSocket)) {
        resolve(ok(undefined));
        return;
      }
      if (state.exit !== undefined) {
        resolve(
          err({
            kind: "exited",
            code: state.exit.code,
            signal: state.exit.signal,
            stderr: state.stderr,
          }),
        );
        return;
      }
      if (deps.clock.now() >= deadline) {
        resolve(err({ kind: "timeout", stderr: state.stderr }));
        return;
      }
      deps.scheduler.setTimeout(check, pollMs);
    };
    check();
  });
  if (!ready.ok) {
    await tunnel.close();
    return ready;
  }
  return ok(tunnel);
}

export interface SshTunnelInput {
  /** `[user@]host`. 선택지로 읽히지 않게 `-`로 시작할 수 없다 */
  readonly target: string;
  /** 서버 쪽 서비스 Unix 소켓의 절대 경로 */
  readonly remoteSocket: string;
  readonly localSocket: string;
  readonly port?: number;
  readonly identityFile?: string;
  /** 기본 "ssh" */
  readonly sshPath?: string;
}

export type SshTunnelError =
  | { readonly kind: "invalid_target"; readonly target: string }
  | {
      readonly kind: "invalid_path";
      readonly field: "remoteSocket" | "localSocket" | "identityFile";
    }
  | { readonly kind: "invalid_port"; readonly port: number };

const TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._@%-]*$/;
/** `-L`은 `:`로 필드를 나눈다. 공백과 제어 문자는 거부한다. 절대 경로만 받는다 */
const SOCKET_PATH_PATTERN = /^\/[^\s:]*$/;

function hasControlChar(text: string): boolean {
  return Array.from(text).some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
}

function isSafePath(path: string): boolean {
  return SOCKET_PATH_PATTERN.test(path) && !hasControlChar(path);
}

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

/**
 * `ssh -L <로컬 소켓>:<원격 소켓> <대상>` 명령을 만든다. 터널 명령의 값 검증이 여기 한 곳이라 호출자가 어떤 문자열을 넘겨도
 * ssh 선택지나 `-L` 필드가 바뀌지 않는다. 암호를 묻지 않도록 BatchMode를 켜므로 키나 ssh-agent가 필요하다.
 */
export function sshTunnelCommand(
  input: SshTunnelInput,
): Result<{ readonly command: string; readonly args: readonly string[] }, SshTunnelError> {
  if (!TARGET_PATTERN.test(input.target))
    return err({ kind: "invalid_target", target: input.target });
  if (!isSafePath(input.remoteSocket)) {
    return err({ kind: "invalid_path", field: "remoteSocket" });
  }
  if (!isSafePath(input.localSocket)) {
    return err({ kind: "invalid_path", field: "localSocket" });
  }
  if (input.identityFile !== undefined && !isSafePath(input.identityFile)) {
    return err({ kind: "invalid_path", field: "identityFile" });
  }
  if (input.port !== undefined && !isPort(input.port)) {
    return err({ kind: "invalid_port", port: input.port });
  }
  return ok({
    command: input.sshPath ?? "ssh",
    args: [
      "-N",
      "-T",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      ...(input.port === undefined ? [] : ["-p", String(input.port)]),
      ...(input.identityFile === undefined ? [] : ["-i", input.identityFile]),
      "-L",
      `${input.localSocket}:${input.remoteSocket}`,
      "--",
      input.target,
    ],
  });
}

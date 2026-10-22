import { spawn } from "node:child_process";
import { attempt, err, ok, type Logger, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  type BackgroundExecHandle,
  type CancelScope,
  type ShellExecOptions,
} from "@xeon/contracts/services";
import type { ExecPlatformProvider } from "./provider.ts";
import { StreamDecoder } from "./upstream/env/index.ts";

// L0.exec.spec §3.9, L0.exec.plan EX-20. 종료를 기다리지 않는 실행. 포크 exec를 쓰지 않고 직접 spawn한다.
// 실행 형태와 env 구성은 service.ts가 exec와 같은 규칙으로 정해 넘긴다. 이 파일은 spawn, 출력 전달, 정지, 종료 감시만 맡는다.

export interface BackgroundSpawn {
  readonly program: string;
  readonly args: readonly string[];
  /** 셸이 명령을 stdin으로만 받는 구형 WSL bash.exe용. 있으면 쓰고 닫는다 */
  readonly stdinCommand: string | undefined;
  readonly cwd: string;
  /** 허용 목록으로 만든 완성된 env. 부모 env를 더 물려받지 않는다 */
  readonly env: Readonly<Record<string, string>>;
  readonly onOutput: ShellExecOptions["onOutput"];
  readonly platform: ExecPlatformProvider;
  readonly context: CancelScope;
  readonly logger: Logger | undefined;
}

type BackgroundExit = { readonly code: number | null; readonly signal: string | null };

function errnoCode(cause: unknown): string {
  const code: unknown =
    typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
  return typeof code === "string" ? code : "UNKNOWN";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "non_error_thrown";
}

/**
 * 프로세스를 띄우고 핸들을 돌려준다. spawn이 성공했을 때(`spawn` 이벤트) 이행한다.
 * `onExit`은 프로세스가 끝날 때 한 번 불린다(서비스가 추적 목록에서 지운다).
 */
export function spawnBackground(
  input: BackgroundSpawn,
  onExit: () => void,
): Promise<Result<BackgroundExecHandle, ExecutionError>> {
  const { platform, context, logger } = input;
  return new Promise((resolve) => {
    const spawned = attempt(() =>
      spawn(input.program, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        stdio: [input.stdinCommand === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        detached: platform.detachedSpawn,
        windowsHide: true,
        shell: false,
      }),
    );
    if (!spawned.ok) {
      resolve(
        err(
          new ExecutionError(
            "spawn_error",
            `Failed to start ${input.program}: ${describe(spawned.error.cause)}`,
          ),
        ),
      );
      return;
    }
    const child = spawned.value;
    const exited = Promise.withResolvers<BackgroundExit>();
    const state = { stopRequested: false, exited: false, outputOff: false };

    function signalTree(mode: "graceful" | "force"): void {
      const pid = child.pid;
      // 이미 끝났으면 보낼 곳이 없다(pid 재사용 위험을 피한다)
      if (pid === undefined || state.exited) return;
      state.stopRequested = true;
      if (mode === "graceful") platform.terminateProcessTree(pid);
      else platform.killProcessTree(pid);
    }

    function stop(mode: "graceful" | "force"): Promise<void> {
      signalTree(mode);
      return Promise.resolve();
    }

    const onAbort = (): void => {
      signalTree("force");
    };

    const forward = (stream: "stdout" | "stderr", decoder: StreamDecoder) => (chunk: unknown) => {
      const callback = input.onOutput;
      if (callback === undefined || state.outputOff || !(chunk instanceof Uint8Array)) return;
      const text = decoder.decode(chunk);
      if (text === "") return;
      const delivered = attempt(() => callback(text, context, { stream }));
      if (!delivered.ok) {
        // 출력 콜백의 예외가 실행 중인 프로세스를 죽이지는 않는다. 전달만 멈추고 원인을 남긴다
        state.outputOff = true;
        logger?.warn("exec.background_output_failed", {
          pid: child.pid ?? 0,
          error: describe(delivered.error.cause),
        });
      }
    };
    child.stdout?.on("data", forward("stdout", new StreamDecoder()));
    child.stderr?.on("data", forward("stderr", new StreamDecoder()));
    child.stdin?.on("error", (cause) => {
      logger?.debug("exec.background_stdin_error", { code: errnoCode(cause) });
    });

    child.once("error", (cause) => {
      if (child.pid === undefined) {
        resolve(
          err(
            new ExecutionError(
              "spawn_error",
              `Failed to start ${input.program}: ${errnoCode(cause)}`,
              cause,
            ),
          ),
        );
        return;
      }
      logger?.warn("exec.background_child_error", { pid: child.pid, code: errnoCode(cause) });
    });

    child.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) return;
      if (input.stdinCommand !== undefined) child.stdin?.end(input.stdinCommand);
      context.abortSignal?.addEventListener("abort", onAbort, { once: true });
      child.once("exit", (code, signal) => {
        state.exited = true;
        context.abortSignal?.removeEventListener("abort", onAbort);
        // 정지를 요청받은 트리에 신호를 무시한 손자가 남았을 수 있다. 같은 그룹을 한 번 더 정리한다
        if (state.stopRequested) platform.killProcessTree(pid);
        onExit();
        exited.resolve({ code, signal });
      });
      resolve(ok({ pid, stop, exited: exited.promise }));
      if (context.abortSignal?.aborted === true) onAbort();
    });
  });
}

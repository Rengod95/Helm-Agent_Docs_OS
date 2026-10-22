import { spawn } from "node:child_process";
import { attempt, type Logger, type Scheduler, type TimerHandle } from "@xeon/contracts";
import type { HookRawRun, HookRunSpec } from "@xeon/contracts/extensions";
import type { ProcessPlatformProvider } from "../select.ts";

// L0.process.spec §4.8 `run`, L0.process.plan PR-21. 외부 훅 실행(ProcessPort.run).
// 1. argv[0]을 셸 없이 직접 실행한다. cwd·env는 받은 값만 쓰고 부모 env를 상속하지 않는다(허용 목록 구성은 호출자 몫).
// 2. stdin 문자열을 쓰고 닫는다. stdout·stderr는 각각 상한 글자 수에서 자르고, stdout을 잘랐으면 stdoutTruncated.
// 3. signal(호출자의 시간 예산) 또는 종료 협조가 중단되면 트리에 graceful을 보내고 graceMs 뒤 force. 결과는 timedOut.
// 4. 기동하지 못하면(ENOENT, EACCES) reject하지 않고 exitCode null + spawnError.
// 5. 레지스트리에 등록하지 않는다. 짧은 실행이므로 signal과 종료 협조로 정리한다.

export interface HookRunnerDeps {
  /** 프로세스 트리 종료 수단. 지원하지 않는 OS면 undefined이고 모든 실행이 spawnError `unsupported_platform`이다 */
  readonly platform: ProcessPlatformProvider | undefined;
  readonly scheduler: Scheduler;
  /** graceful 신호 뒤 force까지 기다리는 시간(l0.process.shutdown.timeoutMs) */
  readonly graceMs: number;
  /** 종료 협조가 시작되면 중단되는 신호. 실행 중인 훅을 3번 규칙대로 멈춘다 */
  readonly shutdownSignal: AbortSignal;
  readonly logger: Logger;
}

export interface HookRunner {
  run(spec: HookRunSpec): Promise<HookRawRun>;
  /** 실행 중인 훅이 모두 끝나기를 기다린다. 종료 협조 참여자가 부른다 */
  drain(): Promise<void>;
}

function spawnFailure(code: string): HookRawRun {
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stdoutTruncated: false,
    stderr: "",
    timedOut: false,
    spawnError: code,
  };
}

function errnoCode(cause: unknown): string {
  const code: unknown =
    typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
  return typeof code === "string" ? code : "UNKNOWN";
}

/** 글자 수 상한이 있는 출력 수집기. 상한을 넘은 뒤에도 읽어서 버린다(자식이 파이프에 막히지 않게) */
function limitedCollector(maxChars: number): {
  push(chunk: unknown): void;
  finish(): { readonly text: string; readonly truncated: boolean };
} {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const state = { text: "", truncated: false };
  return {
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) return;
      const piece = decoder.decode(chunk, { stream: true });
      const room = maxChars - state.text.length;
      if (piece.length <= room) {
        state.text += piece;
        return;
      }
      state.text += piece.slice(0, Math.max(room, 0));
      state.truncated = true;
    },
    finish() {
      const rest = decoder.decode();
      const room = maxChars - state.text.length;
      if (rest.length > 0) {
        if (rest.length <= room) state.text += rest;
        else state.truncated = true;
      }
      return { text: state.text, truncated: state.truncated };
    },
  };
}

export function createHookRunner(deps: HookRunnerDeps): HookRunner {
  const active = new Set<Promise<HookRawRun>>();

  function execute(spec: HookRunSpec): Promise<HookRawRun> {
    return new Promise<HookRawRun>((resolve) => {
      const [command, ...args] = spec.argv;
      if (command === undefined) {
        resolve(spawnFailure("EINVAL"));
        return;
      }
      const platform = deps.platform;
      if (platform === undefined) {
        resolve(spawnFailure("unsupported_platform"));
        return;
      }
      const signal = AbortSignal.any([spec.signal, deps.shutdownSignal]);
      if (signal.aborted) {
        // 시작 전에 이미 예산이 끝났다. 띄우지 않는다
        resolve({
          exitCode: null,
          signal: null,
          stdout: "",
          stdoutTruncated: false,
          stderr: "",
          timedOut: true,
        });
        return;
      }
      // argv의 NUL 바이트나 잘못된 cwd 형식처럼 런타임이 동기로 거부하는 인자도 4번 규칙대로 spawnError로 돌려준다
      const spawned = attempt(() =>
        spawn(command, args, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: platform.detachedSpawn,
          windowsHide: true,
          shell: false,
        }),
      );
      if (!spawned.ok) {
        deps.logger.debug("hook.spawn_threw", { code: errnoCode(spawned.error.cause) });
        resolve(spawnFailure(errnoCode(spawned.error.cause)));
        return;
      }
      const child = spawned.value;
      const stdout = limitedCollector(spec.maxStdoutChars);
      const stderr = limitedCollector(spec.maxStderrChars);
      const run: { aborted: boolean; settled: boolean; killTimer: TimerHandle | undefined } = {
        aborted: false,
        settled: false,
        killTimer: undefined,
      };

      function onAbort(): void {
        run.aborted = true;
        const pid = child.pid;
        if (pid === undefined) return;
        platform?.signalTree(pid, "graceful");
        run.killTimer = deps.scheduler.setTimeout(() => {
          platform?.signalTree(pid, "force");
        }, deps.graceMs);
      }

      function settle(result: HookRawRun): void {
        if (run.settled) return;
        run.settled = true;
        signal.removeEventListener("abort", onAbort);
        if (run.killTimer !== undefined) deps.scheduler.clearTimeout(run.killTimer);
        resolve(result);
      }

      child.once("error", (cause) => {
        if (child.pid === undefined) {
          settle(spawnFailure(errnoCode(cause)));
          return;
        }
        deps.logger.warn("hook.child_error", { pid: child.pid, code: errnoCode(cause) });
      });
      child.stdout.on("data", (chunk: unknown) => {
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: unknown) => {
        stderr.push(chunk);
      });
      child.stdin.on("error", (cause) => {
        // 자식이 stdin을 읽기 전에 끝났다(EPIPE). 결과는 종료 코드와 출력으로 드러난다
        deps.logger.debug("hook.stdin_error", { code: errnoCode(cause) });
      });
      child.once("close", (code, exitSignal) => {
        const pid = child.pid;
        // 중단된 실행은 자식이 신호를 무시하고 손자를 남겼을 수 있다. 트리에 force를 한 번 더 보낸다
        if (run.aborted && pid !== undefined) platform.signalTree(pid, "force");
        const out = stdout.finish();
        const errOut = stderr.finish();
        settle({
          exitCode: code,
          signal: exitSignal,
          stdout: out.text,
          stdoutTruncated: out.truncated,
          stderr: errOut.text,
          timedOut: run.aborted,
        });
      });
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdin.end(spec.stdin);
    });
  }

  return {
    run(spec) {
      const tracked: Promise<HookRawRun> = execute(spec).finally(() => {
        active.delete(tracked);
      });
      active.add(tracked);
      return tracked;
    },
    async drain() {
      await Promise.all(Array.from(active));
    },
  };
}

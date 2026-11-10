// 웹 게이트웨이 자식 프로세스의 기동. 프로세스는 L0 `spawnPiped`로 띄운다(DR-07: `Bun.spawn`과 `node:child_process`는 L0 소유 패키지만 쓴다).
// 실행 파일은 `resolveGatewayCommand`로 찾는다. 이 파일은 게이트웨이 코드를 import하지 않는다.
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { err, ok, type Logger, type Result, type Scheduler } from "@fresnel/contracts";
import {
  detectProcessPlatform,
  spawnPiped,
  type PipedChild,
  type PipedSpawnDeps,
  type PipedSpawnError,
  type PipedSpawnInput,
} from "@fresnel/platform-process";
import { childEnvOf, resolveGatewayCommand, uiArgsOf, type GatewayEnv } from "./gateway-command.ts";

export interface GatewayLaunchSpec {
  /** 게이트웨이 인자(`--socket`부터). 실행 파일과 `--ui`는 런처가 붙인다 */
  readonly args: readonly string[];
}

/** 자식이 끝난 값. 신호로 끝났으면 `code`는 null이다 */
export interface GatewayExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** 띄운 자식 하나. 표준 출력과 표준 오류는 줄 단위로 읽는다 */
export interface GatewayChild {
  readonly pid: number;
  /** 표준 입력에 한 줄을 쓴다. 줄바꿈은 붙이지 않아도 된다 */
  write(line: string): void;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  /** 프로세스가 끝나고 표준 출력이 닫힌 뒤 이행한다 */
  readonly exited: Promise<GatewayExit>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type GatewayLaunchError =
  /** 게이트웨이 실행 파일을 찾지 못했다(환경 문제) */
  | { readonly kind: "binary-missing"; readonly message: string }
  /** 찾았지만 띄우지 못했다(환경 문제) */
  | { readonly kind: "spawn-failed"; readonly message: string };

export type GatewayLauncher = (
  spec: GatewayLaunchSpec,
) => Promise<Result<GatewayChild, GatewayLaunchError>>;

/** `spawnPiped`와 같은 모양. 시험이 가짜 자식을 넣는다 */
export type PipedSpawnFn = (
  input: PipedSpawnInput,
  deps: PipedSpawnDeps,
) => Promise<Result<PipedChild, PipedSpawnError>>;

export interface BunGatewayLauncherOptions {
  readonly env: GatewayEnv;
  readonly execPath: string;
  /** 호스트 서비스 소스 폴더(개발 트리 찾기의 기준) */
  readonly serviceDir: string;
  readonly exists: (file: string) => boolean;
  /** 자식의 홈 폴더(작업 폴더이자 `HOME`) */
  readonly home: string;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
  readonly drainMs: number;
  /** 기본은 L0 `spawnPiped` */
  readonly spawn?: PipedSpawnFn;
}

/** 줄 읽기 자리는 자식이 뜰 때 만든다. 읽는 쪽이 늦게 불러도 그사이 온 줄을 잃지 않게, 반복자는 하나만 만든다 */
function linesOf(stream: Readable): AsyncIterable<string> {
  const lines = createInterface({ input: stream, crlfDelay: Infinity })[Symbol.asyncIterator]();
  return { [Symbol.asyncIterator]: () => lines };
}

function childOf(piped: PipedChild): GatewayChild {
  return {
    pid: piped.pid,
    write: (line) => {
      piped.stdin.write(`${line}\n`);
    },
    stdout: linesOf(piped.stdout),
    stderr: linesOf(piped.stderr),
    exited: piped.exited,
    kill: (signal) => {
      piped.signalTree(signal === "SIGKILL" ? "force" : "graceful");
    },
  };
}

/** 게이트웨이를 `bun run`(개발 트리)이나 컴파일된 `fresnel-web`으로 띄우는 기본 런처 */
export function bunGatewayLauncher(options: BunGatewayLauncherOptions): GatewayLauncher {
  const spawn = options.spawn ?? spawnPiped;
  return async (spec) => {
    const resolved = resolveGatewayCommand(
      options.env,
      options.execPath,
      options.serviceDir,
      options.exists,
    );
    if (!resolved.ok) return err({ kind: "binary-missing", message: resolved.error.message });
    const [file, ...head] = resolved.value.command;
    const platform = detectProcessPlatform(options.logger);
    if (!platform.ok) {
      return err({ kind: "spawn-failed", message: "this platform cannot run the web gateway" });
    }
    const spawned = await spawn(
      {
        command: file,
        args: [...head, ...spec.args, ...uiArgsOf(options.env, options.execPath, options.exists)],
        cwd: options.home,
        env: childEnvOf(options.env, options.home),
        label: "fresnel-web",
      },
      {
        platform: platform.value,
        scheduler: options.scheduler,
        logger: options.logger,
        drainMs: options.drainMs,
      },
    );
    if (!spawned.ok) {
      return err({
        kind: "spawn-failed",
        message: `the web gateway could not be started (${spawned.error.code})`,
      });
    }
    return ok(childOf(spawned.value));
  };
}

import { err, ok, type Result } from "@xeon/contracts";

// 자식 프로세스 실행은 DR-07 표의 Bun.spawn 소유 패키지 platform-os 행을 따른다. 이 파일이 그 호출 위치다.

export interface CommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  /** `captureStderr`를 준 실행만 있다. 끝쪽 STDERR_TAIL_BYTES 바이트다 */
  readonly stderr?: string;
}

type CommandError =
  /** 실행 파일을 시작하지 못했다(없음, 권한 없음 등) */
  | { readonly kind: "spawn_failed"; readonly code: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" };

interface RunCommandOptions {
  readonly signal: AbortSignal;
  /** 기본 5000 */
  readonly timeoutMs?: number;
  /** 참이면 stderr의 끝쪽을 `CommandOutput.stderr`로 돌려준다. 기본은 버린다 */
  readonly captureStderr?: boolean;
}

/** 셸을 거치지 않고 argv로 실행한다. 테스트는 이 함수를 주입해 실행 횟수를 센다 */
export type RunCommand = (
  argv: readonly string[],
  opts: RunCommandOptions,
) => Promise<Result<CommandOutput, CommandError>>;

/** 동기 실행. store 임대 판정 같은 동기 경로에서 쓴다(processStartFingerprint) */
export type RunCommandSync = (argv: readonly string[]) => Result<CommandOutput, CommandError>;

const DEFAULT_TIMEOUT_MS = 5000;
/** captureStderr에서 남기는 stderr 상한(바이트). 넘치면 앞쪽을 버리고 끝쪽만 남긴다 */
const STDERR_TAIL_BYTES = 8 * 1024;

/** 스트림을 끝까지 읽되 마지막 `limit` 바이트만 들고 있는다. 긴 출력이 메모리를 키우지 않는다 */
async function readTail(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  let tail = new Uint8Array(0);
  await stream.pipeTo(
    new WritableStream<Uint8Array>({
      write(chunk) {
        const joined = new Uint8Array(tail.byteLength + chunk.byteLength);
        joined.set(tail);
        joined.set(chunk, tail.byteLength);
        tail = joined.byteLength > limit ? joined.slice(joined.byteLength - limit) : joined;
      },
    }),
  );
  return new TextDecoder().decode(tail);
}

/** 비밀이 든 부모 환경을 자식에게 넘기지 않는다. PATH와 로케일만 준다 */
function childEnv(): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", LC_ALL: "C" };
}

/** await 뒤에 신호를 다시 읽는다. 좁혀진 타입 때문에 직접 읽으면 린트가 항상 거짓이라고 본다 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** 시간 초과나 신호로 끝난 동기 실행은 종료 코드가 null이다 */
function exitCodeOf(code: number | null | undefined): number | undefined {
  return typeof code === "number" ? code : undefined;
}

function spawnCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function createRunCommand(): RunCommand {
  return async (argv, opts) => {
    if (isAborted(opts.signal)) return err({ kind: "cancelled" });
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const captured = opts.captureStderr === true;
    try {
      const proc = Bun.spawn([...argv], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: captured ? "pipe" : "ignore",
        env: childEnv(),
        signal: opts.signal,
        timeout: timeoutMs,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        captured && proc.stderr instanceof ReadableStream
          ? readTail(proc.stderr, STDERR_TAIL_BYTES)
          : undefined,
        proc.exited,
      ]);
      if (isAborted(opts.signal)) return err({ kind: "cancelled" });
      // 시간 초과로 죽은 자식은 신호(SIGTERM)로 끝난다. 정상 종료는 신호가 null이다
      if (proc.signalCode !== null) return err({ kind: "timeout" });
      return ok(stderr === undefined ? { exitCode, stdout } : { exitCode, stdout, stderr });
    } catch (caught) {
      if (isAborted(opts.signal)) return err({ kind: "cancelled" });
      return err({ kind: "spawn_failed", code: spawnCode(caught) });
    }
  };
}

export function createRunCommandSync(): RunCommandSync {
  return (argv) => {
    try {
      const done = Bun.spawnSync([...argv], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env: childEnv(),
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const exitCode = exitCodeOf(done.exitCode);
      if (exitCode === undefined) return err({ kind: "timeout" });
      return ok({ exitCode, stdout: done.stdout.toString() });
    } catch (caught) {
      return err({ kind: "spawn_failed", code: spawnCode(caught) });
    }
  };
}

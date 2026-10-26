import { err, ok, type Result } from "@xeon/contracts";
import { errorCode } from "../errors.ts";

// L0.secrets.spec §4.6. 외부 바이너리 실행기. 호출 쪽(sops 제공자, macOS 키 저장, 파일 만들기)이 같은 주입 지점을 쓴다.

export interface RunRequest {
  readonly argv: readonly string[];
  /** 자식 env 전체. 부모 env를 물려받지 않는다 */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** 자식 stdin으로 보낼 바이트. 없으면 stdin을 닫는다. 호출자가 끝난 뒤 0으로 덮는다 */
  readonly stdin?: Uint8Array;
  /** 서비스가 닫히면 중단된다. 실행 중인 자식 프로세스를 죽인다 */
  readonly signal: AbortSignal;
}

export interface RunOutput {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

type RunFailure =
  | { readonly kind: "spawn_failed"; readonly code: string }
  | { readonly kind: "cancelled" };

/** 주입 지점. 테스트는 가짜 실행기나 가짜 sops 실행 파일을 쓴다 */
export type ProcessRunner = (request: RunRequest) => Promise<Result<RunOutput, RunFailure>>;

export const bunRunner: ProcessRunner = async (request) => {
  // 신호는 await 사이에 중단될 수 있어 읽을 때마다 현재 값을 본다
  const cancelled = (): boolean => request.signal.aborted;
  if (cancelled()) return err({ kind: "cancelled" });
  try {
    const proc = Bun.spawn([...request.argv], {
      env: { ...request.env },
      stdin: request.stdin ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: request.timeoutMs,
      signal: request.signal,
    });
    const stdoutPending = new Response(proc.stdout).arrayBuffer();
    const stderrPending = new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const stdout = new Uint8Array(await stdoutPending);
    const stderr = await stderrPending;
    // 중단 신호로 죽은 호출은 출력이 잘렸을 수 있어 결과로 쓰지 않는다
    if (cancelled()) return err({ kind: "cancelled" });
    return ok({ exitCode, stdout, stderr });
  } catch (error: unknown) {
    if (cancelled()) return err({ kind: "cancelled" });
    return err({ kind: "spawn_failed", code: errorCode(error) });
  }
};

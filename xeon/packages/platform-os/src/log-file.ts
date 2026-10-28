import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { attempt } from "@xeon/contracts";
import type { LogSink } from "./logger.ts";
import { PRODUCT } from "./product.ts";

// L0.os.spec §3.5 로그 회전, M3-REQ-52. 파일 sink 하나가 크기 상한에서 회전한다.
// 기본값 [결정: 오케스트레이터 기본값]: 파일당 10 MiB, 보관 5개(현재 파일 + 회전본 4개), 합계 상한 50 MiB.

export const DEFAULT_LOG_MAX_BYTES: number = 10 * 1024 * 1024;
export const DEFAULT_LOG_MAX_FILES: number = 5;

export interface RotatingFileSinkOptions {
  /** 로그 디렉터리. 없으면 0700으로 만든다(보통 `OsDirs.state/logs`) */
  readonly dir: string;
  /** 기본 `<제품 이름>.log` */
  readonly fileName?: string;
  /** 파일 한 개의 상한(바이트). 기본 10 MiB */
  readonly maxBytes?: number;
  /** 현재 파일을 포함한 보관 개수. 기본 5, 최소 1 */
  readonly maxFiles?: number;
  /** 쓰기·회전 실패 알림. sink는 던지지 않고 줄을 버린다 */
  readonly onError?: (code: string) => void;
}

function errnoOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/**
 * 한 줄씩 덧붙이는 동기 파일 sink. 덧붙이면 상한을 넘을 때 `<이름>.<n>`을 한 칸씩 밀고(가장 오래된 것은 지운다)
 * 현재 파일을 `<이름>.1`로 옮긴 뒤 새 파일에 쓴다. 파일은 0600이다.
 */
export function createRotatingFileSink(opts: RotatingFileSinkOptions): LogSink {
  const fileName = opts.fileName ?? `${PRODUCT.name}.log`;
  const maxBytes = opts.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const maxFiles = Math.max(1, opts.maxFiles ?? DEFAULT_LOG_MAX_FILES);
  const current = join(opts.dir, fileName);
  const report = (caught: unknown): void => opts.onError?.(errnoOf(caught));

  const made = attempt(() => mkdirSync(opts.dir, { recursive: true, mode: 0o700 }));
  if (!made.ok) report(made.error.cause);
  const sized = attempt(() => statSync(current).size);
  let size = sized.ok ? sized.value : 0;

  function rotate(): void {
    const steps: (() => void)[] = [
      () => rmSync(`${current}.${String(maxFiles - 1)}`, { force: true }),
    ];
    for (let n = maxFiles - 2; n >= 1; n -= 1) {
      steps.push(() => renameSync(`${current}.${String(n)}`, `${current}.${String(n + 1)}`));
    }
    steps.push(() =>
      maxFiles === 1 ? rmSync(current, { force: true }) : renameSync(current, `${current}.1`),
    );
    for (const step of steps) {
      const done = attempt(step);
      // 없는 회전본은 건너뛴다. 다른 실패는 알리고 계속한다
      if (!done.ok && errnoOf(done.error.cause) !== "ENOENT") report(done.error.cause);
    }
    size = 0;
  }

  return (line) => {
    const text = `${line}\n`;
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) rotate();
    const written = attempt(() => appendFileSync(current, text, { mode: 0o600 }));
    if (written.ok) size += bytes;
    else report(written.error.cause);
  };
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import {
  attemptAsync,
  err,
  ok,
  repeatAsync,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
} from "@xeon/contracts";
import type { FlockPrimitive } from "./flock.ts";

// L0.os.spec §3.11. 프로세스 사이 파일 잠금. `trust.json`처럼 둘 이상의 호스트가 읽고 고쳐 쓰는 사용자 파일의 덮어쓰기를 막는다.
// 1. 잠금 파일은 `<path>.lock`이다. 대상 파일을 직접 잠그지 않으므로 교체(rename)해도 잠금이 유지된다.
// 2. OS 잠금(flock)은 프로세스가 죽으면 풀린다. 같은 프로세스 안에서는 표를 먼저 본다(독립 fd의 flock도 서로 막지만 기다림 없이 판정한다).
// 3. 기다림은 `pollMs` 간격 폴링이다. `timeoutMs`가 지나면 `timeout`, 중단 신호가 오면 `cancelled`를 값으로 돌려준다.

export const DEFAULT_FILE_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_FILE_LOCK_POLL_MS = 25;

/** `cross_process`는 다른 프로세스와도 배타다. `process`는 같은 프로세스 안에서만 배타다(OS 잠금을 쓸 수 없는 환경) */
export type FileLockScope = "cross_process" | "process";

export interface FileLockOptions {
  /** 잠금을 얻기까지 기다리는 시간(ms). 기본 5000 */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type FileLockError =
  | { readonly kind: "timeout"; readonly path: string; readonly waitedMs: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "io"; readonly path: string; readonly code: string };

export interface FileLock {
  readonly scope: FileLockScope;
  /**
   * `path`의 잠금을 쥔 동안 `fn`을 돌린다. `fn`이 끝나거나 던지면 잠금을 놓는다(던진 오류는 그대로 거부된다).
   * 잠금 파일이 들어갈 디렉터리는 있어야 한다.
   */
  withLock<T>(
    path: string,
    fn: () => Promise<T>,
    options?: FileLockOptions,
  ): Promise<Result<T, FileLockError>>;
  /**
   * 잠금을 쥔 채 읽기-수정-쓰기를 한 번 한다. 파일이 없으면 `fn`에 null을 준다.
   * 쓰기는 같은 디렉터리의 임시 파일(0600)에 쓴 뒤 이름을 바꾼다. 디렉터리가 없으면 0700으로 만든다.
   * `fn`이 던지면 파일은 그대로이고 오류가 거부로 전해진다.
   */
  updateText(
    path: string,
    fn: (current: string | null) => string,
    options?: FileLockOptions,
  ): Promise<Result<void, FileLockError>>;
}

export interface FileLockDeps {
  /** 없으면 프로세스 안 직렬화만 한다(`scope: "process"`) */
  readonly primitive: FlockPrimitive | undefined;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly pollMs?: number;
}

function errnoOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function createFileLock(deps: FileLockDeps): FileLock {
  const pollMs = deps.pollMs ?? DEFAULT_FILE_LOCK_POLL_MS;
  /** 이 프로세스가 쥐고 있는 잠금 키 */
  const held = new Set<string>();
  let tmpCounter = 0;

  function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
      const timer = deps.scheduler.setTimeout(() => {
        signal?.removeEventListener("abort", wake);
        resolve();
      }, ms);
      const wake = (): void => {
        deps.scheduler.clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", wake, { once: true });
    });
  }

  type Acquired = Result<{ release(): void }, FileLockError>;

  async function acquire(path: string, options: FileLockOptions | undefined): Promise<Acquired> {
    const key = resolvePath(path);
    const lockPath = `${key}.lock`;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_FILE_LOCK_TIMEOUT_MS;
    const signal = options?.signal;
    const startedAt = deps.clock.now();
    // 잠금을 얻거나 시한이 지날 때까지 차례로 다시 시도한다. 앞 시도가 끝나야 다음을 시작한다
    return repeatAsync<Acquired>(async () => {
      if (signal?.aborted === true) return { value: err({ kind: "cancelled" }) };
      if (!held.has(key)) {
        if (deps.primitive === undefined) {
          held.add(key);
          return {
            value: ok({
              release: () => {
                held.delete(key);
              },
            }),
          };
        }
        // 이 프로세스 표에 넣은 뒤 OS 잠금을 시도한다. 실패하면 표에서 뺀다
        held.add(key);
        const locked = deps.primitive.tryLock(lockPath);
        if (locked.ok) {
          let released = false;
          return {
            value: ok({
              release: () => {
                if (released) return;
                released = true;
                locked.value.release();
                held.delete(key);
              },
            }),
          };
        }
        held.delete(key);
        if (locked.error.kind === "io") {
          return { value: err({ kind: "io", path: lockPath, code: locked.error.code }) };
        }
      }
      const waitedMs = deps.clock.now() - startedAt;
      if (waitedMs >= timeoutMs) return { value: err({ kind: "timeout", path: key, waitedMs }) };
      await sleep(Math.min(pollMs, timeoutMs - waitedMs), signal);
      return undefined;
    });
  }

  async function withLock<T>(
    path: string,
    fn: () => Promise<T>,
    options?: FileLockOptions,
  ): Promise<Result<T, FileLockError>> {
    const lock = await acquire(path, options);
    if (!lock.ok) return lock;
    try {
      return ok(await fn());
    } finally {
      lock.value.release();
    }
  }

  async function updateText(
    path: string,
    fn: (current: string | null) => string,
    options?: FileLockOptions,
  ): Promise<Result<void, FileLockError>> {
    const target = resolvePath(path);
    const dir = await attemptAsync(() => mkdir(dirname(target), { recursive: true, mode: 0o700 }));
    if (!dir.ok) {
      return err({ kind: "io", path: target, code: errnoOf(dir.error.cause) });
    }
    const done = await withLock<Result<void, FileLockError>>(
      target,
      async () => {
        const current = await attemptAsync(() => readFile(target, "utf8"));
        let text: string | null;
        if (current.ok) text = current.value;
        else if (errnoOf(current.error.cause) === "ENOENT") text = null;
        else return err({ kind: "io", path: target, code: errnoOf(current.error.cause) });
        const next = fn(text);
        tmpCounter += 1;
        const tmp = `${target}.${String(process.pid)}.${String(tmpCounter)}.tmp`;
        const replaced = await attemptAsync(async () => {
          await writeFile(tmp, next, { mode: 0o600 });
          await rename(tmp, target);
        });
        if (!replaced.ok) {
          deps.logger.warn("os.file_lock.update_failed", {
            path: target,
            code: errnoOf(replaced.error.cause),
          });
          return err({ kind: "io", path: target, code: errnoOf(replaced.error.cause) });
        }
        return ok(undefined);
      },
      options,
    );
    return done.ok ? done.value : done;
  }

  return {
    scope: deps.primitive === undefined ? "process" : "cross_process",
    withLock,
    updateText,
  };
}

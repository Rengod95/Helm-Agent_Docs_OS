import type { Logger, LogFields } from "@xeon/contracts";
import { Bug } from "@xeon/contracts";
import type { LocalId, LocalIdFactory, LocalIdPrefix } from "@xeon/contracts/conversation";
import type { BackgroundStopper } from "@xeon/contracts/services";

interface LogRecord {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields;
}

export interface MemoryLogger extends Logger {
  readonly records: readonly LogRecord[];
}

export function memoryLogger(): MemoryLogger {
  const records: LogRecord[] = [];
  function make(base: LogFields): Logger {
    const write =
      (level: LogRecord["level"]) =>
      (event: string, fields?: LogFields): void => {
        records.push({ level, event, fields: { ...base, ...fields } });
      };
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      child: (fields) => make({ ...base, ...fields }),
    };
  }
  const root = make({});
  return { ...root, records };
}

/** 호출 순번으로 만든 지역 ID 발급기 */
export function sequentialLocalIds(): LocalIdFactory {
  let counter = 0;
  return {
    next<P extends LocalIdPrefix>(prefix: P): LocalId<P> {
      counter += 1;
      return `${prefix}_${String(counter).padStart(26, "0")}`;
    },
  };
}

/** exit 대역. 부르면 코드를 기록하고 Bug를 던진다(타입이 never라서 돌아올 수 없다) */
export interface ExitRecorder {
  readonly codes: readonly number[];
  exit(code: number): never;
}

export function exitRecorder(): ExitRecorder {
  const codes: number[] = [];
  return {
    codes,
    exit(code) {
      codes.push(code);
      throw new Bug(`exit(${String(code)})`);
    },
  };
}

/** 거부된 Promise의 사유를 값으로 받는다. 이행하면 undefined */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (caught) {
    return caught;
  }
}

export interface FakeProcess {
  readonly stopper: BackgroundStopper;
  readonly stopCalls: readonly ("graceful" | "force")[];
  /** 프로세스가 끝난 것처럼 exited를 이행한다 */
  exit(code: number | null, signal?: string | null): void;
  /** exited를 거부한다 */
  crash(error: Error): void;
}

export interface FakeProcessOptions {
  /** 이 모드의 stop은 프로세스를 끝내지 않는다 */
  readonly ignore?: readonly ("graceful" | "force")[];
  /** 이 모드의 stop 호출은 거부된다 */
  readonly failOn?: readonly ("graceful" | "force")[];
}

export function fakeProcess(options: FakeProcessOptions = {}): FakeProcess {
  const stopCalls: ("graceful" | "force")[] = [];
  const {
    promise: exited,
    resolve: resolveExited,
    reject: rejectExited,
  } = Promise.withResolvers<{
    code: number | null;
    signal: string | null;
  }>();
  return {
    stopper: {
      exited,
      stop(mode) {
        stopCalls.push(mode);
        if (options.failOn?.includes(mode) === true) {
          return Promise.reject(new Error(`stop ${mode} failed`));
        }
        if (options.ignore?.includes(mode) !== true) {
          resolveExited({ code: null, signal: mode === "graceful" ? "SIGTERM" : "SIGKILL" });
        }
        return Promise.resolve();
      },
    },
    stopCalls,
    exit(code, signal = null) {
      resolveExited({ code, signal });
    },
    crash(error) {
      rejectExited(error);
    },
  };
}

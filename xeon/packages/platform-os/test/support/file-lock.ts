import { systemClock } from "../../src/time/clock.ts";
import { systemScheduler } from "../../src/time/scheduler.ts";
import { createFileLock, type FileLock } from "../../src/file-lock/index.ts";
import { createFlockPrimitive } from "../../src/file-lock/flock.ts";
import { detectPlatform, readPlatformProbe, selectProviders } from "../../src/select.ts";
import type { Logger } from "@xeon/contracts";

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

/** 이 기계의 OS 잠금(flock)을 쓰는 FileLock. flock을 쓸 수 없는 OS면 undefined */
export function realFileLock(): FileLock | undefined {
  const info = detectPlatform(readPlatformProbe());
  if (!info.ok) return undefined;
  const source = selectProviders(info.value).fileLock;
  if (source.kind !== "flock") return undefined;
  const primitive = createFlockPrimitive(source);
  if (primitive === undefined) return undefined;
  return createFileLock({
    primitive,
    clock: systemClock(),
    scheduler: systemScheduler(),
    logger: silent,
  });
}

/** 프로세스 안 직렬화만 하는 FileLock */
export function processOnlyFileLock(): FileLock {
  return createFileLock({
    primitive: undefined,
    clock: systemClock(),
    scheduler: systemScheduler(),
    logger: silent,
  });
}

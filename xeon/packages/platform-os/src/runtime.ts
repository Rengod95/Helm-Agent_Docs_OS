import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { err, ok, type Clock, type RandomSource } from "@xeon/contracts";
import { createNodeDirFs, type DirFs, type EnvReader } from "./dirs.ts";
import { processEnvReader } from "./env.ts";
import type { ReadTextFile, ReadTextFileSync } from "./identity.ts";
import {
  createRunCommand,
  createRunCommandSync,
  type RunCommand,
  type RunCommandSync,
} from "./proc.ts";
import { createNodeBinaryFs, type BinaryFs } from "./binaries/resolve.ts";
import {
  createFlockPrimitive,
  type FlockPrimitive,
  type FlockSelection,
} from "./file-lock/flock.ts";
import { readPlatformProbe, type PlatformProbe } from "./select.ts";
import { systemClock } from "./time/clock.ts";
import { systemRandom } from "./time/random.ts";
import { systemScheduler, type SystemScheduler } from "./time/scheduler.ts";

/**
 * 서비스가 바깥 세계에서 읽는 값과 수단 모음. 운영은 readOsRuntime()이 채우고, 테스트는 필요한 칸을 바꿔 만든다.
 * 전역 시각·난수 구현은 src/time/에만 있고 여기서는 그 함수를 호출만 한다.
 */
export interface OsRuntime {
  readonly probe: PlatformProbe;
  readonly env: EnvReader;
  readonly home: string;
  readonly systemTmp: string;
  /** process.getuid. Windows는 undefined */
  readonly getuid: (() => number) | undefined;
  readonly hostname: () => string;
  readonly clock: Clock;
  readonly scheduler: SystemScheduler;
  readonly random: RandomSource;
  readonly dirFs: DirFs;
  readonly binaryFs: BinaryFs;
  readonly readFile: ReadTextFile;
  readonly readFileSync: ReadTextFileSync;
  readonly run: RunCommand;
  readonly runSync: RunCommandSync;
  /** 고른 flock 선택으로 OS 잠금 수단을 만든다. dlopen이 실패하면 undefined. 테스트는 가짜 플랫폼에서 실제 dlopen을 피하려고 바꾼다 */
  readonly createFlock: (selection: FlockSelection) => FlockPrimitive | undefined;
  /** sysconf(_SC_CLK_TCK). Linux에서는 100이다 [가정] */
  readonly clkTck: number;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function readOsRuntime(): OsRuntime {
  const getuid = typeof process.getuid === "function" ? () => process.getuid?.() ?? 0 : undefined;
  return {
    probe: readPlatformProbe(),
    env: processEnvReader(),
    home: homedir(),
    systemTmp: tmpdir(),
    getuid,
    hostname,
    clock: systemClock(),
    scheduler: systemScheduler(),
    random: systemRandom(),
    dirFs: createNodeDirFs(getuid?.()),
    binaryFs: createNodeBinaryFs(),
    async readFile(path) {
      try {
        return ok(await readFile(path, "utf8"));
      } catch (caught) {
        return err({ code: errorCode(caught) });
      }
    },
    readFileSync(path) {
      try {
        return ok(readFileSync(path, "utf8"));
      } catch (caught) {
        return err({ code: errorCode(caught) });
      }
    },
    run: createRunCommand(),
    runSync: createRunCommandSync(),
    createFlock: (selection) => createFlockPrimitive(selection),
    clkTck: 100,
  };
}

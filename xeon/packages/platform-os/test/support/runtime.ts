import { err, ok } from "@xeon/contracts";
import type { DirFs, EnvReader } from "../../src/dirs.ts";
import type { OsRuntime } from "../../src/runtime.ts";
import { systemScheduler } from "../../src/time/scheduler.ts";
import { manualClock, seededRandom } from "./clock.ts";

export interface FakeDirFs extends DirFs {
  readonly made: string[];
}

/** 만든 경로를 보관하는 메모리 DirFs. 만든 디렉터리는 0700, 현재 uid 소유로 보인다 */
export function fakeDirFs(uid: number | null = 1000): FakeDirFs {
  const made: string[] = [];
  const owner = uid ?? 0;
  return {
    uid: uid ?? undefined,
    made,
    stat: (path) =>
      Promise.resolve(
        ok(made.includes(path) ? { isDirectory: true, mode: 0o40_700, uid: owner } : undefined),
      ),
    mkdir: (path) => {
      made.push(path);
      return Promise.resolve(ok(undefined));
    },
  };
}

export function envOf(values: Record<string, string>): EnvReader {
  return { get: (name) => values[name] };
}

/** 메모리만 쓰는 OsRuntime. 필요한 칸만 바꿔서 쓴다 */
export function fakeRuntime(overrides: Partial<OsRuntime> = {}): OsRuntime {
  const clock = manualClock();
  return {
    probe: {
      platform: "linux",
      arch: "x64",
      release: "6.1.0",
      wslDistro: undefined,
      procVersion: "Linux version 6.1.0",
    },
    env: envOf({ PATH: "/usr/bin" }),
    home: "/home/u",
    systemTmp: "/tmp",
    getuid: () => 1000,
    hostname: () => "test-host",
    clock,
    scheduler: systemScheduler(),
    random: seededRandom(1),
    dirFs: fakeDirFs(),
    binaryFs: {
      readFile: () => Promise.resolve(err({ code: "ENOENT" })),
      isExecutableFile: () => Promise.resolve(false),
    },
    readFile: (path) =>
      Promise.resolve(
        path === "/etc/machine-id" ? ok("0123456789abcdef\n") : err({ code: "ENOENT" }),
      ),
    readFileSync: () => err({ code: "ENOENT" }),
    run: () => Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT" })),
    runSync: () => err({ kind: "spawn_failed", code: "ENOENT" }),
    clkTck: 100,
    ...overrides,
  };
}

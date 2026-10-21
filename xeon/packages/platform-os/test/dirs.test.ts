import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import { dirsWarnings, resolveDirs, type DirsInput, type EnvReader } from "../src/dirs.ts";

const DARWIN: OsInfo = { platform: "darwin", arch: "arm64", isWsl: false, release: "24.0.0" };
const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "6.1.0" };
const WSL: OsInfo = { platform: "linux", arch: "x64", isWsl: true, release: "6.6.0-microsoft" };
const WIN: OsInfo = { platform: "win32", arch: "x64", isWsl: false, release: "10.0" };

function env(values: Record<string, string>): EnvReader {
  return { get: (name) => values[name] };
}

function input(overrides: Partial<DirsInput> & Pick<DirsInput, "info">): DirsInput {
  return {
    env: env({}),
    home: "/home/u",
    systemTmp: "/tmp",
    uid: 1000,
    resourceDir: "/opt/xeon/resources",
    ...overrides,
  };
}

function value(result: ReturnType<typeof resolveDirs>) {
  if (!result.ok) throw new Bug(`expected ok, got ${result.error.kind}`);
  return result.value;
}

describe("resolveDirs: 3플랫폼 × 환경 변수 조합", () => {
  test("macOS", () => {
    const dirs = value(
      resolveDirs(
        input({
          info: DARWIN,
          home: "/Users/u",
          systemTmp: "/var/folders/ab/T",
          uid: 501,
          env: env({ TMPDIR: "/var/folders/ab/T/" }),
        }),
      ),
    );
    expect(dirs).toEqual({
      home: "/Users/u",
      data: "/Users/u/Library/Application Support/xeon",
      config: "/Users/u/Library/Application Support/xeon/config",
      cache: "/Users/u/Library/Caches/xeon",
      state: "/Users/u/Library/Application Support/xeon/state",
      runtime: "/var/folders/ab/T/xeon",
      resource: "/opt/xeon/resources",
      tmp: "/var/folders/ab/T/xeon-501",
    });
  });

  test("macOS: TMPDIR이 없으면 systemTmp를 쓴다", () => {
    const dirs = value(
      resolveDirs(input({ info: DARWIN, home: "/Users/u", systemTmp: "/tmp", uid: 501 })),
    );
    expect(dirs.runtime).toBe("/tmp/xeon");
  });

  test("Linux: XDG 변수 없음", () => {
    const dirs = value(resolveDirs(input({ info: LINUX })));
    expect(dirs).toEqual({
      home: "/home/u",
      data: "/home/u/.local/share/xeon",
      config: "/home/u/.config/xeon",
      cache: "/home/u/.cache/xeon",
      state: "/home/u/.local/state/xeon",
      runtime: "/tmp/xeon-1000",
      resource: "/opt/xeon/resources",
      tmp: "/tmp/xeon-1000",
    });
  });

  test("Linux: XDG 변수 있음", () => {
    const dirs = value(
      resolveDirs(
        input({
          info: LINUX,
          env: env({
            XDG_DATA_HOME: "/data",
            XDG_CONFIG_HOME: "/conf",
            XDG_CACHE_HOME: "/cache",
            XDG_STATE_HOME: "/state",
            XDG_RUNTIME_DIR: "/run/user/1000",
          }),
        }),
      ),
    );
    expect(dirs.data).toBe("/data/xeon");
    expect(dirs.config).toBe("/conf/xeon");
    expect(dirs.cache).toBe("/cache/xeon");
    expect(dirs.state).toBe("/state/xeon");
    expect(dirs.runtime).toBe("/run/user/1000/xeon");
  });

  test("Linux: 상대 경로 XDG 변수는 무시하고 기본값을 쓴다", () => {
    const dirs = value(
      resolveDirs(
        input({
          info: LINUX,
          env: env({
            XDG_DATA_HOME: "relative/data",
            XDG_CONFIG_HOME: "",
            XDG_RUNTIME_DIR: "run",
          }),
        }),
      ),
    );
    expect(dirs.data).toBe("/home/u/.local/share/xeon");
    expect(dirs.config).toBe("/home/u/.config/xeon");
    expect(dirs.runtime).toBe("/tmp/xeon-1000");
  });

  test("Linux: XDG_RUNTIME_DIR 없음 → /tmp/xeon-<uid>", () => {
    const dirs = value(resolveDirs(input({ info: LINUX, uid: 4242 })));
    expect(dirs.runtime).toBe("/tmp/xeon-4242");
  });

  test("Windows: 변수 있음", () => {
    const dirs = value(
      resolveDirs(
        input({
          info: WIN,
          home: "C:\\Users\\u",
          uid: undefined,
          systemTmp: "C:\\Windows\\Temp",
          env: env({
            LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
            APPDATA: "C:\\Users\\u\\AppData\\Roaming",
            TEMP: "C:\\Users\\u\\AppData\\Local\\Temp",
          }),
          resourceDir: "C:\\Program Files\\Xeon\\resources",
        }),
      ),
    );
    expect(dirs).toEqual({
      home: "C:\\Users\\u",
      data: "C:\\Users\\u\\AppData\\Local\\xeon\\data",
      config: "C:\\Users\\u\\AppData\\Roaming\\xeon",
      cache: "C:\\Users\\u\\AppData\\Local\\xeon\\cache",
      state: "C:\\Users\\u\\AppData\\Local\\xeon\\state",
      runtime: "C:\\Users\\u\\AppData\\Local\\xeon\\run",
      resource: "C:\\Program Files\\Xeon\\resources",
      tmp: "C:\\Users\\u\\AppData\\Local\\Temp\\xeon",
    });
  });

  test("Windows: 변수 없음 → env_missing", () => {
    const base = { info: WIN, home: "C:\\Users\\u", uid: undefined, resourceDir: "C:\\r" };
    expect(resolveDirs(input({ ...base, env: env({ APPDATA: "C:\\a" }) }))).toEqual({
      ok: false,
      error: { kind: "env_missing", name: "LOCALAPPDATA" },
    });
    expect(resolveDirs(input({ ...base, env: env({ LOCALAPPDATA: "C:\\l" }) }))).toEqual({
      ok: false,
      error: { kind: "env_missing", name: "APPDATA" },
    });
  });

  test("HOME이 비어 있으면 env_missing", () => {
    expect(resolveDirs(input({ info: LINUX, home: "" }))).toEqual({
      ok: false,
      error: { kind: "env_missing", name: "HOME" },
    });
  });

  test("uid가 없는 Unix는 env_missing", () => {
    expect(resolveDirs(input({ info: LINUX, uid: undefined }))).toEqual({
      ok: false,
      error: { kind: "env_missing", name: "uid" },
    });
  });

  test("resourceDir이 상대 경로이면 not_absolute", () => {
    expect(resolveDirs(input({ info: LINUX, resourceDir: "res" }))).toEqual({
      ok: false,
      error: { kind: "not_absolute", dir: "resource", path: "res" },
    });
  });
});

describe("resolveDirs: XEON_HOME", () => {
  test("XEON_HOME 우선: 관리 설정과 OS 기본보다 앞서고 resource·tmp는 그대로", () => {
    const withBoth = value(
      resolveDirs(
        input({
          info: LINUX,
          env: env({ XEON_HOME: "/x/home", XDG_DATA_HOME: "/data" }),
          managedOverride: "/managed",
        }),
      ),
    );
    expect(withBoth).toEqual({
      home: "/home/u",
      data: "/x/home/data",
      config: "/x/home/config",
      cache: "/x/home/cache",
      state: "/x/home/state",
      runtime: "/x/home/run",
      resource: "/opt/xeon/resources",
      tmp: "/tmp/xeon-1000",
    });
  });

  test("관리 설정 override는 OS 기본보다 앞선다", () => {
    const dirs = value(
      resolveDirs(
        input({ info: LINUX, env: env({ XDG_DATA_HOME: "/data" }), managedOverride: "/managed" }),
      ),
    );
    expect(dirs.data).toBe("/managed/data");
    expect(dirs.runtime).toBe("/managed/run");
  });

  test("XEON_HOME 상대 경로 거부", () => {
    expect(resolveDirs(input({ info: LINUX, env: env({ XEON_HOME: "rel/dir" }) }))).toEqual({
      ok: false,
      error: { kind: "not_absolute", dir: "data", path: "rel/dir" },
    });
  });

  test("관리 설정 override 상대 경로도 거부", () => {
    const result = resolveDirs(input({ info: LINUX, managedOverride: "rel" }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("not_absolute");
  });

  test("빈 XEON_HOME은 없는 것으로 본다", () => {
    const dirs = value(resolveDirs(input({ info: LINUX, env: env({ XEON_HOME: "" }) })));
    expect(dirs.data).toBe("/home/u/.local/share/xeon");
  });

  test("XEON_HOME 아래 run이 길면 OS 기본 runtime으로 내려간다", () => {
    const long = `/${"a".repeat(90)}`;
    const dirs = value(resolveDirs(input({ info: LINUX, env: env({ XEON_HOME: long }) })));
    expect(dirs.data).toBe(`${long}/data`);
    expect(dirs.runtime).toBe("/tmp/xeon-1000");
  });
});

describe("resolveDirs: WSL", () => {
  test("/mnt/* 아래 data는 data_dir_on_drvfs", () => {
    expect(resolveDirs(input({ info: WSL, env: env({ XDG_DATA_HOME: "/mnt/c/x" }) }))).toEqual({
      ok: false,
      error: { kind: "data_dir_on_drvfs", dir: "data", path: "/mnt/c/x/xeon" },
    });
  });

  test("state·cache·runtime도 거부한다", () => {
    for (const [name, dir] of [
      ["XDG_STATE_HOME", "state"],
      ["XDG_CACHE_HOME", "cache"],
      ["XDG_RUNTIME_DIR", "runtime"],
    ] as const) {
      const result = resolveDirs(input({ info: WSL, env: env({ [name]: "/mnt/d/y" }) }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind === "data_dir_on_drvfs" && result.error.dir).toBe(dir);
    }
  });

  test("XEON_HOME이 /mnt 아래여도 거부한다", () => {
    const result = resolveDirs(input({ info: WSL, env: env({ XEON_HOME: "/mnt/c/xeon" }) }));
    expect(!result.ok && result.error.kind).toBe("data_dir_on_drvfs");
  });

  test("config는 /mnt 아래여도 허용하고 경고를 돌려준다", () => {
    const dirs = value(
      resolveDirs(input({ info: WSL, env: env({ XDG_CONFIG_HOME: "/mnt/c/conf" }) })),
    );
    expect(dirs.config).toBe("/mnt/c/conf/xeon");
    expect(dirsWarnings(WSL, dirs)).toEqual([
      { kind: "config_on_drvfs", path: "/mnt/c/conf/xeon" },
    ]);
  });

  test("WSL이 아니면 /mnt/* 도 거부하지 않는다", () => {
    const dirs = value(
      resolveDirs(input({ info: LINUX, env: env({ XDG_DATA_HOME: "/mnt/data" }) })),
    );
    expect(dirs.data).toBe("/mnt/data/xeon");
    expect(dirsWarnings(LINUX, dirs)).toEqual([]);
  });
});

describe("resolveDirs: runtime 길이 규칙", () => {
  test("긴 $TMPDIR(macOS)에서 /tmp/xeon-<uid>로 내려간다", () => {
    const longTmp = `/var/folders/${"x".repeat(80)}/T`;
    const dirs = value(
      resolveDirs(
        input({
          info: DARWIN,
          home: "/Users/u",
          uid: 501,
          systemTmp: longTmp,
          env: env({ TMPDIR: longTmp }),
        }),
      ),
    );
    expect(dirs.runtime).toBe("/tmp/xeon-501");
  });

  test("긴 XDG_RUNTIME_DIR(Linux)에서 /tmp/xeon-<uid>로 내려간다", () => {
    const dirs = value(
      resolveDirs(input({ info: LINUX, env: env({ XDG_RUNTIME_DIR: `/${"r".repeat(95)}` }) })),
    );
    expect(dirs.runtime).toBe("/tmp/xeon-1000");
  });

  test("경계: 경로 바이트 + 24가 한계와 같으면 통과, 1 넘으면 내려간다 (Linux 104)", () => {
    // "/xeon" = 5바이트. 접두 경로 길이 L이면 runtime = L + 5, 합 = L + 29
    const fits = "/" + "a".repeat(104 - 29 - 1); // runtime 바이트 = 75 + 5 = 80 → 104
    const tooLong = fits + "a";
    expect(
      value(resolveDirs(input({ info: LINUX, env: env({ XDG_RUNTIME_DIR: fits }) }))).runtime,
    ).toBe(`${fits}/xeon`);
    expect(
      value(resolveDirs(input({ info: LINUX, env: env({ XDG_RUNTIME_DIR: tooLong }) }))).runtime,
    ).toBe("/tmp/xeon-1000");
  });

  test("UTF-8 바이트 수로 센다", () => {
    // 한글 한 글자는 3바이트
    const korean = `/${"가".repeat(30)}`;
    const dirs = value(resolveDirs(input({ info: LINUX, env: env({ XDG_RUNTIME_DIR: korean }) })));
    expect(dirs.runtime).toBe("/tmp/xeon-1000");
  });

  test("대체 후보도 길면 runtime_path_too_long", () => {
    const longTmp = `/var/folders/${"x".repeat(80)}/T`;
    const result = resolveDirs(
      input({
        info: DARWIN,
        home: "/Users/u",
        uid: 501,
        sharedTmp: `/${"s".repeat(90)}`,
        systemTmp: longTmp,
        env: env({ TMPDIR: longTmp }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "runtime_path_too_long") {
      expect(result.error.limit).toBe(100);
      expect(result.error.bytes).toBeGreaterThan(100);
    } else {
      throw new Bug("expected runtime_path_too_long");
    }
  });
});

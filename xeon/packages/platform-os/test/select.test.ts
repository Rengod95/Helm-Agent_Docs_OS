import { describe, expect, test } from "bun:test";
import {
  detectPlatform,
  readPlatformProbe,
  selectProviders,
  type PlatformProbe,
} from "../src/select.ts";

function probe(overrides: Partial<PlatformProbe>): PlatformProbe {
  return {
    platform: "linux",
    arch: "x64",
    release: "6.1.0",
    wslDistro: undefined,
    procVersion: "Linux version 6.1.0 (gcc)",
    ...overrides,
  };
}

describe("detectPlatform", () => {
  test("darwin·linux·win32 probe", () => {
    expect(detectPlatform(probe({ platform: "darwin", arch: "arm64", release: "24.0.0" }))).toEqual(
      {
        ok: true,
        value: { platform: "darwin", arch: "arm64", isWsl: false, release: "24.0.0" },
      },
    );
    expect(detectPlatform(probe({}))).toEqual({
      ok: true,
      value: { platform: "linux", arch: "x64", isWsl: false, release: "6.1.0" },
    });
    expect(detectPlatform(probe({ platform: "win32", release: "10.0.22631" }))).toEqual({
      ok: true,
      value: { platform: "win32", arch: "x64", isWsl: false, release: "10.0.22631" },
    });
  });

  test("WSL 판정", () => {
    const byEnv = detectPlatform(probe({ wslDistro: "Ubuntu" }));
    const byKernel = detectPlatform(
      probe({ procVersion: "Linux version 5.15.0-microsoft-standard-WSL2" }),
    );
    const byKernelUpper = detectPlatform(probe({ procVersion: "Linux version 5.4.72-Microsoft" }));
    const plain = detectPlatform(probe({}));
    const emptyDistro = detectPlatform(probe({ wslDistro: "" }));
    for (const result of [byEnv, byKernel, byKernelUpper]) {
      expect(result.ok && result.value.isWsl).toBe(true);
    }
    expect(plain.ok && plain.value.isWsl).toBe(false);
    expect(emptyDistro.ok && emptyDistro.value.isWsl).toBe(false);
  });

  test("linux가 아니면 WSL 표지가 있어도 false", () => {
    const result = detectPlatform(probe({ platform: "darwin", wslDistro: "Ubuntu" }));
    expect(result.ok && result.value.isWsl).toBe(false);
  });

  test("지원 밖 값", () => {
    expect(detectPlatform(probe({ platform: "freebsd" }))).toEqual({
      ok: false,
      error: { kind: "unsupported_platform", platform: "freebsd" },
    });
    expect(detectPlatform(probe({ arch: "ia32" }))).toEqual({
      ok: false,
      error: { kind: "unsupported_arch", arch: "ia32" },
    });
  });

  test("release는 256자로 줄인다", () => {
    const result = detectPlatform(probe({ release: "r".repeat(300) }));
    expect(result.ok && result.value.release.length).toBe(256);
  });
});

describe("selectProviders", () => {
  test("OS마다 수단을 고른다", () => {
    const base = { arch: "x64", isWsl: false, release: "" } as const;
    expect(selectProviders({ ...base, platform: "linux" })).toEqual({
      fsKind: "statfs",
      machineId: "etc-machine-id",
      fingerprint: "proc",
      fileLock: {
        kind: "flock",
        libName: "libc.so.6",
        errnoSymbol: "__errno_location",
        wouldBlockErrno: 11,
      },
    });
    expect(selectProviders({ ...base, platform: "darwin" })).toEqual({
      fsKind: "mount",
      machineId: "ioreg",
      fingerprint: "ps",
      fileLock: {
        kind: "flock",
        libName: "libSystem.B.dylib",
        errnoSymbol: "__error",
        wouldBlockErrno: 35,
      },
    });
    expect(selectProviders({ ...base, platform: "win32" })).toEqual({
      fsKind: "none",
      machineId: "hostname",
      fingerprint: "unsupported",
      fileLock: { kind: "process" },
    });
  });

  test("배포 환경이 fsKind를 덮어쓴다", () => {
    const info = { platform: "linux", arch: "x64", isWsl: false, release: "" } as const;
    expect(selectProviders(info, { fsKind: "none" }).fsKind).toBe("none");
  });
});

test("readPlatformProbe: 이 기계의 값이 지원 목록 안이다", () => {
  const result = detectPlatform(readPlatformProbe());
  expect(result.ok).toBe(true);
});

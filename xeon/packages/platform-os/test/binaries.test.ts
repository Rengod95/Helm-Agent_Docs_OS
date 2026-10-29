import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Bug, err, ok } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import {
  createBinaryResolver,
  createNodeBinaryFs,
  parseBinariesLock,
  type BinaryFs,
  type BinaryResolverDeps,
} from "../src/binaries/resolve.ts";
import { compareTriples, findVersion, parseTriple } from "../src/binaries/semver.ts";
import type { CommandOutput, RunCommand } from "../src/proc.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { memoryLogger } from "./support/clock.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "" };
const DARWIN: OsInfo = { platform: "darwin", arch: "arm64", isWsl: false, release: "" };
const signal = new AbortController().signal;

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

interface Harness {
  readonly deps: BinaryResolverDeps;
  readonly runs: string[][];
}

/** 파일 시스템을 표로 흉내 낸다: 실행 가능한 경로 목록과 파일 내용 */
function fakeFs(opts: {
  readonly executables?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
}): BinaryFs {
  const files = opts.files ?? {};
  return {
    readFile(path) {
      const content = files[path];
      return Promise.resolve(
        content === undefined ? err({ code: "ENOENT" }) : ok(new TextEncoder().encode(content)),
      );
    },
    isExecutableFile: (path) => Promise.resolve((opts.executables ?? []).includes(path)),
  };
}

function harness(opts: {
  readonly info?: OsInfo;
  readonly fs: BinaryFs;
  readonly pathEnv?: string;
  readonly versions?: Readonly<Record<string, string>>;
  readonly resourceDir?: string;
  readonly bundledSource?: BinaryResolverDeps["bundledSource"];
  readonly lifetime?: AbortSignal;
}): Harness {
  const runs: string[][] = [];
  const run: RunCommand = (argv) => {
    runs.push([...argv]);
    const stdout = opts.versions?.[argv[0] ?? ""];
    if (stdout === undefined) return Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT" }));
    const out: CommandOutput = { exitCode: 0, stdout };
    return Promise.resolve(ok(out));
  };
  return {
    runs,
    deps: {
      info: opts.info ?? LINUX,
      resourceDir: opts.resourceDir ?? "/opt/xeon/resources",
      pathEnv: opts.pathEnv,
      fs: opts.fs,
      run,
      logger: memoryLogger().logger,
      lifetime: opts.lifetime ?? signal,
      ...(opts.bundledSource === undefined ? {} : { bundledSource: opts.bundledSource }),
    },
  };
}

function rgHarness(): Harness {
  return harness({
    fs: fakeFs({ executables: ["/usr/bin/rg"] }),
    pathEnv: "/usr/bin",
    versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
  });
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function lockFile(entries: readonly Record<string, string>[]): string {
  return JSON.stringify({ binaries: entries });
}

describe("semver 보조", () => {
  test("findVersion·parseTriple·compareTriples", () => {
    expect(findVersion("ripgrep 14.1.0 (rev abc)")).toBe("14.1.0");
    expect(findVersion("git version 2.43.0")).toBe("2.43.0");
    expect(findVersion("v1.2")).toBe("1.2.0");
    expect(findVersion("no digits")).toBeUndefined();
    expect(parseTriple("1.2.3")).toEqual([1, 2, 3]);
    expect(parseTriple("1.2")).toBeUndefined();
    expect(compareTriples([14, 1, 0], [14, 0, 9])).toBeGreaterThan(0);
    expect(compareTriples([13, 9, 9], [14, 0, 0])).toBeLessThan(0);
    expect(compareTriples([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe("parseBinariesLock", () => {
  test("올바른 목록과 깨진 목록", () => {
    const entry = {
      name: "rg",
      platform: "linux",
      arch: "x64",
      path: "bin/rg",
      sha256: "ab",
      version: "14.1.0",
    };
    expect(parseBinariesLock(lockFile([entry]))).toEqual(ok([entry]));
    expect(parseBinariesLock("not json")).toEqual(err({ kind: "lock_invalid" }));
    expect(parseBinariesLock("[]")).toEqual(err({ kind: "lock_invalid" }));
    expect(parseBinariesLock('{"binaries":[{"name":"rg"}]}')).toEqual(
      err({ kind: "lock_invalid" }),
    );
  });
});

describe("resolveBinary: 번들 > 시스템", () => {
  test("번들과 시스템이 모두 있으면 source는 bundled이고 시스템 탐색·실행을 하지 않는다", async () => {
    const bundleBytes = "#!/bin/sh\necho rg\n";
    const lock = lockFile([
      {
        name: "rg",
        platform: "linux",
        arch: "x64",
        path: "bin/rg",
        sha256: sha(bundleBytes),
        version: "14.1.0",
      },
    ]);
    const resource = "/opt/xeon/resources";
    const { deps, runs } = harness({
      fs: fakeFs({
        executables: [`${resource}/bin/rg`, "/usr/bin/rg"],
        files: { [`${resource}/binaries.lock.json`]: lock, [`${resource}/bin/rg`]: bundleBytes },
      }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 13.0.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", {}, signal);
    expect(result).toEqual(
      ok({ name: "rg", path: `${resource}/bin/rg`, version: "14.1.0", source: "bundled" }),
    );
    expect(runs).toEqual([]);
  });

  test("소스 실행: bundledSource가 준 경로를 해시 검사 없이 쓴다", async () => {
    const { deps } = harness({
      fs: fakeFs({}),
      pathEnv: "",
      bundledSource: () => Promise.resolve(ok({ path: "/node_modules/rg", version: "14.1.0" })),
    });
    expect(await createBinaryResolver(deps)("rg", {}, signal)).toEqual(
      ok({ name: "rg", path: "/node_modules/rg", version: "14.1.0", source: "bundled" }),
    );
  });

  test("해시 불일치 거부: integrity_mismatch, 실행 함수 호출 0회, 시스템 rg로 대체하지 않음", async () => {
    const resource = "/opt/xeon/resources";
    const lock = lockFile([
      {
        name: "rg",
        platform: "linux",
        arch: "x64",
        path: "bin/rg",
        sha256: sha("original"),
        version: "14.1.0",
      },
    ]);
    const { deps, runs } = harness({
      fs: fakeFs({
        executables: [`${resource}/bin/rg`, "/usr/bin/rg"],
        files: { [`${resource}/binaries.lock.json`]: lock, [`${resource}/bin/rg`]: "tampered" },
      }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", {}, signal);
    expect(result).toEqual(
      err({
        kind: "integrity_mismatch",
        name: "rg",
        expected: sha("original"),
        actual: sha("tampered"),
      }),
    );
    expect(runs).toEqual([]);
  });

  test("목록 항목이 있어도 플랫폼이 다르면 건너뛴다", async () => {
    const resource = "/opt/xeon/resources";
    const lock = lockFile([
      {
        name: "rg",
        platform: "darwin",
        arch: "arm64",
        path: "bin/rg",
        sha256: "00",
        version: "14.1.0",
      },
    ]);
    const { deps } = harness({
      fs: fakeFs({
        executables: ["/usr/bin/rg"],
        files: { [`${resource}/binaries.lock.json`]: lock },
      }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", {}, signal);
    expect(result.ok && result.value.source).toBe("system");
  });

  test("목록의 경로가 resource 밖으로 나가면 extract_failed", async () => {
    const resource = "/opt/xeon/resources";
    const lock = lockFile([
      {
        name: "rg",
        platform: "linux",
        arch: "x64",
        path: "../../../bin/sh",
        sha256: "00",
        version: "1.0.0",
      },
    ]);
    const { deps } = harness({
      fs: fakeFs({ files: { [`${resource}/binaries.lock.json`]: lock } }),
      pathEnv: "",
    });
    expect(await createBinaryResolver(deps)("rg", {}, signal)).toEqual(
      err({ kind: "extract_failed", name: "rg", code: "LOCK_PATH_ESCAPES" }),
    );
  });

  test("깨진 목록 파일과 번들 파일 없음은 extract_failed", async () => {
    const resource = "/opt/xeon/resources";
    const broken = harness({
      fs: fakeFs({ files: { [`${resource}/binaries.lock.json`]: "{" } }),
      pathEnv: "",
    });
    expect(await createBinaryResolver(broken.deps)("rg", {}, signal)).toEqual(
      err({ kind: "extract_failed", name: "rg", code: "LOCK_INVALID" }),
    );
    const lock = lockFile([
      {
        name: "rg",
        platform: "linux",
        arch: "x64",
        path: "bin/rg",
        sha256: "00",
        version: "1.0.0",
      },
    ]);
    const missing = harness({
      fs: fakeFs({ files: { [`${resource}/binaries.lock.json`]: lock } }),
      pathEnv: "",
    });
    expect(await createBinaryResolver(missing.deps)("rg", {}, signal)).toEqual(
      err({ kind: "extract_failed", name: "rg", code: "ENOENT" }),
    );
  });

  test("allowSystem false면 번들만 본다", async () => {
    const { deps, runs } = harness({
      fs: fakeFs({ executables: ["/usr/bin/rg"] }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", { allowSystem: false }, signal);
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(runs).toEqual([]);
  });
});

describe("resolveBinary: 시스템", () => {
  test("PATH 앞쪽이 이기고 버전은 --version 첫 줄에서 읽는다", async () => {
    const { deps, runs } = harness({
      fs: fakeFs({ executables: ["/b/rg", "/a/rg"] }),
      pathEnv: "/c:/a:/b",
      versions: { "/a/rg": "ripgrep 14.1.0\nfeatures:+pcre2\n", "/b/rg": "ripgrep 1.0.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", {}, signal);
    expect(result).toEqual(ok({ name: "rg", path: "/a/rg", version: "14.1.0", source: "system" }));
    expect(runs).toEqual([["/a/rg", "--version"]]);
  });

  test("상대 경로와 빈 PATH 항목은 건너뛴다", async () => {
    const { deps } = harness({
      fs: fakeFs({ executables: ["rg", "bin/rg", "/x/rg"] }),
      pathEnv: ":bin::.:/x",
      versions: { "/x/rg": "ripgrep 14.1.0\n" },
    });
    const result = await createBinaryResolver(deps)("rg", {}, signal);
    expect(result.ok && result.value.path).toBe("/x/rg");
  });

  test("최소 버전: 미달이면 version_too_old, 이상이면 통과", async () => {
    const old = await createBinaryResolver(rgHarness().deps)(
      "rg",
      { minVersion: "15.0.0" },
      signal,
    );
    expect(old).toEqual(
      err({ kind: "version_too_old", name: "rg", found: "14.1.0", required: "15.0.0" }),
    );
    const same = await createBinaryResolver(rgHarness().deps)(
      "rg",
      { minVersion: "14.1.0" },
      signal,
    );
    expect(same.ok).toBe(true);
  });

  test("버전을 읽지 못하면 version_unreadable", async () => {
    const noVersion = harness({
      fs: fakeFs({ executables: ["/usr/bin/rg"] }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "hello world\n" },
    });
    expect(await createBinaryResolver(noVersion.deps)("rg", {}, signal)).toEqual(
      err({ kind: "version_unreadable", name: "rg", path: "/usr/bin/rg" }),
    );
    const spawnFail = harness({
      fs: fakeFs({ executables: ["/usr/bin/rg"] }),
      pathEnv: "/usr/bin",
    });
    expect((await createBinaryResolver(spawnFail.deps)("rg", {}, signal)).ok).toBe(false);
  });

  test("security·secret-tool은 버전 확인을 건너뛰고 version이 빈 문자열이다", async () => {
    const { deps, runs } = harness({
      info: DARWIN,
      fs: fakeFs({ executables: ["/usr/bin/security", "/usr/bin/secret-tool"] }),
      pathEnv: "/usr/bin",
    });
    const resolver = createBinaryResolver(deps);
    expect(await resolver("security", {}, signal)).toEqual(
      ok({ name: "security", path: "/usr/bin/security", version: "", source: "system" }),
    );
    expect(await resolver("secret-tool", {}, signal)).toEqual(
      ok({ name: "secret-tool", path: "/usr/bin/secret-tool", version: "", source: "system" }),
    );
    expect(runs).toEqual([]);
  });

  test("security·secret-tool에 minVersion을 주면 호출 쪽 버그", () => {
    const { deps } = harness({ fs: fakeFs({}), pathEnv: "" });
    const resolver = createBinaryResolver(deps);
    expect(() => resolver("security", { minVersion: "1.0.0" }, signal)).toThrow(Bug);
    expect(() => resolver("rg", { minVersion: "14" }, signal)).toThrow(Bug);
  });

  test("socat은 -V로 버전을 읽고 둘째 줄의 버전도 찾는다", async () => {
    const { deps, runs } = harness({
      fs: fakeFs({ executables: ["/usr/bin/socat"] }),
      pathEnv: "/usr/bin",
      versions: {
        "/usr/bin/socat":
          "socat by Gerhard Rieger and contributors - see www.dest-unreach.org\nsocat version 1.7.4.4 on Jan  1 2024\n",
      },
    });
    const result = await createBinaryResolver(deps)("socat", {}, signal);
    expect(result.ok && result.value.version).toBe("1.7.4");
    expect(runs).toEqual([["/usr/bin/socat", "-V"]]);
  });

  test("없음: not_found, searched에 PATH 항목, hint가 비어 있지 않다", async () => {
    const { deps } = harness({ fs: fakeFs({}), pathEnv: "/usr/bin:/usr/local/bin" });
    const names = [
      "rg",
      "sops",
      "age",
      "git",
      "bwrap",
      "socat",
      "security",
      "secret-tool",
    ] as const;
    const resolver = createBinaryResolver(deps);
    const results = await Promise.all(names.map((name) => resolver(name, {}, signal)));
    results.forEach((result, index) => {
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.kind === "not_found") {
        expect(result.error.name === names[index]).toBe(true);
        expect(result.error.searched).toEqual(["/usr/bin", "/usr/local/bin"]);
        expect(result.error.hint.length).toBeGreaterThan(0);
      } else {
        throw new Bug("expected not_found");
      }
    });
  });

  test("Linux에서 bwrap과 socat이 없으면 apt 설치 안내를 싣는다 (D-M3-25 행 5, M3-REQ-53)", async () => {
    const { deps } = harness({ fs: fakeFs({}), pathEnv: "/usr/bin" });
    const resolver = createBinaryResolver(deps);
    const bwrap = await resolver("bwrap", {}, signal);
    const socat = await resolver("socat", {}, signal);
    expect([bwrap, socat].map((result) => (result.ok ? undefined : result.error))).toEqual([
      {
        kind: "not_found",
        name: "bwrap",
        searched: ["/usr/bin"],
        hint: "bubblewrap 패키지를 설치한다 (예: apt install bubblewrap)",
      },
      {
        kind: "not_found",
        name: "socat",
        searched: ["/usr/bin"],
        hint: "socat 패키지를 설치한다 (예: apt install socat)",
      },
    ]);
  });

  test("동시 호출 합치기: 같은 이름 동시 호출 3회에 탐색 1회", async () => {
    let probes = 0;
    const base = fakeFs({ executables: ["/usr/bin/rg"] });
    const fs: BinaryFs = {
      readFile: (path) => base.readFile(path),
      isExecutableFile: (path) => {
        probes += 1;
        return base.isExecutableFile(path);
      },
    };
    const { deps, runs } = harness({
      fs,
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
    });
    const resolver = createBinaryResolver(deps);
    const [a, b, c] = await Promise.all([
      resolver("rg", {}, signal),
      resolver("rg", {}, signal),
      resolver("rg", {}, signal),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(runs.length).toBe(1);
    expect(probes).toBe(1);
    // 성공은 캐시한다
    await resolver("rg", {}, signal);
    expect(probes).toBe(1);
  });

  test("실패는 캐시하지 않는다(설치한 뒤 다시 물을 수 있다)", async () => {
    const executables: string[] = [];
    const base = fakeFs({});
    const fs: BinaryFs = {
      readFile: (path) => base.readFile(path),
      isExecutableFile: (path) => Promise.resolve(executables.includes(path)),
    };
    const { deps } = harness({
      fs,
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/git": "git version 2.43.0\n" },
    });
    const resolver = createBinaryResolver(deps);
    expect((await resolver("git", {}, signal)).ok).toBe(false);
    executables.push("/usr/bin/git");
    expect((await resolver("git", {}, signal)).ok).toBe(true);
  });

  test("호출자 신호가 중단되면 cancelled이고 다른 호출자의 결과는 영향받지 않는다", async () => {
    const { deps } = harness({
      fs: fakeFs({ executables: ["/usr/bin/rg"] }),
      pathEnv: "/usr/bin",
      versions: { "/usr/bin/rg": "ripgrep 14.1.0\n" },
    });
    const resolver = createBinaryResolver(deps);
    const controller = new AbortController();
    const aborted = resolver("rg", {}, controller.signal);
    controller.abort();
    const other = resolver("rg", {}, signal);
    expect(await aborted).toEqual(err({ kind: "cancelled" }));
    expect((await other).ok).toBe(true);
    const pre = new AbortController();
    pre.abort();
    expect(await resolver("rg", {}, pre.signal)).toEqual(err({ kind: "cancelled" }));
  });

  test("Windows는 .exe 이름으로 ; 구분 PATH를 찾는다", async () => {
    const { deps } = harness({
      info: { platform: "win32", arch: "x64", isWsl: false, release: "" },
      fs: fakeFs({ executables: ["/w/git.exe"] }),
      pathEnv: "relative;/w;/z",
      versions: { "/w/git.exe": "git version 2.43.0.windows.1\n" },
    });
    const result = await createBinaryResolver(deps)("git", {}, signal);
    expect(result.ok && result.value.version).toBe("2.43.0");
  });
});

describe("실제 파일 시스템 (임시 디렉터리)", () => {
  const unixOnly = process.platform === "win32" ? test.skip : test;

  unixOnly("createNodeBinaryFs: 실행 비트가 있는 일반 파일만 실행 가능으로 본다", async () => {
    temp = await tempDir();
    const exe = join(temp.path, "tool");
    const plain = join(temp.path, "plain");
    await writeFile(exe, "#!/bin/sh\n");
    await chmod(exe, 0o755);
    await writeFile(plain, "x");
    await chmod(plain, 0o644);
    await mkdir(join(temp.path, "dir"), { mode: 0o755 });
    const fs = createNodeBinaryFs();
    expect(await fs.isExecutableFile(exe)).toBe(true);
    expect(await fs.isExecutableFile(plain)).toBe(false);
    expect(await fs.isExecutableFile(join(temp.path, "dir"))).toBe(false);
    expect(await fs.isExecutableFile(join(temp.path, "missing"))).toBe(false);
    expect((await fs.readFile(plain)).ok).toBe(true);
    expect(await fs.readFile(join(temp.path, "missing"))).toEqual(err({ code: "ENOENT" }));
  });

  unixOnly("실제 번들 목록 + 파일로 해시가 맞으면 bundled, 바뀌면 integrity_mismatch", async () => {
    temp = await tempDir();
    const bin = join(temp.path, "bin");
    await mkdir(bin);
    const tool = join(bin, "rg");
    await writeFile(tool, "#!/bin/sh\necho ripgrep 14.1.0\n");
    await chmod(tool, 0o755);
    const entry = {
      name: "rg",
      platform: "linux",
      arch: "x64",
      path: "bin/rg",
      sha256: sha("#!/bin/sh\necho ripgrep 14.1.0\n"),
      version: "14.1.0",
    };
    await writeFile(join(temp.path, "binaries.lock.json"), lockFile([entry]));
    const { deps, runs } = harness({
      fs: createNodeBinaryFs(),
      resourceDir: temp.path,
      pathEnv: "",
    });
    const first = await createBinaryResolver(deps)("rg", {}, signal);
    expect(first).toEqual(ok({ name: "rg", path: tool, version: "14.1.0", source: "bundled" }));

    await writeFile(tool, "#!/bin/sh\nrm -rf /\n");
    await chmod(tool, 0o755);
    const second = await createBinaryResolver(deps)("rg", {}, signal);
    expect(!second.ok && second.error.kind).toBe("integrity_mismatch");
    expect(runs).toEqual([]);
  });
});

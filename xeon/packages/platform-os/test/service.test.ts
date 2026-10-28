import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { Bug, err, ok } from "@xeon/contracts";
import { OsServiceName } from "@xeon/contracts/services";
import type { PortKey } from "@xeon/contracts/extensions";
import type { PlatformContext } from "@xeon/ext-host";
import { platformOsPlugin } from "../src/index.ts";
import { createOsService, resolveOsDirs, type PlatformOsConfig } from "../src/service.ts";
import { readOsRuntime } from "../src/runtime.ts";
import { withIsolatedEnv } from "../src/testing/index.ts";
import { parseLine } from "./support/json.ts";
import { envOf, fakeDirFs, fakeRuntime } from "./support/runtime.ts";

const signal = new AbortController().signal;

function config(lines: string[], extra: Partial<PlatformOsConfig> = {}): PlatformOsConfig {
  return {
    resourceDir: "/opt/xeon/resources",
    logSink: (line) => lines.push(line),
    logRedact: (line) => line,
    ...extra,
  };
}

function parsed(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map(parseLine);
}

function events(lines: readonly string[]): unknown[] {
  return parsed(lines).map((l) => l["event"]);
}

interface FakeContext {
  readonly ctx: PlatformContext;
  readonly provided: { key: PortKey<unknown>; impl: unknown }[];
  readonly disposers: (() => void | Promise<void>)[];
}

function fakeContext(): FakeContext {
  const provided: { key: PortKey<unknown>; impl: unknown }[] = [];
  const disposers: (() => void | Promise<void>)[] = [];
  const ctx: PlatformContext = {
    providePort(key, impl) {
      provided.push({ key, impl });
    },
    port() {
      throw new Bug("port lookup is not used by platform-os");
    },
    onDispose(fn) {
      disposers.push(fn);
    },
  };
  return { ctx, provided, disposers };
}

describe("resolveOsDirs", () => {
  test("같은 규칙으로 위치만 정하고 아무것도 만들지 않는다", () => {
    const dirFs = fakeDirFs();
    const resolved = resolveOsDirs({ resourceDir: "/opt/xeon/resources" }, fakeRuntime({ dirFs }));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Bug("unreachable");
    expect(resolved.value.state).toBe("/home/u/.local/state/xeon");
    expect(resolved.value.resource).toBe("/opt/xeon/resources");
    expect(dirFs.made).toEqual([]);
  });

  test("관리 범위 덮어쓰기와 지원 밖 플랫폼 오류는 서비스 시작과 같다", () => {
    const root = resolveOsDirs(
      { resourceDir: "/opt/xeon/resources", dirsOverride: "/srv/xeon" },
      fakeRuntime(),
    );
    expect(root.ok && root.value.state).toBe("/srv/xeon/state");
    const unsupported = resolveOsDirs(
      { resourceDir: "/opt/xeon/resources" },
      fakeRuntime({
        probe: {
          platform: "freebsd",
          arch: "x64",
          release: "",
          wslDistro: undefined,
          procVersion: undefined,
        },
      }),
    );
    expect(unsupported).toEqual(err({ kind: "unsupported_platform", platform: "freebsd" }));
  });
});

describe("createOsService", () => {
  test("시작 순서: 플랫폼, 디렉터리 해석, 생성, 로거, 기계 식별자", async () => {
    const lines: string[] = [];
    const dirFs = fakeDirFs();
    const started = await createOsService(config(lines), fakeRuntime({ dirFs }));
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Bug("unreachable");
    const { service } = started.value;
    expect(service.info).toEqual({
      platform: "linux",
      arch: "x64",
      isWsl: false,
      release: "6.1.0",
    });
    expect(service.dirs.data).toBe("/home/u/.local/share/xeon");
    expect(service.dirs.resource).toBe("/opt/xeon/resources");
    expect(service.machineId).toBe("0123456789abcdef");
    expect(service.userId).toBe(1000);
    // runtime과 tmp가 같은 경로(/tmp/xeon-1000)면 한 번만 만든다
    expect(dirFs.made).toEqual([
      service.dirs.data,
      service.dirs.config,
      service.dirs.cache,
      service.dirs.state,
      service.dirs.runtime,
    ]);
    expect(service.dirs.runtime).toBe(service.dirs.tmp);
    expect(events(lines)).toEqual(["os.service.started"]);
    await started.value.dispose();
  });

  test("macOS는 libSystem.B.dylib 이름으로 dlopen을 시도하고, 되면 process_only 경고가 없다", async () => {
    const lines: string[] = [];
    const tried: string[] = [];
    const runtime = fakeRuntime({
      probe: {
        platform: "darwin",
        arch: "arm64",
        release: "25.0.0",
        wslDistro: undefined,
        procVersion: undefined,
      },
      createFlock: (selection) => {
        tried.push(selection.libName);
        return { tryLock: () => err({ kind: "held" }) };
      },
    });
    const started = await createOsService(config(lines), runtime);
    if (!started.ok) throw new Bug("unreachable");
    expect(tried).toEqual(["libSystem.B.dylib"]);
    expect(started.value.fileLock.scope).toBe("cross_process");
    expect(events(lines)).not.toContain("os.file_lock.process_only");
    await started.value.dispose();
  });

  test("dlopen이 정말 실패할 때만 process_only로 내려가고 경고를 남긴다", async () => {
    const lines: string[] = [];
    const started = await createOsService(
      config(lines),
      fakeRuntime({ createFlock: () => undefined }),
    );
    if (!started.ok) throw new Bug("unreachable");
    expect(started.value.fileLock.scope).toBe("process");
    expect(events(lines)).toEqual(["os.file_lock.process_only", "os.service.started"]);
    await started.value.dispose();
  });

  test("time은 주입한 시계·스케줄러·난수다", async () => {
    const runtime = fakeRuntime();
    const started = await createOsService(config([]), runtime);
    if (!started.ok) throw new Bug("unreachable");
    expect(started.value.service.time.clock).toBe(runtime.clock);
    expect(started.value.service.time.scheduler).toBe(runtime.scheduler);
    expect(started.value.service.time.random).toBe(runtime.random);
    await started.value.dispose();
  });

  test("지원 밖 플랫폼이면 아무것도 만들지 않고 실패한다", async () => {
    const dirFs = fakeDirFs();
    const runtime = fakeRuntime({
      dirFs,
      probe: {
        platform: "freebsd",
        arch: "x64",
        release: "",
        wslDistro: undefined,
        procVersion: undefined,
      },
    });
    const result = await createOsService(config([]), runtime);
    expect(result).toEqual(err({ kind: "unsupported_platform", platform: "freebsd" }));
    expect(dirFs.made).toEqual([]);
  });

  test("XEON_HOME이 상대 경로이면 실패한다(조용히 기본값으로 바꾸지 않는다)", async () => {
    const dirFs = fakeDirFs();
    const result = await createOsService(
      config([]),
      fakeRuntime({ dirFs, env: envOf({ PATH: "/usr/bin", XEON_HOME: "rel" }) }),
    );
    expect(result).toEqual(err({ kind: "not_absolute", dir: "data", path: "rel" }));
    expect(dirFs.made).toEqual([]);
  });

  test("dirsOverride(관리 설정)는 OS 기본보다 앞서고 XEON_HOME보다 뒤다", async () => {
    const managed = await createOsService(config([], { dirsOverride: "/managed" }), fakeRuntime());
    const both = await createOsService(
      config([], { dirsOverride: "/managed" }),
      fakeRuntime({ env: envOf({ PATH: "/usr/bin", XEON_HOME: "/envhome" }) }),
    );
    expect(managed.ok && managed.value.service.dirs.data).toBe("/managed/data");
    expect(both.ok && both.value.service.dirs.data).toBe("/envhome/data");
    if (managed.ok) await managed.value.dispose();
    if (both.ok) await both.value.dispose();
  });

  test("디렉터리 검사 실패(남의 디렉터리)는 서비스를 만들지 않는다", async () => {
    const foreign = fakeDirFs();
    const result = await createOsService(
      config([]),
      fakeRuntime({
        dirFs: {
          uid: 1000,
          stat: () => Promise.resolve(ok({ isDirectory: true, mode: 0o40_700, uid: 0 })),
          mkdir: (path, mode) => foreign.mkdir(path, mode),
        },
      }),
    );
    expect(!result.ok && result.error.kind).toBe("not_owned");
  });

  test("WSL에서 config가 /mnt 아래이면 경고 로그", async () => {
    const lines: string[] = [];
    const started = await createOsService(
      config(lines),
      fakeRuntime({
        probe: {
          platform: "linux",
          arch: "x64",
          release: "6.6-microsoft",
          wslDistro: "Ubuntu",
          procVersion: undefined,
        },
        env: envOf({ PATH: "/usr/bin", XDG_CONFIG_HOME: "/mnt/c/conf" }),
      }),
    );
    expect(started.ok).toBe(true);
    expect(events(lines)).toContain("os.dirs.config_on_drvfs");
    if (started.ok) await started.value.dispose();
  });

  test("logger(component): component 필드를 달고 레벨은 setLogLevel로 바뀐다", async () => {
    const lines: string[] = [];
    const started = await createOsService(config(lines), fakeRuntime());
    if (!started.ok) throw new Bug("unreachable");
    lines.length = 0;
    const log = started.value.service.logger("core-loop");
    log.debug("hidden");
    log.info("shown", { n: 1 });
    started.value.setLogLevel("debug");
    log.debug("now.shown");
    expect(parsed(lines).map((l) => [l["event"], l["component"]])).toEqual([
      ["shown", "core-loop"],
      ["now.shown", "core-loop"],
    ]);
    await started.value.dispose();
  });

  test("logLevel에 함수를 주면 로그를 낼 때마다 읽어 설정 변경이 다음 호출부터 반영된다", async () => {
    const lines: string[] = [];
    const setting: { level: "debug" | "info" | "warn" | "error" } = { level: "warn" };
    const started = await createOsService(
      config(lines, { logLevel: () => setting.level }),
      fakeRuntime(),
    );
    if (!started.ok) throw new Bug("unreachable");
    lines.length = 0;
    const log = started.value.service.logger("core-loop");
    log.info("hidden.at.warn");
    log.warn("shown.at.warn");
    setting.level = "debug";
    log.debug("shown.after.change");
    setting.level = "error";
    log.warn("hidden.again");
    log.error("shown.at.error");
    expect(events(lines)).toEqual(["shown.at.warn", "shown.after.change", "shown.at.error"]);
    // setLogLevel을 부르면 그 값으로 고정한다
    started.value.setLogLevel("info");
    setting.level = "error";
    log.info("fixed.info");
    expect(events(lines).at(-1)).toBe("fixed.info");
    await started.value.dispose();
  });

  test("logRedact가 서비스 로그에 적용된다", async () => {
    const lines: string[] = [];
    const started = await createOsService(
      config(lines, { logRedact: (line) => line.replaceAll("hunter2", "[REDACTED]") }),
      fakeRuntime(),
    );
    if (!started.ok) throw new Bug("unreachable");
    started.value.service.logger("x").info("login", { password: "hunter2" });
    expect(lines.join("\n")).not.toContain("hunter2");
    await started.value.dispose();
  });

  test("fsKind·resolveBinary는 서비스 메서드로 연결되어 있다", async () => {
    const started = await createOsService(
      config([]),
      fakeRuntime({
        env: envOf({ PATH: "/usr/bin" }),
        binaryFs: {
          readFile: () => Promise.resolve(err({ code: "ENOENT" })),
          isExecutableFile: (path) => Promise.resolve(path === "/usr/bin/git"),
        },
        run: () => Promise.resolve(ok({ exitCode: 0, stdout: "git version 2.43.0\n" })),
      }),
    );
    if (!started.ok) throw new Bug("unreachable");
    const { service } = started.value;
    expect(await service.resolveBinary("git", {}, signal)).toEqual(
      ok({ name: "git", path: "/usr/bin/git", version: "2.43.0", source: "system" }),
    );
    const missing = await service.resolveBinary("bwrap", {}, signal);
    expect(!missing.ok && missing.error.kind).toBe("not_found");
    const kind = await service.fsKind("/no/such/xeon-test-path", signal);
    expect(kind.ok || kind.error.kind === "not_found").toBe(true);
    await started.value.dispose();
  });

  test("M3 이전: notify는 disabled, 2차: watch는 backend_unavailable, telemetry는 꺼짐", async () => {
    const started = await createOsService(config([]), fakeRuntime());
    if (!started.ok) throw new Bug("unreachable");
    const { service } = started.value;
    expect(await service.notify({ kind: "done", title: "t", body: "" }, signal)).toEqual(
      err({ kind: "disabled" }),
    );
    const watch = await service.watch("/x", {}, () => {});
    expect(!watch.ok && watch.error.kind).toBe("backend_unavailable");
    expect(service.telemetry.enabled).toBe(false);
    expect(service.telemetry.tracer("xeon.l0.os")).toBeDefined();
    await started.value.dispose();
  });

  test("dispose: 남은 타이머 취소, 중단 신호, 마지막 로그, 두 번 불러도 한 번만", async () => {
    const lines: string[] = [];
    const runtime = fakeRuntime();
    const started = await createOsService(config(lines), runtime);
    if (!started.ok) throw new Bug("unreachable");
    let fired = 0;
    started.value.service.time.scheduler.setTimeout(() => (fired += 1), 5);
    expect(runtime.scheduler.pendingCount()).toBe(1);
    await started.value.dispose();
    await started.value.dispose();
    expect(runtime.scheduler.pendingCount()).toBe(0);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 15);
    });
    expect(fired).toBe(0);
    expect(events(lines).filter((e) => e === "os.service.stopped").length).toBe(1);
    expect(events(lines).at(-1)).toBe("os.service.stopped");
  });
});

describe("platformOsPlugin", () => {
  test("setup이 xeon.os 포트를 제공하고 dispose를 등록한다", async () => {
    const lines: string[] = [];
    const runtime = fakeRuntime();
    const plugin = platformOsPlugin(config(lines), runtime);
    expect(plugin.name).toBe("platform-os");
    const { ctx, provided, disposers } = fakeContext();
    await plugin.setup(ctx);
    expect(provided.length).toBe(1);
    expect(provided[0]?.key.name).toBe(OsServiceName);
    expect(provided[0]?.key.name).toBe("xeon.os");
    expect(disposers.length).toBe(1);
    expect(provided[0]?.impl).toMatchObject({ info: { platform: "linux" } });
    await disposers[0]?.();
    expect(events(lines).at(-1)).toBe("os.service.stopped");
  });

  test("시작에 실패하면 setup이 err를 돌려준다(포트를 제공하지 않는다)", async () => {
    const plugin = platformOsPlugin(
      config([]),
      fakeRuntime({
        probe: {
          platform: "sunos",
          arch: "x64",
          release: "",
          wslDistro: undefined,
          procVersion: undefined,
        },
      }),
    );
    const { ctx, provided } = fakeContext();
    const failure = await plugin.setup(ctx);
    expect(failure).toEqual({
      ok: false,
      error: {
        reason: "unsupported_platform",
        cause: { kind: "unsupported_platform", platform: "sunos" },
      },
    });
    expect(provided).toEqual([]);
  });
});

const posix = process.platform === "win32" ? test.skip : test;

describe("OsService (실제 OS, 격리된 환경)", () => {
  posix("XEON_HOME 아래에 0700 디렉터리를 만들고 서비스 값을 돌려준다", async () => {
    await withIsolatedEnv(async (env) => {
      const lines: string[] = [];
      const started = await createOsService(
        { resourceDir: env.home, logSink: (line) => lines.push(line), logRedact: (line) => line },
        // Bun의 os.homedir()는 처음 부른 값을 캐시하므로 격리된 HOME을 직접 넘긴다
        { ...readOsRuntime(), home: env.home },
      );
      if (!started.ok) throw new Bug(`start failed: ${started.error.kind}`);
      const { service } = started.value;
      expect(service.dirs.home).toBe(env.home);
      expect(service.dirs.data).toBe(`${env.vars["XEON_HOME"]}/data`);
      const dirs = [service.dirs.data, service.dirs.config, service.dirs.cache, service.dirs.state];
      const stats = await Promise.all(dirs.map((dir) => stat(dir)));
      expect(stats.map((st) => st.mode & 0o777)).toEqual(dirs.map(() => 0o700));
      expect(service.userId).toBe(process.getuid?.() ?? null);
      expect(service.machineId.length).toBeGreaterThan(0);
      expect(service.processStartFingerprint(process.pid).ok).toBe(true);
      const kind = await service.fsKind(service.dirs.data, signal);
      expect(kind.ok).toBe(true);
      // 새 경로(없는 하위 경로)도 상위로 판정한다
      expect(await service.fsKind(`${service.dirs.data}/no/such`, signal)).toEqual(kind);
      const git = await service.resolveBinary("git", {}, signal);
      expect(git.ok || git.error.kind === "not_found").toBe(true);
      if (git.ok) expect(git.value.version).toMatch(/^\d+\.\d+\.\d+$/);
      await started.value.dispose();
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  posix("거부되는 입력(상대 경로 XEON_HOME)은 실패한다", async () => {
    await withIsolatedEnv(async (env) => {
      process.env["XEON_HOME"] = "relative/path";
      const result = await createOsService(
        { resourceDir: env.home, logSink: () => {}, logRedact: (line) => line },
        { ...readOsRuntime(), home: env.home },
      );
      expect(!result.ok && result.error.kind).toBe("not_absolute");
    });
  });
});

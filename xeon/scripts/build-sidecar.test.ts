import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSidecar,
  checkSize,
  compileArgs,
  describeError,
  diagnoseBuildFailure,
  exitCodeOf,
  hostTriple,
  isBuildVersion,
  MIB,
  outputFileName,
  parseSidecarConfig,
  resolveTarget,
  type BuildError,
  type BuildIo,
  type SidecarConfig,
} from "./build-sidecar.ts";

const DESKTOP = "/work/apps/desktop";

const CONFIG: SidecarConfig = {
  name: "xeon",
  args: ["host", "--stdio"],
  entry: "../cli/src/main.ts",
  maxSizeMiB: 500,
  targets: {
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-apple-darwin": "bun-darwin-x64",
    "x86_64-unknown-linux-gnu": "bun-linux-x64",
    "aarch64-unknown-linux-gnu": "bun-linux-arm64",
    "x86_64-pc-windows-msvc": "bun-windows-x64",
  },
};

function realConfigText(): string {
  return readFileSync(join(import.meta.dir, "..", "apps", "desktop", "sidecar.json"), "utf8");
}

test("the committed sidecar.json parses and maps the five triples of the plan", () => {
  const parsed = parseSidecarConfig(realConfigText());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.name).toBe("xeon");
  expect(parsed.value.args).toEqual(["host", "--stdio"]);
  expect(parsed.value.maxSizeMiB).toBe(500);
  expect(parsed.value.targets).toEqual(CONFIG.targets);
});

test("config with a missing field, an unknown key or bad JSON is rejected", () => {
  const withoutName = JSON.stringify({ ...CONFIG, name: undefined });
  expect(parseSidecarConfig(withoutName).ok).toBe(false);
  expect(parseSidecarConfig(JSON.stringify({ ...CONFIG, extra: 1 })).ok).toBe(false);
  expect(parseSidecarConfig(JSON.stringify({ ...CONFIG, targets: { a: "node-linux" } })).ok).toBe(
    false,
  );
  expect(parseSidecarConfig(JSON.stringify({ ...CONFIG, maxSizeMiB: 0 })).ok).toBe(false);
  const broken = parseSidecarConfig("{not json");
  expect(broken.ok).toBe(false);
  if (!broken.ok) expect(broken.error.kind).toBe("config.invalid");
});

test("every triple resolves to its bun target and an unknown one lists the known ones", () => {
  for (const [triple, bunTarget] of Object.entries(CONFIG.targets)) {
    expect(resolveTarget(CONFIG, triple)).toEqual({ ok: true, value: { triple, bunTarget } });
  }
  const unknown = resolveTarget(CONFIG, "riscv64gc-unknown-linux-gnu");
  expect(unknown.ok).toBe(false);
  if (unknown.ok) return;
  expect(unknown.error.kind).toBe("triple.unknown");
  expect(describeError(unknown.error)).toContain("x86_64-unknown-linux-gnu");
});

test("output names follow the Tauri externalBin convention, .exe on Windows only", () => {
  expect(outputFileName("xeon", "aarch64-apple-darwin")).toBe("xeon-aarch64-apple-darwin");
  expect(outputFileName("xeon", "x86_64-unknown-linux-gnu")).toBe("xeon-x86_64-unknown-linux-gnu");
  expect(outputFileName("xeon", "x86_64-pc-windows-msvc")).toBe("xeon-x86_64-pc-windows-msvc.exe");
});

test("the host alias maps node platform and arch to a triple", () => {
  expect(hostTriple("linux", "x64")).toEqual({ ok: true, value: "x86_64-unknown-linux-gnu" });
  expect(hostTriple("linux", "arm64")).toEqual({ ok: true, value: "aarch64-unknown-linux-gnu" });
  expect(hostTriple("darwin", "arm64")).toEqual({ ok: true, value: "aarch64-apple-darwin" });
  expect(hostTriple("darwin", "x64")).toEqual({ ok: true, value: "x86_64-apple-darwin" });
  expect(hostTriple("win32", "x64")).toEqual({ ok: true, value: "x86_64-pc-windows-msvc" });
  const unsupported = hostTriple("freebsd", "x64");
  expect(unsupported.ok).toBe(false);
  if (!unsupported.ok) expect(exitCodeOf(unsupported.error)).toBe(2);
});

test("compile arguments carry --compile --minify --bytecode and the target; bytecode can be left out", () => {
  const base = { entry: "/e/main.ts", outFile: "/o/xeon-x", bunTarget: "bun-linux-x64" };
  expect(compileArgs({ ...base, bytecode: true })).toEqual([
    "build",
    "--compile",
    "--minify",
    "--bytecode",
    "--target=bun-linux-x64",
    "/e/main.ts",
    "--outfile",
    "/o/xeon-x",
  ]);
  expect(compileArgs({ ...base, bytecode: false })).not.toContain("--bytecode");
});

test("size cap: exactly 500 MiB passes, one byte more fails", () => {
  const max = 500 * MIB;
  expect(checkSize("f", max, max)).toEqual({ ok: true, value: max });
  const over = checkSize("f", max + 1, max);
  expect(over.ok).toBe(false);
  if (over.ok) return;
  expect(over.error).toEqual({ kind: "size.exceeded", path: "f", bytes: max + 1, maxBytes: max });
  expect(describeError(over.error)).toContain("500.0 MiB");
});

test("a top-level await failure gets a pointer to HOST.5 and CLI.5", () => {
  const stderr = 'error: "await" can only be used inside an "async" function\n  at main.ts:9';
  expect(diagnoseBuildFailure(stderr)).toContain("HOST.5");
  expect(diagnoseBuildFailure(stderr)).toContain("CLI.5");
  expect(diagnoseBuildFailure("error: Could not resolve")).toBeUndefined();
});

interface Calls {
  readonly args: string[][];
  readonly cwd: string[];
  readonly dirs: string[];
}

function fakeIo(options: {
  config?: string | undefined;
  run?: { exitCode: number; stderr: string } | Error;
  size?: number | undefined;
}): { io: BuildIo; calls: Calls } {
  const calls: Calls = { args: [], cwd: [], dirs: [] };
  const io: BuildIo = {
    readText: (path) => (path === `${DESKTOP}/sidecar.json` ? options.config : undefined),
    runBun: (args, cwd) => {
      calls.args.push([...args]);
      calls.cwd.push(cwd);
      return Promise.resolve(options.run ?? { exitCode: 0, stderr: "" });
    },
    fileSize: () => options.size,
    ensureDir: (path) => {
      calls.dirs.push(path);
    },
  };
  return { io, calls };
}

const CONFIG_TEXT = JSON.stringify(CONFIG);

test("a build runs bun with the mapped target and reports the size against the cap", async () => {
  const { io, calls } = fakeIo({ config: CONFIG_TEXT, size: 102 * MIB });
  const result = await buildSidecar(
    { desktopDir: DESKTOP, triple: "aarch64-apple-darwin", bytecode: true },
    io,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.bunTarget).toBe("bun-darwin-arm64");
  expect(result.value.outFile).toBe(`${DESKTOP}/src-tauri/binaries/xeon-aarch64-apple-darwin`);
  expect(result.value.bytes).toBe(102 * MIB);
  expect(result.value.maxBytes).toBe(500 * MIB);
  expect(calls.dirs).toEqual([`${DESKTOP}/src-tauri/binaries`]);
  expect(calls.cwd).toEqual([DESKTOP]);
  expect(calls.args[0]).toEqual([
    "build",
    "--compile",
    "--minify",
    "--bytecode",
    "--target=bun-darwin-arm64",
    "/work/apps/cli/src/main.ts",
    "--outfile",
    `${DESKTOP}/src-tauri/binaries/xeon-aarch64-apple-darwin`,
  ]);
});

test("an out-dir request writes there and leaves the development sidecar path alone", async () => {
  const { io, calls } = fakeIo({ config: CONFIG_TEXT, size: MIB });
  const result = await buildSidecar(
    { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: true, outDir: "/o/rel" },
    io,
  );
  expect(result.ok && result.value.outFile).toBe("/o/rel/xeon-x86_64-unknown-linux-gnu");
  expect(calls.dirs).toEqual(["/o/rel"]);
  expect(calls.args[0]?.at(-1)).toBe("/o/rel/xeon-x86_64-unknown-linux-gnu");
  expect(calls.args[0]?.join(" ")).not.toContain("src-tauri");
});

test("the Windows build writes an .exe", async () => {
  const { io } = fakeIo({ config: CONFIG_TEXT, size: 96 * MIB });
  const result = await buildSidecar(
    { desktopDir: DESKTOP, triple: "x86_64-pc-windows-msvc", bytecode: true },
    io,
  );
  expect(result.ok && result.value.outFile.endsWith("xeon-x86_64-pc-windows-msvc.exe")).toBe(true);
});

function failure(result: Awaited<ReturnType<typeof buildSidecar>>): BuildError {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

test("an unknown triple fails before bun runs", async () => {
  const { io, calls } = fakeIo({ config: CONFIG_TEXT });
  const error = failure(
    await buildSidecar({ desktopDir: DESKTOP, triple: "mips-unknown-linux", bytecode: true }, io),
  );
  expect(error.kind).toBe("triple.unknown");
  expect(exitCodeOf(error)).toBe(1);
  expect(calls.args).toEqual([]);
});

test("a missing or invalid sidecar.json is a config error", async () => {
  const missing = fakeIo({ config: undefined });
  expect(
    failure(await buildSidecar({ desktopDir: DESKTOP, triple: "x", bytecode: true }, missing.io))
      .kind,
  ).toBe("config.invalid");
  const invalid = fakeIo({ config: "{}" });
  expect(
    failure(await buildSidecar({ desktopDir: DESKTOP, triple: "x", bytecode: true }, invalid.io))
      .kind,
  ).toBe("config.invalid");
});

test("a compile failure keeps bun's message and adds the top-level await hint", async () => {
  const { io } = fakeIo({
    config: CONFIG_TEXT,
    run: { exitCode: 1, stderr: 'error: "await" can only be used inside an "async" function' },
  });
  const error = failure(
    await buildSidecar(
      { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: true },
      io,
    ),
  );
  expect(error.kind).toBe("build.failed");
  expect(exitCodeOf(error)).toBe(1);
  const text = describeError(error);
  expect(text).toContain("await");
  expect(text).toContain("HOST.5");
});

test("bun that cannot be started is an environment problem (exit 2)", async () => {
  const { io } = fakeIo({ config: CONFIG_TEXT, run: new Error("spawn bun ENOENT") });
  const error = failure(
    await buildSidecar(
      { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: true },
      io,
    ),
  );
  expect(error.kind).toBe("build.spawn");
  expect(exitCodeOf(error)).toBe(2);
});

test("a build that produced no file, or a file over the cap, fails", async () => {
  const none = fakeIo({ config: CONFIG_TEXT, size: undefined });
  expect(
    failure(
      await buildSidecar(
        { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: true },
        none.io,
      ),
    ).kind,
  ).toBe("output.missing");
  const big = fakeIo({ config: CONFIG_TEXT, size: 500 * MIB + 1 });
  const error = failure(
    await buildSidecar(
      { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: true },
      big.io,
    ),
  );
  expect(error.kind).toBe("size.exceeded");
  expect(exitCodeOf(error)).toBe(1);
});

test("--no-bytecode leaves the flag out of the bun call", async () => {
  const { io, calls } = fakeIo({ config: CONFIG_TEXT, size: 90 * MIB });
  await buildSidecar(
    { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: false },
    io,
  );
  expect(calls.args[0]).not.toContain("--bytecode");
  expect(calls.args[0]).toContain("--minify");
});

test("--version injects XEON_BUILD_VERSION as a --define string before the entry, and only when given", () => {
  const base = {
    entry: "/e/main.ts",
    outFile: "/o/xeon-x",
    bunTarget: "bun-linux-x64",
    bytecode: false,
  };
  expect(compileArgs({ ...base, version: "1.2.3" })).toEqual([
    "build",
    "--compile",
    "--minify",
    "--target=bun-linux-x64",
    "--define",
    'XEON_BUILD_VERSION="1.2.3"',
    "/e/main.ts",
    "--outfile",
    "/o/xeon-x",
  ]);
  expect(compileArgs(base)).not.toContain("--define");
  expect(compileArgs({ ...base, version: undefined })).not.toContain("--define");
});

test("isBuildVersion accepts x.y.z with an optional pre-release tail and rejects short, prefixed and shell-like forms", () => {
  const cases = ["1.2.3", "1.2.3-rc.1", "1.2", "v1.2.3", "1.2.3; rm"];
  expect(cases.map((version) => isBuildVersion(version))).toEqual([
    true,
    true,
    false,
    false,
    false,
  ]);
});

test("the release version of a build request reaches the bun arguments, and no version adds no define", async () => {
  const versioned = fakeIo({ config: CONFIG_TEXT, size: MIB });
  const built = await buildSidecar(
    { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: false, version: "1.2.3" },
    versioned.io,
  );
  expect(built.ok).toBe(true);
  expect(versioned.calls.args[0]).toContain('XEON_BUILD_VERSION="1.2.3"');

  const plain = fakeIo({ config: CONFIG_TEXT, size: MIB });
  await buildSidecar(
    { desktopDir: DESKTOP, triple: "x86_64-unknown-linux-gnu", bytecode: false },
    plain.io,
  );
  expect(plain.calls.args[0]).not.toContain("--define");
});

// 실제 컴파일 시험: 주입한 값이 바이너리 안 상수가 되고, 주입이 없으면 "0.0.0"이 된다. 소스 실행과 같은 `typeof` 모양이다
const VERSION_FIXTURE = [
  "declare const XEON_BUILD_VERSION: string | undefined;",
  'const VERSION: string = typeof XEON_BUILD_VERSION === "string" ? XEON_BUILD_VERSION : "0.0.0";',
  'process.stdout.write(VERSION + "\\n");',
].join("\n");

async function compileFixture(
  dir: string,
  name: string,
  version: string | undefined,
): Promise<string> {
  const config = parseSidecarConfig(realConfigText());
  if (!config.ok) throw new Error("the committed sidecar.json must parse");
  const triple = hostTriple(process.platform, process.arch);
  if (!triple.ok) throw new Error("this host has no sidecar triple");
  const target = resolveTarget(config.value, triple.value);
  if (!target.ok) throw new Error("this host triple has no bun target");
  const outFile = join(dir, name);
  const args = compileArgs({
    entry: join(dir, "main.ts"),
    outFile,
    bunTarget: target.value.bunTarget,
    bytecode: false,
    version,
  });
  const child = Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`bun build failed: ${stderr}`);
  return outFile;
}

async function printedBy(path: string): Promise<string> {
  const child = Bun.spawn([path], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(exitCode).toBe(0);
  return stdout.trim();
}

test("a compiled binary carries the injected version, and reports 0.0.0 without one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xeon-version-bin-"));
  try {
    writeFileSync(join(dir, "main.ts"), VERSION_FIXTURE);
    const injected = await compileFixture(dir, "with-version", "9.8.7");
    const plain = await compileFixture(dir, "no-version", undefined);
    expect(await printedBy(injected)).toBe("9.8.7");
    expect(await printedBy(plain)).toBe("0.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

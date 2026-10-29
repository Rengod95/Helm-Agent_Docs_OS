#!/usr/bin/env bun
// Sidecar build (m2-plan DESK.3, L4.desktop.plan 2.1, D3). Compiles the engine entry named in
// apps/desktop/sidecar.json with `bun build --compile --minify --bytecode` for one Rust target triple and
// checks the size cap. Output: apps/desktop/src-tauri/binaries/<name>-<triple>[.exe] (not committed, TC-05).
//   build-sidecar <triple|host> [--no-bytecode] [--version x.y.z]
// `--version` defines the string constant XEON_BUILD_VERSION (bun build --define); CLI_VERSION and ENGINE_VERSION read it.
//   build-sidecar --list
// Decision (user, 2026-10-24): start-up and response speed come before binary size. The size cap only catches
// regressions (500 MiB per triple), it is not a size target.
// `--bytecode` rejects top-level await ("await" can only be used inside an "async" function). The entry and
// everything it imports must not use it (HOST.5, CLI.5). `--no-bytecode` builds without it for diagnosis; that
// binary is not the release configuration.
// This file imports no workspace package (eng.dependency-rules.guide section 1); shared values live in sidecar.json.
// Exit codes: 0 built, 1 fix (config, unknown triple, compile error, size cap), 2 environment (bun cannot run,
// unsupported host).
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import { Check } from "typebox/value";

export const MIB: number = 1024 * 1024;

const SidecarConfigSchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
    args: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    entry: Type.String({ minLength: 1 }),
    maxSizeMiB: Type.Integer({ minimum: 1 }),
    targets: Type.Record(Type.String({ minLength: 1 }), Type.String({ pattern: "^bun-" }), {
      minProperties: 1,
    }),
  },
  { additionalProperties: false },
);
/** The shape of apps/desktop/sidecar.json. */
export interface SidecarConfig {
  readonly name: string;
  readonly args: readonly string[];
  /** Relative to apps/desktop. */
  readonly entry: string;
  readonly maxSizeMiB: number;
  /** Rust target triple -> bun compile target. */
  readonly targets: Readonly<Record<string, string>>;
}

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type BuildError =
  | { readonly kind: "config.invalid"; readonly message: string }
  | { readonly kind: "triple.unknown"; readonly triple: string; readonly known: readonly string[] }
  | { readonly kind: "host.unsupported"; readonly platform: string; readonly arch: string }
  | {
      readonly kind: "build.failed";
      readonly exitCode: number;
      readonly stderr: string;
      readonly hint: string | undefined;
    }
  | { readonly kind: "build.spawn"; readonly message: string }
  | { readonly kind: "output.missing"; readonly path: string }
  | {
      readonly kind: "size.exceeded";
      readonly path: string;
      readonly bytes: number;
      readonly maxBytes: number;
    };

export interface BuildReport {
  readonly triple: string;
  readonly bunTarget: string;
  readonly outFile: string;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly bytecode: boolean;
}

const fail = <E>(error: E): { readonly ok: false; readonly error: E } => ({ ok: false, error });
const succeed = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

/** Reads sidecar.json text. The file is a boundary input, so it is parsed and checked, not asserted. */
export function parseSidecarConfig(text: string): Result<SidecarConfig, BuildError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return fail({ kind: "config.invalid", message: `sidecar.json is not JSON: ${reason}` });
  }
  if (!Check(SidecarConfigSchema, data)) {
    return fail({
      kind: "config.invalid",
      message: "sidecar.json does not match { name, args, entry, maxSizeMiB, targets }",
    });
  }
  return succeed(data);
}

export interface ResolvedTarget {
  readonly triple: string;
  readonly bunTarget: string;
}

/** Maps a Rust target triple to the bun compile target. */
export function resolveTarget(
  config: SidecarConfig,
  triple: string,
): Result<ResolvedTarget, BuildError> {
  const bunTarget = config.targets[triple];
  if (bunTarget === undefined) {
    return fail({ kind: "triple.unknown", triple, known: Object.keys(config.targets) });
  }
  return succeed({ triple, bunTarget });
}

/** The Rust triple of the machine running the script, for the `host` alias. */
export function hostTriple(platform: string, arch: string): Result<string, BuildError> {
  const key = `${platform}/${arch}`;
  const known: Readonly<Record<string, string>> = {
    "darwin/arm64": "aarch64-apple-darwin",
    "darwin/x64": "x86_64-apple-darwin",
    "linux/x64": "x86_64-unknown-linux-gnu",
    "linux/arm64": "aarch64-unknown-linux-gnu",
    "win32/x64": "x86_64-pc-windows-msvc",
  };
  const triple = known[key];
  return triple === undefined
    ? fail({ kind: "host.unsupported", platform, arch })
    : succeed(triple);
}

/** `<name>-<triple>`, with `.exe` for Windows triples (Tauri externalBin naming, adr.0008 3.2). */
export function outputFileName(name: string, triple: string): string {
  return triple.includes("-windows-") ? `${name}-${triple}.exe` : `${name}-${triple}`;
}

/** The global the build defines (`--define`). `apps/cli` and `apps/host` read it as `typeof XEON_BUILD_VERSION`. */
export const VERSION_DEFINE_NAME = "XEON_BUILD_VERSION";

/** Plain dotted version with an optional pre-release tail; the same rule as release.ts `isSafeVersion`. */
export function isBuildVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version);
}

export interface CompileOptions {
  readonly entry: string;
  readonly outFile: string;
  readonly bunTarget: string;
  readonly bytecode: boolean;
  /** Injected as the string constant `XEON_BUILD_VERSION`. Without it the binary reports "0.0.0". */
  readonly version?: string | undefined;
}

/** Arguments after the `bun` executable. */
export function compileArgs(options: CompileOptions): string[] {
  return [
    "build",
    "--compile",
    "--minify",
    ...(options.bytecode ? ["--bytecode"] : []),
    `--target=${options.bunTarget}`,
    ...(options.version === undefined
      ? []
      : ["--define", `${VERSION_DEFINE_NAME}=${JSON.stringify(options.version)}`]),
    options.entry,
    "--outfile",
    options.outFile,
  ];
}

export function checkSize(
  path: string,
  bytes: number,
  maxBytes: number,
): Result<number, BuildError> {
  return bytes > maxBytes ? fail({ kind: "size.exceeded", path, bytes, maxBytes }) : succeed(bytes);
}

export function formatMiB(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

const TOP_LEVEL_AWAIT = /"await" can only be used inside an "async" function|top-level await/i;

/** A recognised compile failure gets a pointer to the fix instead of only bun's message. */
export function diagnoseBuildFailure(stderr: string): string | undefined {
  if (TOP_LEVEL_AWAIT.test(stderr)) {
    return "--bytecode rejects top-level await. Replace it with an async main() called from a .catch() (HOST.5 apps/host/src/main.ts, CLI.5 apps/cli/src/main.ts, L4.cli.plan 4.3). `--no-bytecode` builds without it for diagnosis only.";
  }
  return undefined;
}

export interface BuildIo {
  readText(path: string): string | undefined;
  /** Runs the bun executable with `args` in `cwd`. A spawn failure is an Error value, a non-zero exit is not. */
  runBun(
    args: readonly string[],
    cwd: string,
  ): Promise<{ exitCode: number; stderr: string } | Error>;
  fileSize(path: string): number | undefined;
  ensureDir(path: string): void;
}

export interface BuildRequest {
  /** apps/desktop */
  readonly desktopDir: string;
  readonly triple: string;
  readonly bytecode: boolean;
  /** The release version to inject; undefined builds the "0.0.0" development binary. */
  readonly version?: string | undefined;
}

/** Compiles the sidecar for one triple and checks the size cap. Nothing is thrown for expected failures. */
export async function buildSidecar(
  request: BuildRequest,
  io: BuildIo,
): Promise<Result<BuildReport, BuildError>> {
  const configPath = join(request.desktopDir, "sidecar.json");
  const text = io.readText(configPath);
  if (text === undefined) {
    return fail({ kind: "config.invalid", message: `${configPath} is missing` });
  }
  const config = parseSidecarConfig(text);
  if (!config.ok) return config;
  const target = resolveTarget(config.value, request.triple);
  if (!target.ok) return target;

  const outFile = join(
    request.desktopDir,
    "src-tauri",
    "binaries",
    outputFileName(config.value.name, target.value.triple),
  );
  io.ensureDir(dirname(outFile));
  const args = compileArgs({
    entry: resolve(request.desktopDir, config.value.entry),
    outFile,
    bunTarget: target.value.bunTarget,
    bytecode: request.bytecode,
    version: request.version,
  });
  const run = await io.runBun(args, request.desktopDir);
  if (run instanceof Error) return fail({ kind: "build.spawn", message: run.message });
  if (run.exitCode !== 0) {
    return fail({
      kind: "build.failed",
      exitCode: run.exitCode,
      stderr: run.stderr,
      hint: diagnoseBuildFailure(run.stderr),
    });
  }
  const bytes = io.fileSize(outFile);
  if (bytes === undefined) return fail({ kind: "output.missing", path: outFile });
  const maxBytes = config.value.maxSizeMiB * MIB;
  const size = checkSize(outFile, bytes, maxBytes);
  if (!size.ok) return size;
  return succeed({
    triple: target.value.triple,
    bunTarget: target.value.bunTarget,
    outFile,
    bytes,
    maxBytes,
    bytecode: request.bytecode,
  });
}

/** 1 = fix the code or the config, 2 = environment problem (report, do not edit code). */
export function exitCodeOf(error: BuildError): 1 | 2 {
  switch (error.kind) {
    case "host.unsupported":
    case "build.spawn":
      return 2;
    case "config.invalid":
    case "triple.unknown":
    case "build.failed":
    case "output.missing":
    case "size.exceeded":
      return 1;
    default:
      return assertNever(error);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled build error: ${JSON.stringify(value)}`);
}

export function describeError(error: BuildError): string {
  switch (error.kind) {
    case "config.invalid":
      return error.message;
    case "triple.unknown":
      return `unknown triple ${error.triple}; known: ${error.known.join(", ")}`;
    case "host.unsupported":
      return `no sidecar target for host ${error.platform}/${error.arch}; pass a triple explicitly`;
    case "build.failed":
      return [`bun build exited with ${String(error.exitCode)}`, error.stderr.trim(), error.hint]
        .filter((part): part is string => part !== undefined && part !== "")
        .join("\n");
    case "build.spawn":
      return `could not run bun: ${error.message}`;
    case "output.missing":
      return `bun build reported success but ${error.path} does not exist`;
    case "size.exceeded":
      return `${error.path} is ${formatMiB(error.bytes)}, over the ${formatMiB(error.maxBytes)} cap (sidecar.json maxSizeMiB). Find what grew before raising the cap.`;
    default:
      return assertNever(error);
  }
}

function realIo(): BuildIo {
  return {
    readText(path) {
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
    async runBun(args, cwd) {
      try {
        const child = Bun.spawn([process.execPath, ...args], {
          cwd,
          stdout: "inherit",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stderr };
      } catch (cause) {
        return cause instanceof Error ? cause : new Error(String(cause));
      }
    },
    fileSize(path) {
      return existsSync(path) ? statSync(path).size : undefined;
    },
    ensureDir(path) {
      mkdirSync(path, { recursive: true });
    },
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      "no-bytecode": { type: "boolean", default: false },
      version: { type: "string" },
      list: { type: "boolean", default: false },
    },
  });
  const xeonRoot = resolve(import.meta.dir, "..");
  const desktopDir = join(xeonRoot, "apps", "desktop");
  const io = realIo();

  if (values.list) {
    const text = io.readText(join(desktopDir, "sidecar.json"));
    const config = text === undefined ? undefined : parseSidecarConfig(text);
    if (config === undefined || !config.ok) {
      process.stderr.write("build-sidecar: sidecar.json is missing or invalid\n");
      process.exit(1);
    }
    for (const [triple, bunTarget] of Object.entries(config.value.targets)) {
      process.stdout.write(
        `${triple}\t${bunTarget}\t${outputFileName(config.value.name, triple)}\n`,
      );
    }
    process.exit(0);
  }

  const requested = positionals[0];
  if (requested === undefined || positionals.length > 1) {
    process.stderr.write(
      "usage: build-sidecar <triple|host> [--no-bytecode] [--version x.y.z] | --list\n",
    );
    process.exit(1);
  }
  if (values.version !== undefined && !isBuildVersion(values.version)) {
    process.stderr.write(`build-sidecar: --version must look like 1.2.3 or 1.2.3-rc.1\n`);
    process.exit(1);
  }
  const triple =
    requested === "host" ? hostTriple(process.platform, process.arch) : succeed(requested);
  if (!triple.ok) {
    process.stderr.write(`build-sidecar: ${describeError(triple.error)}\n`);
    process.exit(exitCodeOf(triple.error));
  }
  const bytecode = !values["no-bytecode"];
  if (!bytecode) {
    process.stderr.write("build-sidecar: WARNING --no-bytecode is not the release configuration\n");
  }
  const result = await buildSidecar(
    { desktopDir, triple: triple.value, bytecode, version: values.version },
    io,
  );
  if (!result.ok) {
    process.stderr.write(`build-sidecar: ${describeError(result.error)}\n`);
    process.exit(exitCodeOf(result.error));
  }
  const report = result.value;
  process.stdout.write(
    `build-sidecar: ${report.triple} (${report.bunTarget}${report.bytecode ? ", bytecode" : ""}) -> ${relative(xeonRoot, report.outFile)}  ${formatMiB(report.bytes)} / ${formatMiB(report.maxBytes)}\n`,
  );
}

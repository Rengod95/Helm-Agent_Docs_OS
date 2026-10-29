#!/usr/bin/env bun
// Release build (L4.release.spec). Builds the sidecar binary for one target triple and lays out the resource directory next
// to it, then packs one archive per target:
//   xeon-<version>-<triple>/
//     xeon                         the compiled binary (the resource directory is its parent, hostResourceDir())
//     group-kit/templates/         group templates for `xeon group new` (locateGroupTemplates)
//     default-plugins/<name>/      default plugin bundles (installDefaultPlugins)
//     binaries/<name> + binaries.lock.json   bundled external binaries (macOS only, L0.os.spec 3.6)
//     THIRD-PARTY-NOTICES.txt, SHA256SUMS
//   release   <triple|host> [--version <v>] [--out <dir>] [--binaries-dir <dir>] [--no-build]
// `--binaries-dir` is where sops, age and rg of the pinned versions already are (a macOS target needs it; the other targets
// ignore it). `--no-build` reuses the sidecar binary that build-sidecar left. Signing (release-sign.sh) runs inside this script before the hashes are taken and skips without secrets.
// This file imports no workspace package (eng.dependency-rules.guide section 1); shared values live in release-bundle.json.
// Exit codes: 0 built, 1 fix (config, missing input, build failure), 2 environment (unsupported host, tar missing).
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { hostTriple, outputFileName } from "./build-sidecar.ts";

const BundledBinarySchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
    version: Type.String({ minLength: 1 }),
    license: Type.String({ minLength: 1 }),
    source: Type.String({ pattern: "^https://" }),
  },
  { additionalProperties: false },
);
const BundleConfigSchema = Type.Object(
  {
    templates: Type.String({ minLength: 1 }),
    defaultPlugins: Type.Array(
      Type.Object(
        { name: Type.String({ minLength: 1 }), buildScript: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    bundledBinaries: Type.Record(
      Type.String({ minLength: 1 }),
      Type.Object(
        {
          platform: Type.String({ minLength: 1 }),
          arch: Type.String({ minLength: 1 }),
          binaries: Type.Array(BundledBinarySchema, { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    systemRequired: Type.Record(Type.String(), Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export interface BundledBinary {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly source: string;
}
export interface BundleConfig {
  /** Relative to xeon/. */
  readonly templates: string;
  readonly defaultPlugins: readonly { readonly name: string; readonly buildScript: string }[];
  /** Rust target triple -> binaries the archive bundles. */
  readonly bundledBinaries: Readonly<
    Record<
      string,
      {
        readonly platform: string;
        readonly arch: string;
        readonly binaries: readonly BundledBinary[];
      }
    >
  >;
  /** Platform key (linux, darwin) -> binaries taken from the system. */
  readonly systemRequired: Readonly<Record<string, readonly string[]>>;
}

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type ReleaseError =
  | { readonly kind: "config.invalid"; readonly message: string }
  | { readonly kind: "binary.missing"; readonly name: string; readonly dir: string }
  | {
      readonly kind: "binary.version";
      readonly name: string;
      readonly want: string;
      readonly got: string;
    }
  | { readonly kind: "input.missing"; readonly path: string }
  | { readonly kind: "step.failed"; readonly step: string; readonly exitCode: number }
  | { readonly kind: "host.unsupported"; readonly platform: string; readonly arch: string }
  | { readonly kind: "tool.missing"; readonly name: string };

const fail = <E>(error: E): { readonly ok: false; readonly error: E } => ({ ok: false, error });
const succeed = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

export function parseBundleConfig(text: string): Result<BundleConfig, ReleaseError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    return fail({
      kind: "config.invalid",
      message: cause instanceof Error ? cause.message : "bad JSON",
    });
  }
  if (!Check(BundleConfigSchema, data)) {
    return fail({
      kind: "config.invalid",
      message: "release-bundle.json does not match its schema",
    });
  }
  return succeed(data);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The body of binaries.lock.json (same shape as L0.os generateBinariesLock: entries sorted by name). */
export function lockBody(
  entries: readonly {
    readonly binary: BundledBinary;
    readonly platform: string;
    readonly arch: string;
    readonly path: string;
    readonly sha256: string;
  }[],
): string {
  const sorted = entries.toSorted((a, b) => a.binary.name.localeCompare(b.binary.name));
  const binaries = sorted.map((e) => ({
    name: e.binary.name,
    platform: e.platform,
    arch: e.arch,
    path: e.path,
    sha256: e.sha256,
    version: e.binary.version,
  }));
  return `${JSON.stringify({ binaries }, null, 2)}\n`;
}

/** SHA256SUMS lines (`<hex>  <relative path>`), sorted by path, for every file under `files`. */
export function sumsBody(
  files: readonly { readonly path: string; readonly sha256: string }[],
): string {
  return files
    .toSorted((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.sha256}  ${f.path}\n`)
    .join("");
}

/** The notices text: one block per bundled binary (name, version, license, source), then the system requirements. */
export function noticesBody(
  version: string,
  triple: string,
  bundled: readonly BundledBinary[],
  systemRequired: readonly string[],
): string {
  const lines = [`Xeon ${version} (${triple}) third-party notices`, ""];
  if (bundled.length === 0) lines.push("Bundled external binaries: none.");
  for (const b of bundled) {
    lines.push(`${b.name} ${b.version}`, `  license: ${b.license}`, `  source:  ${b.source}`, "");
  }
  if (systemRequired.length > 0) {
    lines.push(
      `Required from the system, not bundled: ${systemRequired.join(", ")}.`,
      "Install them with the package manager (`xeon doctor` prints the command).",
    );
  }
  lines.push("", "The full license texts are in the sources above.", "");
  return lines.join("\n");
}

export function archiveName(version: string, triple: string): string {
  return `xeon-${version}-${triple}.tar.gz`;
}

/** Version is part of file names and paths: only a plain dotted version with an optional pre-release tail. */
export function isSafeVersion(version: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version);
}

function listFiles(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, full));
    else if (entry.isFile()) out.push(relative(root, full));
  }
  return out;
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

async function run(
  step: string,
  cmd: readonly string[],
  cwd: string,
): Promise<Result<true, ReleaseError>> {
  const child = Bun.spawn([...cmd], { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await child.exited;
  return exitCode === 0 ? succeed(true) : fail({ kind: "step.failed", step, exitCode });
}

async function versionOf(path: string): Promise<string> {
  const child = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(child.stdout).text();
  await child.exited;
  return text;
}

export interface ReleaseRequest {
  readonly xeonRoot: string;
  readonly triple: string;
  readonly version: string;
  readonly outDir: string;
  readonly binariesDir: string | undefined;
  readonly build: boolean;
}

/** Lays out and packs one release. Returns the archive path. */
export async function buildRelease(request: ReleaseRequest): Promise<Result<string, ReleaseError>> {
  const { xeonRoot, triple, version } = request;
  const configPath = join(xeonRoot, "scripts", "release-bundle.json");
  const config = parseBundleConfig(readFileSync(configPath, "utf8"));
  if (!config.ok) return config;
  const target = config.value.bundledBinaries[triple];
  if (target === undefined && triple.includes("-apple-")) {
    return fail({
      kind: "config.invalid",
      message: `no bundled binaries are configured for ${triple} (Intel macOS is not built)`,
    });
  }
  const bundled = target?.binaries ?? [];

  if (request.build) {
    const built = await run(
      "build-sidecar",
      [process.execPath, join("scripts", "build-sidecar.ts"), triple],
      xeonRoot,
    );
    if (!built.ok) return built;
  }
  const sidecar = join(
    xeonRoot,
    "apps",
    "desktop",
    "src-tauri",
    "binaries",
    outputFileName("xeon", triple),
  );
  if (!existsSync(sidecar)) return fail({ kind: "input.missing", path: sidecar });

  const stage = join(request.outDir, `xeon-${version}-${triple}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const binaryName = triple.includes("-windows-") ? "xeon.exe" : "xeon";
  copyFileSync(sidecar, join(stage, binaryName));
  chmodSync(join(stage, binaryName), 0o755);

  const templates = join(xeonRoot, config.value.templates);
  if (!existsSync(join(templates, "index.json")))
    return fail({ kind: "input.missing", path: templates });
  copyTree(templates, join(stage, "group-kit", "templates"));

  const pluginSteps = await config.value.defaultPlugins.reduce<Promise<Result<true, ReleaseError>>>(
    async (previous, plugin) => {
      const before = await previous;
      if (!before.ok) return before;
      return run(
        `plugin ${plugin.name}`,
        [process.execPath, plugin.buildScript, join(stage, "default-plugins", plugin.name)],
        xeonRoot,
      );
    },
    Promise.resolve(succeed(true)),
  );
  if (!pluginSteps.ok) return pluginSteps;

  if (target !== undefined) {
    const dir = request.binariesDir;
    const versions = await Promise.all(
      bundled.map((binary) =>
        dir !== undefined && existsSync(join(dir, binary.name))
          ? versionOf(join(dir, binary.name))
          : Promise.resolve(""),
      ),
    );
    for (const [index, binary] of bundled.entries()) {
      const source = dir === undefined ? undefined : join(dir, binary.name);
      if (dir === undefined || source === undefined || !existsSync(source)) {
        return fail({
          kind: "binary.missing",
          name: binary.name,
          dir: dir ?? "(no --binaries-dir)",
        });
      }
      const got = versions[index] ?? "";
      if (!got.includes(binary.version)) {
        return fail({
          kind: "binary.version",
          name: binary.name,
          want: binary.version,
          got: got.split("\n")[0] ?? "",
        });
      }
      mkdirSync(join(stage, "binaries"), { recursive: true });
      copyFileSync(source, join(stage, "binaries", binary.name));
      chmodSync(join(stage, "binaries", binary.name), 0o755);
    }
  }

  // Signing rewrites the files, so it runs before any hash is taken. It skips (exit 0) when the secrets are absent.
  if (triple.includes("-apple-")) {
    const signed = await run(
      "sign",
      [join(xeonRoot, "scripts", "release-sign.sh"), stage],
      xeonRoot,
    );
    if (!signed.ok) return signed;
  }

  if (target !== undefined) {
    const lock = bundled.map((binary) => {
      const path = join("binaries", binary.name);
      return {
        binary,
        platform: target.platform,
        arch: target.arch,
        path,
        sha256: sha256Hex(readFileSync(join(stage, path))),
      };
    });
    writeFileSync(join(stage, "binaries.lock.json"), lockBody(lock));
  }

  const platformKey = triple.includes("-linux-")
    ? "linux"
    : triple.includes("-apple-")
      ? "darwin"
      : "other";
  writeFileSync(
    join(stage, "THIRD-PARTY-NOTICES.txt"),
    noticesBody(version, triple, bundled, config.value.systemRequired[platformKey] ?? []),
  );

  const files = listFiles(stage).map((path) => ({
    path,
    sha256: sha256Hex(readFileSync(join(stage, path))),
  }));
  writeFileSync(join(stage, "SHA256SUMS"), sumsBody(files));

  const archive = join(request.outDir, archiveName(version, triple));
  const tar = await run(
    "tar",
    ["tar", "-czf", archive, "-C", request.outDir, `xeon-${version}-${triple}`],
    xeonRoot,
  );
  if (!tar.ok) return tar;
  writeFileSync(
    `${archive}.sha256`,
    `${sha256Hex(readFileSync(archive))}  ${archiveName(version, triple)}\n`,
  );
  return succeed(archive);
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected value ${JSON.stringify(value)}`);
}

export function exitCodeOf(error: ReleaseError): 1 | 2 {
  return error.kind === "host.unsupported" || error.kind === "tool.missing" ? 2 : 1;
}

export function describeError(error: ReleaseError): string {
  switch (error.kind) {
    case "config.invalid":
      return `release-bundle.json is invalid: ${error.message}`;
    case "binary.missing":
      return `bundled binary ${error.name} not found in ${error.dir} (pass --binaries-dir with sops, age and rg)`;
    case "binary.version":
      return `bundled binary ${error.name} must be ${error.want}, found "${error.got}"`;
    case "input.missing":
      return `missing input ${error.path}`;
    case "step.failed":
      return `step ${error.step} failed with exit ${String(error.exitCode)}`;
    case "host.unsupported":
      return `unsupported host ${error.platform}/${error.arch}`;
    case "tool.missing":
      return `tool ${error.name} is missing`;
    default:
      return assertNever(error);
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      version: { type: "string", default: "0.0.0" },
      out: { type: "string" },
      "binaries-dir": { type: "string" },
      "no-build": { type: "boolean", default: false },
    },
  });
  const xeonRoot = resolve(import.meta.dir, "..");
  const requested = positionals[0];
  if (requested === undefined || positionals.length > 1 || !isSafeVersion(values.version)) {
    process.stderr.write(
      "usage: release <triple|host> [--version x.y.z] [--out dir] [--binaries-dir dir] [--no-build]\n",
    );
    process.exit(1);
  }
  const triple =
    requested === "host" ? hostTriple(process.platform, process.arch) : succeed(requested);
  if (!triple.ok) {
    process.stderr.write("release: unsupported host\n");
    process.exit(2);
  }
  const outDir = resolve(values.out ?? join(xeonRoot, "dist", "release"));
  mkdirSync(outDir, { recursive: true });
  const result = await buildRelease({
    xeonRoot,
    triple: triple.value,
    version: values.version,
    outDir,
    binariesDir: values["binaries-dir"] === undefined ? undefined : resolve(values["binaries-dir"]),
    build: !values["no-build"],
  });
  if (!result.ok) {
    process.stderr.write(`release: ${describeError(result.error)}\n`);
    process.exit(exitCodeOf(result.error));
  }
  const bytes = statSync(result.value).size;
  process.stdout.write(`release: ${relative(xeonRoot, result.value)} (${String(bytes)} bytes)\n`);
}

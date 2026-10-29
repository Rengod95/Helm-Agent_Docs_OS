#!/usr/bin/env bun
// Release smoke (X11, L4.release.spec 6). Takes the archive that release.ts wrote and checks what a user gets, with the same
// inputs on Linux x86_64 CI and the GitHub macOS arm64 job:
//   1. the archive matches its .sha256 file and every file matches SHA256SUMS
//   2. the layout: binary, group templates, both default plugins, notices; binaries.lock.json only for a macOS archive,
//      every entry matches its file
//   3. the binary starts: `xeon version`, `xeon group new` without XEON_GROUP_TEMPLATES_DIR (the compiled binary finds the
//      templates through its resource directory), `xeon doctor` names the external binaries (macOS: sops, age, rg as bundled)
//   4. @swc/core is not inside the binary (DR-07)
//   release-smoke <archive>
// This file imports no workspace package. Exit codes: 0 every check passed, 1 a check failed, 2 environment (tar missing).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface SmokeFailure {
  readonly check: string;
  readonly detail: string;
}

/** `xeon-<version>-<triple>.tar.gz` -> its parts. undefined for any other name. */
export function parseArchiveName(
  name: string,
): { readonly version: string; readonly triple: string } | undefined {
  const found =
    /^xeon-([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?)-([a-z0-9_]+-[a-z]+-[a-z0-9-]+)\.tar\.gz$/.exec(
      name,
    );
  const version = found?.[1];
  const triple = found?.[2];
  return version === undefined || triple === undefined ? undefined : { version, triple };
}

/** Parses `<hex>  <path>` lines. undefined when a line is malformed. */
export function parseSums(
  text: string,
): readonly { readonly sha256: string; readonly path: string }[] | undefined {
  const out: { sha256: string; path: string }[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const found = /^([0-9a-f]{64})  (.+)$/.exec(line);
    const sha256 = found?.[1];
    const path = found?.[2];
    if (sha256 === undefined || path === undefined || path.startsWith("/") || path.includes(".."))
      return undefined;
    out.push({ sha256, path });
  }
  return out;
}

/** The layout every archive has, relative to the stage directory; the macOS archive adds the lock and binaries. */
export function requiredPaths(triple: string): readonly string[] {
  const common = [
    triple.includes("-windows-") ? "xeon.exe" : "xeon",
    "group-kit/templates/index.json",
    "default-plugins/helm/.xeon-plugin/plugin.json",
    "default-plugins/account-rotation/.xeon-plugin/plugin.json",
    "THIRD-PARTY-NOTICES.txt",
    "SHA256SUMS",
  ];
  return triple.includes("-apple-")
    ? [...common, "binaries.lock.json", "binaries/sops", "binaries/age", "binaries/rg"]
    : common;
}

const sha256Of = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

interface Ran {
  readonly exitCode: number;
  readonly output: string;
}

async function runXeon(
  binary: string,
  args: readonly string[],
  cwd: string,
  home: string,
): Promise<Ran> {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    XEON_HOME: join(home, "xeon-home"),
    XDG_RUNTIME_DIR: join(home, "run"),
  };
  mkdirSync(join(home, "run"), { recursive: true, mode: 0o700 });
  const child = Bun.spawn([binary, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${out}${err}` };
}

/** Runs every check on one archive. An empty list means the smoke passed. */
export async function smoke(archive: string): Promise<readonly SmokeFailure[]> {
  const failures: SmokeFailure[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    if (!ok) failures.push({ check: name, detail });
  };
  const parsed = parseArchiveName(basename(archive));
  if (parsed === undefined) return [{ check: "archive.name", detail: basename(archive) }];
  const { version, triple } = parsed;

  const sidecarSum = `${archive}.sha256`;
  check(
    "archive.sha256",
    existsSync(sidecarSum) && readFileSync(sidecarSum, "utf8").startsWith(`${sha256Of(archive)}  `),
    sidecarSum,
  );

  const work = mkdtempSync(join(tmpdir(), "xeon-release-smoke-"));
  try {
    const tar = Bun.spawn(["tar", "-xzf", archive, "-C", work], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const tarErr = await new Response(tar.stderr).text();
    if ((await tar.exited) !== 0) return [{ check: "archive.extract", detail: tarErr.trim() }];
    const stage = join(work, `xeon-${version}-${triple}`);

    for (const rel of requiredPaths(triple)) check("layout", existsSync(join(stage, rel)), rel);
    check(
      "layout.lock",
      existsSync(join(stage, "binaries.lock.json")) === triple.includes("-apple-"),
      "binaries.lock.json only for macOS",
    );

    const sums = existsSync(join(stage, "SHA256SUMS"))
      ? parseSums(readFileSync(join(stage, "SHA256SUMS"), "utf8"))
      : undefined;
    check("sums.parse", sums !== undefined, "SHA256SUMS");
    for (const entry of sums ?? []) {
      check(
        "sums.match",
        existsSync(join(stage, entry.path)) && sha256Of(join(stage, entry.path)) === entry.sha256,
        entry.path,
      );
    }
    if (existsSync(join(stage, "binaries.lock.json"))) {
      const lock: unknown = JSON.parse(readFileSync(join(stage, "binaries.lock.json"), "utf8"));
      const raw: unknown =
        typeof lock === "object" && lock !== null && "binaries" in lock ? lock.binaries : [];
      const list: readonly unknown[] = Array.isArray(raw) ? raw : [];
      check("lock.entries", list.length === 3, `${String(list.length)} entries`);
      for (const item of list) {
        const p =
          typeof item === "object" &&
          item !== null &&
          "path" in item &&
          typeof item.path === "string"
            ? item.path
            : "";
        const h =
          typeof item === "object" &&
          item !== null &&
          "sha256" in item &&
          typeof item.sha256 === "string"
            ? item.sha256
            : "";
        check(
          "lock.match",
          p !== "" && existsSync(join(stage, p)) && sha256Of(join(stage, p)) === h,
          p,
        );
      }
    }
    if (failures.length > 0) return failures;

    const binary = join(stage, triple.includes("-windows-") ? "xeon.exe" : "xeon");
    const home = join(work, "home");
    const cwd = join(work, "cwd");
    mkdirSync(cwd, { recursive: true });

    const ver = await runXeon(binary, ["version"], cwd, home);
    check("run.version", ver.exitCode === 0, `exit ${String(ver.exitCode)}`);
    // the release version is injected at build time (L4.release.spec 8.1): `xeon version` prints the archive's version
    check(
      "run.version-injected",
      ver.output.includes(version),
      `xeon version does not print ${version}: ${ver.output.trim().slice(0, 200)}`,
    );

    const group = await runXeon(binary, ["group", "new", "smoke-group", "--drive"], cwd, home);
    check(
      "run.group-new",
      group.exitCode === 0,
      `exit ${String(group.exitCode)}: ${group.output.trim().slice(0, 200)}`,
    );
    check(
      "run.group-new.files",
      existsSync(join(cwd, "smoke-group", "package.json")),
      "smoke-group/package.json",
    );

    const doctor = await runXeon(binary, ["doctor"], cwd, home);
    const names = triple.includes("-apple-") ? ["sops", "age", "rg"] : ["rg", "bwrap", "socat"];
    for (const name of names)
      check("run.doctor", doctor.output.includes(`외부 바이너리 ${name}`), `no line for ${name}`);
    if (triple.includes("-apple-")) {
      for (const name of names) {
        check(
          "run.doctor.bundled",
          new RegExp(`외부 바이너리 ${name}: .*\\(번들\\)`).test(doctor.output),
          `${name} is not bundled`,
        );
      }
    }

    check(
      "swc.absent",
      !readFileSync(binary).includes("@swc/core"),
      "@swc/core string inside the binary",
    );
    return failures;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const archive = Bun.argv[2];
  if (archive === undefined || Bun.argv.length > 3) {
    process.stderr.write("usage: release-smoke <archive.tar.gz>\n");
    process.exit(1);
  }
  if (Bun.which("tar") === null) {
    process.stderr.write("release-smoke: tar is missing\n");
    process.exit(2);
  }
  const failures = await smoke(archive);
  for (const f of failures) process.stderr.write(`release-smoke: FAIL ${f.check}: ${f.detail}\n`);
  process.stdout.write(
    failures.length === 0
      ? "release-smoke: ok\n"
      : `release-smoke: ${String(failures.length)} check(s) failed\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

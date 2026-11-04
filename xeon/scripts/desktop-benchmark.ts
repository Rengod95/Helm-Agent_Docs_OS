#!/usr/bin/env bun
// Desktop speed and size (Y17, T-PERF, eng.performance.guide section 2.2). Real model calls: none.
//   desktop-benchmark size                    release app size: shell binary + bundled sidecar (+ embedded UI) against the 500 MiB cap
//   desktop-benchmark startup [--runs <n>]    start the release app on a clean home: window on screen, first screen painted, idle memory
//   desktop-benchmark frame [--frames <n>]    Orbit CPU time per frame with the 77-extension fixture (apps/desktop/test/benchmark)
//   desktop-benchmark trace [--turns <n>] [--rounds <n>]   Turn cost with the handler trace off and on, with heap (apps/host/test/benchmark)
//   desktop-benchmark all                     size, frame, trace, startup
// size and startup need `just desktop-sidecar host`, `just desktop-ui release` and `just desktop-build` first. startup needs a GUI session
// and macOS (window list, screencapture); without them it exits 2 and the values stay "못 잼".
// "First screen" is the first screenshot of the app window that is no longer near-blank (PNG larger than FIRST_SCREEN_MIN_BYTES). The poll takes
// a screenshot per step, so the value carries a resolution of about POLL_NOTE_MS. Idle memory is the summed resident set of the app, its engine
// child and the WebKit helper processes that appeared during the run; shared pages are counted once per process, so it overstates.
// Exit codes: 0 measured, 1 bad arguments, 2 environment (nothing built, no GUI session, not macOS).
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const SIZE_CAP_BYTES: number = 500 * 1024 * 1024;
/** A painted window of the real UI is about 190 KB of PNG; a blank or loading window is far smaller. */
export const FIRST_SCREEN_MIN_BYTES = 100_000;
export const POLL_NOTE_MS = 300;
const SIDECAR_NAME = "fresnel";
const SHELL_NAME = "fresnel-desktop";

const MIB = 1024 * 1024;
export const mib = (bytes: number): number => Math.round((bytes / MIB) * 10) / 10;

export interface SizeParts {
  readonly shellBytes: number;
  readonly sidecarBytes: number;
  readonly uiBytes: number;
}

export interface SizeReport {
  readonly totalMib: number;
  readonly shellMib: number;
  readonly sidecarMib: number;
  readonly uiMib: number;
  readonly capMib: number;
  readonly verdict: "within" | "over";
}

/** The shell binary embeds the UI bundle, so the app is shell + sidecar. The UI size is reported for reference and not added again. */
export function sizeReport(parts: SizeParts): SizeReport {
  const total = parts.shellBytes + parts.sidecarBytes;
  return {
    totalMib: mib(total),
    shellMib: mib(parts.shellBytes),
    sidecarMib: mib(parts.sidecarBytes),
    uiMib: mib(parts.uiBytes),
    capMib: mib(SIZE_CAP_BYTES),
    verdict: total <= SIZE_CAP_BYTES ? "within" : "over",
  };
}

export interface ProcRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssKb: number;
  readonly command: string;
}

/** `ps -axo pid=,ppid=,rss=,comm=` lines. A line that does not parse is skipped. */
export function parsePs(text: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      command: match[4] ?? "",
    });
  }
  return rows;
}

const isWebKit = (command: string): boolean => command.includes("com.apple.WebKit.");

export interface MemoryReport {
  readonly totalMib: number;
  readonly shellMib: number;
  readonly engineMib: number;
  readonly webkitMib: number;
}

const mibOfKb = (kb: number): number => Math.round((kb / 1024) * 10) / 10;
const r1 = (n: number | undefined): number => Math.round((n ?? Number.NaN) * 10) / 10;

/** App tree (the pid and its descendants) plus WebKit helpers that were not running before the launch. */
export function idleMemory(
  rows: readonly ProcRow[],
  appPid: number,
  webkitBefore: ReadonlySet<number>,
): MemoryReport {
  const tree = new Set<number>([appPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (tree.has(row.ppid) && !tree.has(row.pid)) {
        tree.add(row.pid);
        grew = true;
      }
    }
  }
  let shell = 0;
  let engine = 0;
  let webkit = 0;
  for (const row of rows) {
    if (row.pid === appPid) shell += row.rssKb;
    else if (tree.has(row.pid)) engine += row.rssKb;
    else if (isWebKit(row.command) && !webkitBefore.has(row.pid)) webkit += row.rssKb;
  }
  return {
    totalMib: mibOfKb(shell + engine + webkit),
    shellMib: mibOfKb(shell),
    engineMib: mibOfKb(engine),
    webkitMib: mibOfKb(webkit),
  };
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return Math.round((((sorted[mid - 1] ?? 0) + upper) / 2) * 10) / 10;
}

export function isFirstScreen(pngBytes: number): boolean {
  return pngBytes >= FIRST_SCREEN_MIN_BYTES;
}

// ---- running parts (not unit tested: they need a built app and a GUI) ----

const root = resolve(import.meta.dirname, "..");
const releaseDir = join(
  process.env["CARGO_TARGET_DIR"] ??
    join(
      process.env["XDG_CACHE_HOME"] ?? join(process.env["HOME"] ?? "", ".cache"),
      "fresnel",
      "cargo-target",
    ),
  "release",
);

function assertNever(value: never): never {
  return fail(1, `unhandled mode ${String(value)}`);
}

function fail(code: number, message: string): never {
  process.stderr.write(`desktop-benchmark: ${message}\n`);
  process.exit(code);
}

function dirBytes(dir: string): number {
  const out = Bun.spawnSync(["du", "-sk", dir]);
  return Number(out.stdout.toString().split(/\s+/)[0] ?? 0) * 1024;
}

function emit(metric: string, unit: string, value: number | string, note: string): void {
  process.stdout.write(`${JSON.stringify({ metric, unit, value, note })}\n`);
}

function measureSize(): void {
  const shell = join(releaseDir, SHELL_NAME);
  const sidecar = join(releaseDir, SIDECAR_NAME);
  const ui = join(root, "apps/desktop/src-tauri/ui");
  for (const file of [shell, sidecar]) {
    if (!existsSync(file))
      fail(
        2,
        `${file} is missing: run just desktop-sidecar host, just desktop-ui release, just desktop-build`,
      );
  }
  const report = sizeReport({
    shellBytes: statSync(shell).size,
    sidecarBytes: statSync(sidecar).size,
    uiBytes: existsSync(ui) ? dirBytes(ui) : 0,
  });
  const note = `shell ${String(report.shellMib)} MiB + sidecar ${String(report.sidecarMib)} MiB (UI ${String(report.uiMib)} MiB is inside the shell); cap ${String(report.capMib)} MiB; bare release binaries, no .app bundle or installer`;
  emit("app_size_mib", "mib", report.totalMib, note);
  emit("app_size_verdict", "text", report.verdict, note);
}

const WINDOW_SWIFT = `
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1]) ?? 0
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
  let bounds = w[kCGWindowBounds as String] as? [String: Any]
  let height = bounds?["Height"] as? Double ?? 0
  if (w[kCGWindowIsOnscreen as String] as? Bool) == true && height > 100 {
    print(w[kCGWindowNumber as String] ?? "")
    break
  }
}
`;

/** Compiled once per run: the window list needs CoreGraphics, which JXA cannot unwrap. */
function buildWindowProbe(dir: string): string {
  const source = join(dir, "window-probe.swift");
  const binary = join(dir, "window-probe");
  writeFileSync(source, WINDOW_SWIFT);
  const built = Bun.spawnSync(["swiftc", "-O", source, "-o", binary]);
  if (built.exitCode !== 0)
    fail(2, `swiftc could not build the window probe: ${built.stderr.toString().slice(0, 200)}`);
  return binary;
}

function windowOf(probe: string, pid: number): string {
  return Bun.spawnSync([probe, String(pid)])
    .stdout.toString()
    .trim();
}

function psRows(): ProcRow[] {
  return parsePs(Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss=,comm="]).stdout.toString());
}

interface StartupRun {
  readonly windowMs: number;
  readonly firstScreenMs: number;
  readonly memory: MemoryReport;
}

async function startupOnce(bin: string, probe: string): Promise<StartupRun> {
  const home = mkdtempSync(join(tmpdir(), "fresnel-bench-"));
  const shot = join(home, "window.png");
  const webkitBefore = new Set(
    psRows()
      .filter((r) => isWebKit(r.command))
      .map((r) => r.pid),
  );
  const began = performance.now();
  const child = Bun.spawn([bin], {
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      HOME: home,
      FRESNEL_HOME: join(home, "fresnel"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      TMPDIR: `${home}/`,
    },
  });
  try {
    let windowId = "";
    let windowMs = 0;
    while (windowId === "") {
      if (performance.now() - began > 30_000)
        fail(2, "no window appeared in 30 s (no GUI session?)");
      // oxlint-disable-next-line no-await-in-loop -- 폴링은 순서대로 한다 (eng.testing.guide TS-05)
      await Bun.sleep(30);
      windowId = windowOf(probe, child.pid);
      windowMs = performance.now() - began;
    }
    let firstScreenMs = 0;
    for (;;) {
      if (performance.now() - began > 30_000)
        fail(2, "the window never painted in 30 s (screen recording denied?)");
      Bun.spawnSync(["screencapture", "-x", "-o", `-l${windowId}`, shot]);
      if (existsSync(shot) && isFirstScreen(statSync(shot).size)) {
        firstScreenMs = performance.now() - began;
        break;
      }
    }
    await Bun.sleep(10_000);
    const memory = idleMemory(psRows(), child.pid, webkitBefore);
    return { windowMs, firstScreenMs, memory };
  } finally {
    child.kill();
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
}

async function measureStartup(runs: number): Promise<void> {
  if (process.platform !== "darwin")
    fail(2, "startup is measured on macOS only (window list, screencapture)");
  const bin = join(releaseDir, SHELL_NAME);
  if (!existsSync(bin) || !existsSync(join(releaseDir, SIDECAR_NAME)))
    fail(2, `${bin} or its sidecar is missing: run just desktop-build`);
  const probeDir = mkdtempSync(join(tmpdir(), "fresnel-bench-probe-"));
  const probe = buildWindowProbe(probeDir);
  const results: StartupRun[] = [];
  for (let i = 0; i < runs; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 앱은 하나씩 순서대로 잰다 (eng.testing.guide TS-05)
    results.push(await startupOnce(bin, probe));
  }
  rmSync(probeDir, { recursive: true, force: true });
  const note = `${String(runs)} runs, clean home (no model key: the setup-needed screen), poll resolution ~${String(POLL_NOTE_MS)} ms`;
  emit(
    "first_screen_ms_runs",
    "text",
    results.map((r) => Math.round(r.firstScreenMs)).join(" "),
    note,
  );
  emit("window_ms_p50", "ms", r1(median(results.map((r) => r.windowMs))), note);
  emit("first_screen_ms_p50", "ms", r1(median(results.map((r) => r.firstScreenMs))), note);
  emit("first_screen_ms_max", "ms", r1(Math.max(...results.map((r) => r.firstScreenMs))), note);
  for (const key of ["totalMib", "shellMib", "engineMib", "webkitMib"] as const) {
    emit(
      `idle_rss_${key.replace("Mib", "")}_mib_p50`,
      "mib",
      r1(median(results.map((r) => r.memory[key]))),
      `${note}; RSS 10 s after the first screen`,
    );
  }
}

async function runEntry(entry: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(["bun", entry, ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) fail(2, `${entry} failed`);
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      runs: { type: "string" },
      frames: { type: "string" },
      turns: { type: "string" },
      rounds: { type: "string" },
    },
  });
  const MODES = ["size", "startup", "frame", "trace", "all"] as const;
  const mode = MODES.find((name) => name === positionals[0]);
  if (mode === undefined) {
    fail(
      1,
      "usage: desktop-benchmark <size|startup|frame|trace|all> [--runs n] [--frames n] [--turns n] [--rounds n]",
    );
  }
  const runs = values.runs === undefined ? 3 : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20)
    fail(1, "--runs must be an integer from 1 to 20");
  const flagArgs = (names: readonly ("frames" | "turns" | "rounds")[]): string[] =>
    names.flatMap((name) => (values[name] === undefined ? [] : [`--${name}`, values[name]]));
  const frame = (): Promise<void> =>
    runEntry("apps/desktop/test/benchmark/orbit-frame.benchmark.ts", flagArgs(["frames"]));
  const trace = (): Promise<void> =>
    runEntry(
      "apps/host/test/benchmark/trace-conversation.benchmark.ts",
      flagArgs(["turns", "rounds"]),
    );
  switch (mode) {
    case "size":
      measureSize();
      break;
    case "startup":
      await measureStartup(runs);
      break;
    case "frame":
      await frame();
      break;
    case "trace":
      await trace();
      break;
    case "all":
      measureSize();
      await frame();
      await trace();
      await measureStartup(runs);
      break;
    default:
      assertNever(mode);
  }
  process.exit(0);
}

#!/usr/bin/env bun
// Launch smoke of the bundled Electron app (L4.desktop.spec §11.7, `just desktop-smoke-electron`). It starts Fresnel.app on a
// clean home (CFFIXED_USER_HOME moves Electron's appData and log folders, HOME and FRESNEL_HOME move the engine's) and checks
// what a user sees:
//   structure       UI bundle, engine sidecar, tray icon and the notice files are in Resources
//   mac-security    the addon (.node) is in Resources and loads; only the shape of canAuthenticate() is checked, no window opens
//   window restore  a saved window position is where the first window appears; after a quit it reopens where it closed
//   first screen    the window painted (screencapture of that window, same size heuristic as desktop-benchmark)
//   engine          the app log says the sidecar started, and the sidecar is a child of the app
//   tray            the app log says the tray was created (the menu bar cannot be read without Accessibility permission)
//   inspect off     FRESNEL_DESKTOP_INSPECT=1 is set on purpose and no inspect socket appears (bundled apps ignore it)
//   second launch   a second start of the same app exits and leaves one window
//   key save        the bundled sidecar saves a fake model key on a clean home: 0600 key file, SOPS file, source=file (skipped without sops)
//   quit            SIGTERM ends the app and its engine child
// Needs macOS with a GUI session and swiftc (window list, screencapture). Every wait has a deadline.
//   electron-smoke <Fresnel.app>
// exit: 0 all checks passed, 1 a check failed, 2 environment (not macOS, no GUI session, no swiftc, app missing)
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  FIRST_SCREEN_MIN_BYTES,
  isFirstScreen,
  parsePs,
  type ProcRow,
} from "./desktop-benchmark.ts";

const IDENTIFIER = "dev.fresnel.desktop";
const DEADLINE_MS = 30_000;
const SAVED_BOUNDS: Bounds = { x: 120, y: 140, width: 900, height: 640 };
/** pixels of slack between the saved bounds and the window list (rounding, the window frame) */
const BOUNDS_TOLERANCE = 2;

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowRow {
  readonly id: number;
  readonly layer: number;
  readonly onscreen: boolean;
  readonly bounds: Bounds;
}

/** One probe line: `id|layer|onscreen|x|y|width|height`. A line of another shape is `undefined`. */
export function parseWindowLine(line: string): WindowRow | undefined {
  const parts = line.trim().split("|");
  if (parts.length !== 7) return undefined;
  const nums = parts.map((part) => Number(part));
  if (nums.some((value) => !Number.isFinite(value))) return undefined;
  const [id, layer, onscreen, x, y, width, height] = nums;
  if (
    id === undefined ||
    layer === undefined ||
    onscreen === undefined ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }
  return { id, layer, onscreen: onscreen === 1, bounds: { x, y, width, height } };
}

/** The main window: on screen, normal layer, taller than the empty full-width helper windows Electron keeps. */
export function mainWindowOf(rows: readonly WindowRow[]): WindowRow | undefined {
  return rows.find((row) => row.onscreen && row.layer === 0 && row.bounds.height > 100);
}

export function boundsClose(a: Bounds, b: Bounds, tolerance: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/** The bounds a window state file holds (the shell writes exactly this shape), or `undefined` for anything else. */
export function savedBoundsOf(text: string): Bounds | undefined {
  const match = /^\{"x":(-?\d+),"y":(-?\d+),"width":(\d+),"height":(\d+)\}$/u.exec(text.trim());
  if (match === null) return undefined;
  const [, x, y, width, height] = match;
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return undefined;
  return { x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
}

const SWIFT = `
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1]) ?? 0
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
  let b = w[kCGWindowBounds as String] as? [String: Any]
  let on = (w[kCGWindowIsOnscreen as String] as? Bool) == true ? 1 : 0
  print("\\(w[kCGWindowNumber as String] ?? 0)|\\(w[kCGWindowLayer as String] ?? 0)|\\(on)|\\(b?["X"] ?? 0)|\\(b?["Y"] ?? 0)|\\(b?["Width"] ?? 0)|\\(b?["Height"] ?? 0)")
}
`;

/** The addon report line `native=true available=<bool> biometry=<touchid|faceid|none>`: the binary loaded and canAuthenticate() has the documented shape. */
export function isAddonReport(text: string): boolean {
  return /^native=true available=(?:true|false) biometry=(?:touchid|faceid|none)$/u.test(
    text.trim(),
  );
}

/** A real sops binary (the mise shim does not work under a temporary HOME, so `mise which` comes first). */
function findSops(): string | undefined {
  const viaMise = Bun.spawnSync(["mise", "which", "sops"]);
  const mise = viaMise.exitCode === 0 ? viaMise.stdout.toString().trim() : "";
  if (mise !== "" && existsSync(mise)) return mise;
  return Bun.which("sops") ?? undefined;
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `: ${detail}`}\n`);
  if (!ok) failures.push(name);
}

function bail(code: number, message: string): never {
  process.stderr.write(`electron-smoke: ${message}\n`);
  process.exit(code);
}

function windowsOf(probe: string, pid: number): WindowRow[] {
  const lines = Bun.spawnSync([probe, String(pid)])
    .stdout.toString()
    .split("\n");
  return lines.flatMap((line) => {
    const row = parseWindowLine(line);
    return row === undefined ? [] : [row];
  });
}

function psRows(): ProcRow[] {
  return parsePs(Bun.spawnSync(["ps", "-axo", "pid=,ppid=,rss=,comm="]).stdout.toString());
}

async function until<T>(
  what: string,
  find: () => T | undefined,
  ms = DEADLINE_MS,
): Promise<T | undefined> {
  const began = performance.now();
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (performance.now() - began > ms) {
      process.stdout.write(`(waited ${String(ms)} ms for ${what})\n`);
      return undefined;
    }
    // oxlint-disable-next-line no-await-in-loop -- 폴링은 순서대로 한다 (eng.testing.guide TS-05)
    await Bun.sleep(100);
  }
}

if (import.meta.main) {
  const app = process.argv[2];
  if (app === undefined) bail(1, "usage: electron-smoke <Fresnel.app>");
  if (process.platform !== "darwin") bail(2, "needs macOS (window list, screencapture)");
  const bin = join(app, "Contents", "MacOS", "Fresnel");
  if (!existsSync(bin)) bail(2, `${bin} is missing: run just desktop-build-electron`);

  const resources = join(app, "Contents", "Resources");
  for (const rel of [
    "app.asar",
    "ui/index.html",
    "assets/tray.png",
    "licenses/LICENSE.electron",
    "licenses/LICENSES.chromium.html",
    "licenses/THIRD-PARTY-NOTICES-SHELL.txt",
    "licenses/THIRD-PARTY-NOTICES.txt",
  ]) {
    check(`structure ${rel}`, existsSync(join(resources, rel)));
  }
  check("structure engine sidecar", existsSync(join(resources, "fresnel-aarch64-apple-darwin")));

  // mac-security: the .node file sits in Resources and loads under the app's own Electron runtime (ELECTRON_RUN_AS_NODE).
  // Only canAuthenticate() runs: it reads the Mac's capability and never opens an authentication window.
  const addonDir = resolve(resources, "mac-security");
  check(
    "structure mac-security addon",
    existsSync(join(addonDir, "build", "Release", "mac_security.node")),
  );
  const loaded = Bun.spawnSync(
    [
      bin,
      "-e",
      [
        `const m = require(${JSON.stringify(join(addonDir, "index.js"))});`,
        "const r = m.canAuthenticate();",
        "process.stdout.write('native=' + (m.loadNative() !== null) + ' available=' + r.available + ' biometry=' + r.biometry);",
      ].join(" "),
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 20_000 },
  );
  check(
    "mac-security loads and reports canAuthenticate",
    isAddonReport(loaded.stdout.toString()),
    `exit ${String(loaded.exitCode)}`,
  );

  // key save: `fresnel secret add` of the bundled sidecar on a clean home (the same child the first-run screen starts).
  // The value is fake and no model is called. sops is not bundled, so a machine without it skips this step.
  const sopsPath = findSops();
  if (sopsPath === undefined) {
    process.stdout.write("SKIP key save on a clean home: sops not found on this machine\n");
  } else {
    const keyWork = mkdtempSync(join(tmpdir(), "fresnel-key-smoke-"));
    const keyHome = join(keyWork, "home");
    mkdirSync(keyHome, { recursive: true });
    const saved = Bun.spawnSync(
      [join(resources, "fresnel-aarch64-apple-darwin"), "secret", "add", "smoke-key"],
      {
        env: {
          HOME: keyHome,
          FRESNEL_HOME: join(keyHome, "fresnel"),
          PATH: `${dirname(sopsPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        },
        stdin: new TextEncoder().encode("fake-model-key-for-smoke-0000"),
        timeout: 60_000,
      },
    );
    const keyFile = join(keyHome, "fresnel", "config", "secrets", "age", "keys.txt");
    const settingsFile = join(keyHome, "fresnel", "config", "settings.json");
    check(
      "key save exits 0 on a clean home",
      saved.exitCode === 0,
      `exit ${String(saved.exitCode)}`,
    );
    check(
      "key save wrote the age key file with mode 0600",
      existsSync(keyFile) && (statSync(keyFile).mode & 0o777) === 0o600,
    );
    check(
      "key save wrote the SOPS file",
      existsSync(join(keyHome, "fresnel", "config", "secrets", "sops", "user.yaml")),
    );
    check(
      "key save recorded source=file in the user settings",
      existsSync(settingsFile) &&
        readFileSync(settingsFile, "utf8").includes('"l0.secrets.ageKey.source": "file"'),
    );
    rmSync(keyWork, { recursive: true, force: true });
  }

  const work = mkdtempSync(join(tmpdir(), "fresnel-electron-smoke-"));
  const swift = join(work, "probe.swift");
  const probe = join(work, "probe");
  writeFileSync(swift, SWIFT);
  const built = Bun.spawnSync(["swiftc", "-O", swift, "-o", probe]);
  if (built.exitCode !== 0)
    bail(2, `swiftc could not build the window probe: ${built.stderr.toString().slice(0, 200)}`);

  const home = join(work, "home");
  const configDir = join(home, "Library", "Application Support", IDENTIFIER);
  const logsDir = join(home, "Library", "Logs", IDENTIFIER);
  const logFile = join(logsDir, "fresnel-desktop.log");
  const stateFile = join(configDir, "window-state-electron.json");
  const overrideSocket = join(work, "i.sock");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(SAVED_BOUNDS));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])),
    ),
    CFFIXED_USER_HOME: home,
    HOME: home,
    FRESNEL_HOME: join(home, "fresnel"),
    // set on purpose: a bundled app must ignore these
    FRESNEL_DESKTOP_INSPECT: "1",
    FRESNEL_DESKTOP_INSPECT_SOCKET: overrideSocket,
  };
  const logText = (): string => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
  const spawnApp = (): Bun.Subprocess =>
    Bun.spawn([bin], { env, stdout: "ignore", stderr: "ignore" });
  const children: Bun.Subprocess[] = [];

  try {
    // launch 1: restored position, first screen, engine, tray, inspect off
    const first = spawnApp();
    children.push(first);
    const win = await until("the first window", () => mainWindowOf(windowsOf(probe, first.pid)));
    if (win === undefined) bail(2, "no window appeared (no GUI session?)");
    check(
      "window restored at the saved position",
      boundsClose(win.bounds, SAVED_BOUNDS, BOUNDS_TOLERANCE),
      JSON.stringify(win.bounds),
    );
    const shot = join(work, "window.png");
    const painted = await until("the first screen", () => {
      Bun.spawnSync(["screencapture", "-x", "-o", `-l${String(win.id)}`, shot]);
      return existsSync(shot) && isFirstScreen(statSync(shot).size) ? true : undefined;
    });
    check(
      "first screen painted",
      painted === true,
      `needs > ${String(FIRST_SCREEN_MIN_BYTES)} bytes of PNG`,
    );
    const started = await until(
      "the engine start line",
      () => (/engine\[1\] started pid=\d+/u.test(logText()) ? true : undefined),
      15_000,
    );
    check("engine started (app log)", started === true);
    const sidecarChild = psRows().find(
      (row) => row.ppid === first.pid && row.command.includes("Contents/Resources/fresnel-"),
    );
    check("engine sidecar runs from Resources as a child of the app", sidecarChild !== undefined);
    check("tray created (app log)", logText().includes("tray: created"));
    check(
      "inspect socket stays off in the bundled app",
      !existsSync(join(logsDir, "inspect.sock")) &&
        !existsSync(overrideSocket) &&
        !logText().includes("debug inspect listening"),
    );

    // second launch: exits, one window stays
    const second = spawnApp();
    children.push(second);
    const secondExit = await until(
      "the second launch to exit",
      () => (second.exitCode === null ? undefined : second.exitCode),
      15_000,
    );
    check("second launch exits", secondExit !== undefined, `exit ${String(secondExit)}`);
    const mains = windowsOf(probe, first.pid).filter(
      (row) => row.onscreen && row.layer === 0 && row.bounds.height > 100,
    );
    check(
      "the first app is alive with one window",
      first.exitCode === null && mains.length === 1,
      `${String(mains.length)} windows`,
    );

    // quit: SIGTERM ends the app and the engine
    first.kill("SIGTERM");
    const quit = await until(
      "the app to quit",
      () => (first.exitCode === null ? undefined : first.exitCode),
      20_000,
    );
    check("quit ends the app", quit !== undefined, `exit ${String(quit)}`);
    check(
      "quit ends the engine",
      psRows().every((row) => row.ppid !== first.pid) &&
        /engine\[1\] exited code=0/u.test(logText()),
    );

    // launch 3: reopens where the window closed
    const closedAt = savedBoundsOf(existsSync(stateFile) ? readFileSync(stateFile, "utf8") : "");
    check("window state file written on quit", closedAt !== undefined);
    const third = spawnApp();
    children.push(third);
    const win3 = await until("the reopened window", () =>
      mainWindowOf(windowsOf(probe, third.pid)),
    );
    check(
      "window reopens where it closed",
      win3 !== undefined &&
        closedAt !== undefined &&
        boundsClose(win3.bounds, closedAt, BOUNDS_TOLERANCE),
      JSON.stringify(win3?.bounds),
    );
    third.kill("SIGTERM");
    await until(
      "the third app to quit",
      () => (third.exitCode === null ? undefined : third.exitCode),
      20_000,
    );
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write(
    failures.length === 0
      ? "electron-smoke: all checks passed\n"
      : `electron-smoke: ${String(failures.length)} failed: ${failures.join(", ")}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

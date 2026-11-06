import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rethrow } from "@fresnel/contracts";
import {
  resetCloseBehavior,
  setTrayActive,
  shouldQuitWhenWindowsClosed,
} from "../src/main/close-behavior.ts";
import { ShellError } from "../src/main/commands.ts";
import {
  DEFAULT_DESKTOP_SETTINGS,
  KEY_CLOSE_BEHAVIOR,
  KEY_RESTART_LIMIT,
  KEY_SHUTDOWN_GRACE_MS,
  MAX_SETTINGS_BYTES,
  SETTINGS_FILE_NAME,
  closeBehaviorUpdate,
  createDesktopSettingsStore,
  desktopSettingsModule,
  desktopSettingsStore,
  effectiveCloseBehavior,
  loadDesktopSettings,
  parseDesktopSettings,
  readSettingsObject,
  shouldPreventExit,
  validateEntry,
  writeSettingsKey,
} from "../src/main/desktop-settings.ts";
import { LOG_FILE_NAME } from "../src/main/lib/applog.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

function scratchDir(): string {
  return mkdtempSync(path.join(tmpdir(), "desktop-settings-test-"));
}

/** 던져진 ShellError의 payload. 던지지 않았으면 "no rejection"이다 */
function rejectionOf(run: () => void): unknown {
  try {
    run();
  } catch (cause) {
    if (cause instanceof ShellError) return cause.payload;
    rethrow(cause);
  }
  return "no rejection";
}

function skippedLine(key: string, reason: string): string {
  return `desktop settings: ${key} ${reason}; using the default`;
}

describe("desktop settings parse", () => {
  test("reads the documented flat keys", () => {
    const text =
      '{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":2}';
    expect(parseDesktopSettings(text)).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: 5000, restartLimit: 2 },
      diagnostics: [],
    });
  });

  test("accepts the range bounds and quit", () => {
    expect(
      parseDesktopSettings(
        '{"l4.desktop.window.closeBehavior":"quit","l4.desktop.engine.shutdownGraceMs":180000,"l4.desktop.engine.restartLimit":0}',
      ),
    ).toEqual({
      settings: { closeBehavior: "quit", shutdownGraceMs: 180_000, restartLimit: 0 },
      diagnostics: [],
    });
    expect(
      parseDesktopSettings(
        '{"l4.desktop.engine.shutdownGraceMs":1000,"l4.desktop.engine.restartLimit":10}',
      ),
    ).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: 1000, restartLimit: 10 },
      diagnostics: [],
    });
  });

  // 값 하나가 틀리면 그 키만 기본값이고 진단이 하나 남는다. JS는 `2.0`과 `2`를 구분하지 못해서 그 줄은 뺀다.
  test("skips each invalid value with one diagnostic naming its key", () => {
    const closeReason = 'is not "quit" or "tray"';
    const invalid: readonly (readonly [string, string, string])[] = [
      [KEY_CLOSE_BEHAVIOR, '"exit"', skippedLine(KEY_CLOSE_BEHAVIOR, closeReason)],
      [KEY_CLOSE_BEHAVIOR, '"Tray"', skippedLine(KEY_CLOSE_BEHAVIOR, closeReason)],
      [KEY_CLOSE_BEHAVIOR, "1", skippedLine(KEY_CLOSE_BEHAVIOR, closeReason)],
      [KEY_CLOSE_BEHAVIOR, "null", skippedLine(KEY_CLOSE_BEHAVIOR, closeReason)],
      [KEY_SHUTDOWN_GRACE_MS, '"5000"', skippedLine(KEY_SHUTDOWN_GRACE_MS, "is not an integer")],
      [KEY_SHUTDOWN_GRACE_MS, "5000.5", skippedLine(KEY_SHUTDOWN_GRACE_MS, "is not an integer")],
      [KEY_SHUTDOWN_GRACE_MS, "999", skippedLine(KEY_SHUTDOWN_GRACE_MS, "is outside its range")],
      [KEY_SHUTDOWN_GRACE_MS, "180001", skippedLine(KEY_SHUTDOWN_GRACE_MS, "is outside its range")],
      [KEY_SHUTDOWN_GRACE_MS, "true", skippedLine(KEY_SHUTDOWN_GRACE_MS, "is not an integer")],
      [KEY_RESTART_LIMIT, "-1", skippedLine(KEY_RESTART_LIMIT, "is outside its range")],
      [KEY_RESTART_LIMIT, "11", skippedLine(KEY_RESTART_LIMIT, "is outside its range")],
      [KEY_RESTART_LIMIT, "2.5", skippedLine(KEY_RESTART_LIMIT, "is not an integer")],
      [KEY_RESTART_LIMIT, "[2]", skippedLine(KEY_RESTART_LIMIT, "is not an integer")],
    ];
    for (const [key, value, diagnostic] of invalid) {
      expect(parseDesktopSettings(`{"${key}":${value}}`)).toEqual({
        settings: DEFAULT_DESKTOP_SETTINGS,
        diagnostics: [diagnostic],
      });
    }
  });

  test("an invalid value does not drop the valid ones next to it", () => {
    expect(
      parseDesktopSettings(
        '{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":"two","l4.desktop.engine.shutdownGraceMs":6000}',
      ),
    ).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: 6000, restartLimit: null },
      diagnostics: [skippedLine(KEY_RESTART_LIMIT, "is not an integer")],
    });
  });

  test("diagnostics name the key and never echo a value", () => {
    const parsed = parseDesktopSettings(
      '{"l4.desktop.window.closeBehavior":"zz-marker-one","l4.desktop.engine.restartLimit":"zz-marker-two"}',
    );
    expect(parsed.diagnostics).toEqual([
      skippedLine(KEY_CLOSE_BEHAVIOR, 'is not "quit" or "tray"'),
      skippedLine(KEY_RESTART_LIMIT, "is not an integer"),
    ]);
    expect(parsed.diagnostics.join("\n")).not.toContain("zz-marker");
  });

  test("corrupt JSON or a non-object gives all defaults and one diagnostic", () => {
    const notObject = "desktop settings: the top level is not a JSON object; using defaults";
    const notJson = "desktop settings: not valid JSON; using defaults";
    const cases: readonly (readonly [string, string])[] = [
      ["", notJson],
      ["{", notJson],
      ["not json", notJson],
      ['{"l4.desktop.window.closeBehavior":"tray",', notJson],
      ["[1,2]", notObject],
      ['"tray"', notObject],
    ];
    for (const [text, diagnostic] of cases) {
      expect(parseDesktopSettings(text)).toEqual({
        settings: DEFAULT_DESKTOP_SETTINGS,
        diagnostics: [diagnostic],
      });
    }
  });

  test("an empty object and unknown keys are ignored without a diagnostic", () => {
    expect(parseDesktopSettings("{}")).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: [],
    });
    const longKey = "k".repeat(10_000);
    expect(
      parseDesktopSettings(
        `{"l4.desktop.appearance.theme":"dark","l4.desktop.window.other":{"x":1},"${longKey}":"y","l4.desktop.engine.restartLimit":4}`,
      ),
    ).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: null, restartLimit: 4 },
      diagnostics: [],
    });
  });

  test("the close behavior defaults to tray everywhere", () => {
    expect(DEFAULT_DESKTOP_SETTINGS.closeBehavior).toBe("tray");
    expect(parseDesktopSettings("{}").settings.closeBehavior).toBe("tray");
    expect(
      parseDesktopSettings('{"l4.desktop.window.closeBehavior":"quit"}').settings.closeBehavior,
    ).toBe("quit");
  });

  test("out of range numbers come back as null so the engine keeps its defaults", () => {
    for (const text of [
      '{"l4.desktop.engine.shutdownGraceMs":999,"l4.desktop.engine.restartLimit":11}',
      '{"l4.desktop.engine.shutdownGraceMs":180001,"l4.desktop.engine.restartLimit":-1}',
    ]) {
      expect(parseDesktopSettings(text).settings).toEqual({
        closeBehavior: "tray",
        shutdownGraceMs: null,
        restartLimit: null,
      });
    }
  });

  test("valid engine values come through parse", () => {
    expect(
      parseDesktopSettings(
        '{"l4.desktop.engine.shutdownGraceMs":5000,"l4.desktop.engine.restartLimit":0}',
      ).settings,
    ).toEqual({ closeBehavior: "tray", shutdownGraceMs: 5000, restartLimit: 0 });
  });
});

describe("close behavior decisions", () => {
  test("a tray setting without a tray icon quits on close", () => {
    const table = [
      ["quit", false, "quit"],
      ["quit", true, "quit"],
      ["tray", false, "quit"],
      ["tray", true, "tray"],
    ] as const;
    for (const [configured, trayActive, expected] of table) {
      expect(effectiveCloseBehavior(configured, trayActive)).toBe(expected);
    }
  });

  test("only a tray close without an exit code is prevented", () => {
    const table = [
      ["quit", null, false],
      ["quit", 0, false],
      ["quit", 1, false],
      ["quit", -1, false],
      ["quit", 2_147_483_647, false],
      ["tray", null, true],
      ["tray", 0, false],
      ["tray", 1, false],
      ["tray", -1, false],
      ["tray", 2_147_483_647, false],
    ] as const;
    for (const [behavior, code, expected] of table) {
      expect(shouldPreventExit(behavior, code)).toBe(expected);
    }
  });

  test("a close behavior write updates the live state only for valid values", () => {
    expect(closeBehaviorUpdate(KEY_CLOSE_BEHAVIOR, "tray")).toBe("tray");
    expect(closeBehaviorUpdate(KEY_CLOSE_BEHAVIOR, "quit")).toBe("quit");
    for (const value of ["exit", "Tray", 1, null]) {
      expect(closeBehaviorUpdate(KEY_CLOSE_BEHAVIOR, value)).toBeNull();
    }
    expect(closeBehaviorUpdate(KEY_RESTART_LIMIT, 2)).toBeNull();
    expect(closeBehaviorUpdate("l4.desktop.appearance.theme", "tray")).toBeNull();
  });
});

describe("desktop settings load", () => {
  test("without a directory it reports that and uses defaults", () => {
    expect(loadDesktopSettings(null)).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: ["desktop settings: the config directory is unavailable; using defaults"],
    });
  });

  test("a missing directory or a missing file is silent", () => {
    const missing = path.join(scratchDir(), "absent");
    expect(loadDesktopSettings(missing)).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: [],
    });
    expect(loadDesktopSettings(scratchDir())).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: [],
    });
  });

  test("reads the file in the directory", () => {
    const dir = scratchDir();
    writeFileSync(
      path.join(dir, SETTINGS_FILE_NAME),
      '{"l4.desktop.window.closeBehavior":"tray","l4.desktop.engine.restartLimit":1}',
    );
    expect(loadDesktopSettings(dir)).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: null, restartLimit: 1 },
      diagnostics: [],
    });
  });

  test("refuses a file over 64 KiB and reads one of exactly 64 KiB", () => {
    const dir = scratchDir();
    const head = '{"l4.desktop.engine.restartLimit":2}';
    const padded = (total: number): string => `${head}${" ".repeat(total - head.length)}`;

    writeFileSync(path.join(dir, SETTINGS_FILE_NAME), padded(65 * 1024));
    expect(loadDesktopSettings(dir)).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: ["desktop settings: the file is larger than 64 KiB; using defaults"],
    });

    writeFileSync(path.join(dir, SETTINGS_FILE_NAME), padded(MAX_SETTINGS_BYTES));
    expect(loadDesktopSettings(dir)).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: null, restartLimit: 2 },
      diagnostics: [],
    });
  });

  test("a file that is not UTF-8 uses defaults", () => {
    const dir = scratchDir();
    writeFileSync(path.join(dir, SETTINGS_FILE_NAME), new Uint8Array([0xff, 0xfe, 0x00]));
    expect(loadDesktopSettings(dir)).toEqual({
      settings: DEFAULT_DESKTOP_SETTINGS,
      diagnostics: ["desktop settings: the file is not UTF-8; using defaults"],
    });
  });
});

describe("desktop settings read and write", () => {
  test("a missing file reads as an empty object", () => {
    expect(readSettingsObject(scratchDir())).toEqual({});
  });

  test("write then read returns the keys that were written, sorted, with no temp file left", () => {
    const dir = scratchDir();
    writeSettingsKey(dir, KEY_RESTART_LIMIT, 2);
    writeSettingsKey(dir, "l4.desktop.appearance.theme", "dark");
    writeSettingsKey(dir, KEY_CLOSE_BEHAVIOR, "tray");
    expect(readSettingsObject(dir)).toEqual({
      "l4.desktop.engine.restartLimit": 2,
      "l4.desktop.appearance.theme": "dark",
      "l4.desktop.window.closeBehavior": "tray",
    });
    expect(readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8")).toBe(
      '{"l4.desktop.appearance.theme":"dark","l4.desktop.engine.restartLimit":2,"l4.desktop.window.closeBehavior":"tray"}',
    );
    expect(loadDesktopSettings(dir)).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: null, restartLimit: 2 },
      diagnostics: [],
    });
    expect(existsSync(path.join(dir, `${SETTINGS_FILE_NAME}.tmp`))).toBe(false);
  });

  test("rejects an unknown key and creates no file", () => {
    const dir = scratchDir();
    for (const key of [
      "l4.desktop.engine.bogus",
      "l4.desktop.engine.restartLimitX",
      "l4.desktop.window",
      "other.app.key",
      "",
    ]) {
      expect(rejectionOf(() => writeSettingsKey(dir, key, 1))).toBe("bad-request");
    }
    expect(existsSync(path.join(dir, SETTINGS_FILE_NAME))).toBe(false);
    expect(readSettingsObject(dir)).toEqual({});
  });

  test("rejects a known key with a bad value and keeps the file as it was", () => {
    const dir = scratchDir();
    writeSettingsKey(dir, KEY_RESTART_LIMIT, 2);
    const before = readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8");
    const cases: readonly (readonly [string, unknown])[] = [
      [KEY_RESTART_LIMIT, 11],
      [KEY_RESTART_LIMIT, -1],
      [KEY_RESTART_LIMIT, "2"],
      [KEY_RESTART_LIMIT, 2.5],
      [KEY_SHUTDOWN_GRACE_MS, 999],
      [KEY_SHUTDOWN_GRACE_MS, 180_001],
      [KEY_CLOSE_BEHAVIOR, "exit"],
      [KEY_CLOSE_BEHAVIOR, "Tray"],
      [KEY_CLOSE_BEHAVIOR, null],
    ];
    for (const [key, value] of cases) {
      expect(rejectionOf(() => writeSettingsKey(dir, key, value))).toBe("bad-request");
    }
    expect(readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8")).toBe(before);
  });

  test("known keys accept their range bounds and enum values", () => {
    expect(rejectionOf(() => validateEntry(KEY_SHUTDOWN_GRACE_MS, 1000))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry(KEY_SHUTDOWN_GRACE_MS, 180_000))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry(KEY_RESTART_LIMIT, 0))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry(KEY_RESTART_LIMIT, 10))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry(KEY_CLOSE_BEHAVIOR, "quit"))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry(KEY_CLOSE_BEHAVIOR, "tray"))).toBe("no rejection");
    expect(rejectionOf(() => validateEntry("l4.desktop.firstRun.done", { at: "2026-11-03" }))).toBe(
      "no rejection",
    );
  });

  test("UI state keys take any JSON value but not undefined or non-finite numbers", () => {
    expect(rejectionOf(() => validateEntry("l4.desktop.window.other", { x: [1, "a", null] }))).toBe(
      "no rejection",
    );
    expect(rejectionOf(() => validateEntry("l4.desktop.workbench.draft", undefined))).toBe(
      "bad-request",
    );
    expect(rejectionOf(() => validateEntry("l4.desktop.appearance.size", Number.NaN))).toBe(
      "bad-request",
    );
    expect(rejectionOf(() => validateEntry("l4.desktop.appearance.size", Infinity))).toBe(
      "bad-request",
    );
  });

  test("refuses a value that would push the file over 64 KiB and keeps the file readable", () => {
    const dir = scratchDir();
    writeSettingsKey(dir, KEY_RESTART_LIMIT, 2);
    const big = "x".repeat(MAX_SETTINGS_BYTES);
    expect(rejectionOf(() => writeSettingsKey(dir, "l4.desktop.workbench.draft", big))).toBe(
      "too-large",
    );
    expect(readSettingsObject(dir)).toEqual({ "l4.desktop.engine.restartLimit": 2 });
    expect(loadDesktopSettings(dir)).toEqual({
      settings: { closeBehavior: "tray", shutdownGraceMs: null, restartLimit: 2 },
      diagnostics: [],
    });
  });

  test("a damaged file is neither read nor overwritten", () => {
    const dir = scratchDir();
    for (const text of ["{ not json", "[1,2]", '"tray"', ""]) {
      writeFileSync(path.join(dir, SETTINGS_FILE_NAME), text);
      expect(rejectionOf(() => readSettingsObject(dir))).toBe("storage-failed");
      expect(rejectionOf(() => writeSettingsKey(dir, KEY_RESTART_LIMIT, 2))).toBe("storage-failed");
      expect(readFileSync(path.join(dir, SETTINGS_FILE_NAME), "utf8")).toBe(text);
    }
  });

  test("write creates a missing config directory", () => {
    const dir = path.join(scratchDir(), "nested", "config");
    writeSettingsKey(dir, KEY_RESTART_LIMIT, 3);
    expect(readSettingsObject(dir)).toEqual({ "l4.desktop.engine.restartLimit": 3 });
  });

  test("the store keeps the close behavior live and leaves engine values at their startup value", () => {
    const dir = scratchDir();
    writeSettingsKey(dir, KEY_SHUTDOWN_GRACE_MS, 5000);
    const store = createDesktopSettingsStore(dir);
    expect(store.current()).toEqual({
      closeBehavior: "tray",
      shutdownGraceMs: 5000,
      restartLimit: null,
    });
    store.write(KEY_CLOSE_BEHAVIOR, "quit");
    store.write(KEY_RESTART_LIMIT, 4);
    expect(store.current()).toEqual({
      closeBehavior: "quit",
      shutdownGraceMs: 5000,
      restartLimit: null,
    });
    expect(readSettingsObject(dir)[KEY_RESTART_LIMIT]).toBe(4);
  });
});

describe("desktop settings module", () => {
  test("read returns the file as an object and write stores a valid key", async () => {
    const fake = fakeCtx();
    desktopSettingsModule.register(fake.ctx);
    expect(await fake.call("desktop_settings_read")).toEqual({ ok: true, value: {} });
    expect(
      await fake.call("desktop_settings_write", { key: KEY_CLOSE_BEHAVIOR, value: "quit" }),
    ).toEqual({ ok: true, value: null });
    expect(await fake.call("desktop_settings_read")).toEqual({
      ok: true,
      value: { [KEY_CLOSE_BEHAVIOR]: "quit" },
    });
    expect(desktopSettingsStore(fake.ctx).current().closeBehavior).toBe("quit");
  });

  test("the stored close behavior reaches the window-close decision at start and on write", async () => {
    resetCloseBehavior();
    setTrayActive(true);
    const fake = fakeCtx();
    mkdirSync(fake.ctx.paths.configDir, { recursive: true });
    writeFileSync(
      path.join(fake.ctx.paths.configDir, SETTINGS_FILE_NAME),
      JSON.stringify({ [KEY_CLOSE_BEHAVIOR]: "quit" }),
    );
    desktopSettingsModule.register(fake.ctx);
    expect(shouldQuitWhenWindowsClosed()).toBe(true);
    await fake.call("desktop_settings_write", { key: KEY_CLOSE_BEHAVIOR, value: "tray" });
    expect(shouldQuitWhenWindowsClosed()).toBe(false);
    resetCloseBehavior();
  });

  test("rejects a bad key, a bad value and malformed args with their codes", async () => {
    const fake = fakeCtx();
    desktopSettingsModule.register(fake.ctx);
    expect(
      await fake.call("desktop_settings_write", { key: "l4.desktop.engine.bogus", value: 1 }),
    ).toEqual({ ok: false, error: "bad-request" });
    expect(
      await fake.call("desktop_settings_write", { key: KEY_RESTART_LIMIT, value: 11 }),
    ).toEqual({ ok: false, error: "bad-request" });
    expect(await fake.call("desktop_settings_write", null)).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await fake.call("desktop_settings_write", { key: 5, value: 1 })).toEqual({
      ok: false,
      error: "bad-request",
    });
  });

  test("a config directory that is a file gives storage-failed for read and write", async () => {
    const fake = fakeCtx();
    mkdirSync(fake.dir, { recursive: true });
    writeFileSync(fake.ctx.paths.configDir, "not a directory");
    desktopSettingsModule.register(fake.ctx);
    expect(await fake.call("desktop_settings_read")).toEqual({
      ok: false,
      error: "storage-failed",
    });
    expect(await fake.call("desktop_settings_write", { key: KEY_RESTART_LIMIT, value: 2 })).toEqual(
      { ok: false, error: "storage-failed" },
    );
  });

  test("register writes each load diagnostic to the app log", () => {
    const fake = fakeCtx();
    mkdirSync(fake.ctx.paths.configDir, { recursive: true });
    writeFileSync(path.join(fake.ctx.paths.configDir, SETTINGS_FILE_NAME), "{ not json");
    desktopSettingsModule.register(fake.ctx);
    const lines = readFileSync(path.join(fake.ctx.paths.logs, LOG_FILE_NAME), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(line.indexOf(" ") + 1));
    expect(lines).toEqual(["desktop settings: not valid JSON; using defaults"]);
  });
});

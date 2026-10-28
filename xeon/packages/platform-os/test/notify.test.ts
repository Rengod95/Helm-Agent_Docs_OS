import { afterEach, expect, test } from "bun:test";
import { err, ok, type Logger } from "@xeon/contracts";
import type { NotifyError, OsInfo, OsNotification } from "@xeon/contracts/services";
import {
  buildNotifyCommand,
  createNotify,
  createOsNotifierProvider,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  type NotifierProvider,
} from "../src/notify/provider.ts";
import { createRunCommand } from "../src/proc.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "6.1.0" };
const WSL: OsInfo = { platform: "linux", arch: "x64", isWsl: true, release: "6.6-microsoft" };
const DARWIN: OsInfo = { platform: "darwin", arch: "arm64", isWsl: false, release: "24.0.0" };
const WIN: OsInfo = { platform: "win32", arch: "x64", isWsl: false, release: "10.0" };

const NOTE: OsNotification = { kind: "done", title: "Build done", body: "3 tests passed" };

function recordingLogger(lines: string[]): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (event) => lines.push(event),
    error: () => {},
    child: () => logger,
  };
  return logger;
}

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

test("linux argv sets the app name and guards option-like text with --", () => {
  expect(buildNotifyCommand(LINUX, { ...NOTE, title: "-rf" })).toEqual([
    "notify-send",
    "--app-name=Xeon",
    "--",
    "-rf",
    "3 tests passed",
  ]);
});

test("WSL uses the linux argv and never a PowerShell toast", () => {
  expect(buildNotifyCommand(WSL, NOTE)).toEqual(buildNotifyCommand(LINUX, NOTE));
  expect(
    createOsNotifierProvider({
      info: WSL,
      run: () => Promise.reject(new Error("x")),
      logger: recordingLogger([]),
    })?.id,
  ).toBe("os.os.notify/linux");
});

test("darwin argv escapes quotes and backslashes for the AppleScript literal", () => {
  expect(buildNotifyCommand(DARWIN, { ...NOTE, title: 'a"b', body: "c\\d" })).toEqual([
    "osascript",
    "-e",
    'display notification "c\\\\d" with title "a\\"b"',
  ]);
});

test("win32 has no provider in M3", () => {
  expect(buildNotifyCommand(WIN, NOTE)).toBeUndefined();
  expect(
    createOsNotifierProvider({
      info: WIN,
      run: () => Promise.reject(new Error("x")),
      logger: recordingLogger([]),
    }),
  ).toBeUndefined();
});

test("a fake notify-send receives exactly the argv values", async () => {
  temp = await tempDir();
  const out = temp.join("argv.txt");
  const fake = temp.join("notify-send");
  await Bun.write(fake, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${out}"; done\n`);
  const { chmod } = await import("node:fs/promises");
  await chmod(fake, 0o755);
  const provider = createOsNotifierProvider({
    info: LINUX,
    run: createRunCommand(),
    logger: recordingLogger([]),
    linuxCommand: fake,
  });
  expect(provider).toBeDefined();
  const sent = await provider?.send(
    { kind: "approval", title: "Approve?", body: "run `ls` in /tmp" },
    new AbortController().signal,
  );
  expect(sent).toEqual(ok(undefined));
  expect((await Bun.file(out).text()).split("\n")).toEqual([
    "--app-name=Xeon",
    "--",
    "Approve?",
    "run `ls` in /tmp",
    "",
  ]);
});

test("a missing notify-send is unavailable and logs notify.unavailable once", async () => {
  const lines: string[] = [];
  const provider = createOsNotifierProvider({
    info: LINUX,
    run: createRunCommand(),
    logger: recordingLogger(lines),
    linuxCommand: "/nonexistent/notify-send",
  });
  const signal = new AbortController().signal;
  const first = await provider?.send(NOTE, signal);
  const second = await provider?.send(NOTE, signal);
  const expected: NotifyError = {
    kind: "unavailable",
    provider: "os.os.notify/linux",
    reason: "ENOENT",
  };
  expect(first).toEqual(err(expected));
  expect(second).toEqual(err(expected));
  expect(lines).toEqual(["notify.unavailable"]);
});

function fakeProvider(sent: OsNotification[]): NotifierProvider {
  return {
    id: "fake",
    available: () => Promise.resolve(true),
    send: (n) => {
      sent.push(n);
      return Promise.resolve(ok(undefined));
    },
  };
}

test("no provider means disabled", async () => {
  const notify = createNotify({ provider: undefined, clock: manualClock(), redact: (t) => t });
  expect(await notify(NOTE, new AbortController().signal)).toEqual(err({ kind: "disabled" }));
});

test("redact is applied and text is cut at the title and body limits", async () => {
  const sent: OsNotification[] = [];
  const notify = createNotify({
    provider: fakeProvider(sent),
    clock: manualClock(),
    redact: (t) => t.replaceAll("sk-secret", "[REDACTED]"),
  });
  await notify(
    {
      kind: "error",
      title: "sk-secret".padEnd(200, "t"),
      body: `key sk-secret ${"b".repeat(500)}`,
    },
    new AbortController().signal,
  );
  expect(sent.length).toBe(1);
  expect(sent[0]?.title).toBe("[REDACTED]".padEnd(NOTIFY_TITLE_MAX, "t"));
  expect(sent[0]?.body.startsWith("key [REDACTED] bbb")).toBe(true);
  expect(sent[0]?.body.length).toBe(NOTIFY_BODY_MAX);
});

test("the same kind and thread within one second is sent once, after it again", async () => {
  const sent: OsNotification[] = [];
  const clock = manualClock();
  const notify = createNotify({ provider: fakeProvider(sent), clock, redact: (t) => t });
  const signal = new AbortController().signal;
  await notify(NOTE, signal);
  await clock.advance(999);
  await notify(NOTE, signal);
  await notify({ ...NOTE, kind: "error" }, signal);
  await clock.advance(1);
  await notify(NOTE, signal);
  expect(sent.map((n) => n.kind)).toEqual(["done", "error", "done"]);
});

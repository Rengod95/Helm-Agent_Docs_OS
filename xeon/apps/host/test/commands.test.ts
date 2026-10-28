import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostArgv } from "../src/argv.ts";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";
import { runHostCommand, type CommandIo } from "../src/main.ts";
import { renderSettingsSchema } from "../src/settings.ts";
import { useEngineHome } from "./fixtures/engine-home.ts";
import { writeUserSettings } from "./fixtures/user-settings.ts";

const scratch = mkdtempSync(join(tmpdir(), "xh-cmd-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function captureIo(): { readonly io: CommandIo; stdout(): string; stderr(): string } {
  const decoder = new TextDecoder();
  const out: string[] = [];
  const err: string[] = [];
  const sink = (target: string[]): WritableStream<Uint8Array> =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        target.push(decoder.decode(chunk));
      },
    });
  return {
    io: {
      stdin: new ReadableStream<Uint8Array>(),
      stdout: sink(out),
      stderr: sink(err),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

function coreSchema(scope: "managed" | "user" | "project" | "local"): string {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return renderSettingsSchema(built.catalog, scope);
}

test("config-schema writes the schema to stdout and exits 0", async () => {
  const captured = captureIo();
  const code = await runHostCommand(
    { kind: "config-schema", scope: "user", coreOnly: true },
    captured.io,
  );
  expect(code).toBe(0);
  expect(captured.stdout()).toBe(coreSchema("user"));
  expect(captured.stderr()).toBe("");
});

test("config-schema --out writes the file and leaves stdout empty", async () => {
  const captured = captureIo();
  const out = join(scratch, "managed.json");
  const code = await runHostCommand(
    { kind: "config-schema", scope: "managed", coreOnly: false, out },
    captured.io,
  );
  expect(code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(coreSchema("managed"));
  expect(captured.stdout()).toBe("");
});

test("service status and stop with no service running: status exits 1 with a value, stop exits 0", async () => {
  const home = useEngineHome();
  try {
    const status = captureIo();
    expect(await runHostCommand({ kind: "service-status", json: true }, status.io)).toBe(1);
    expect(JSON.parse(status.stdout())).toEqual({ running: false, reason: "no_registration" });
    const stop = captureIo();
    expect(await runHostCommand({ kind: "service-stop" }, stop.io)).toBe(0);
    expect(stop.stdout()).toBe("service not running\n");
  } finally {
    home.dispose();
  }
});

test("service launch-mode reads the user settings file without an engine", async () => {
  const home = useEngineHome();
  try {
    const off = captureIo();
    expect(await runHostCommand({ kind: "service-launch-mode" }, off.io)).toBe(0);
    expect(JSON.parse(off.stdout())).toEqual({ mode: "in-process" });
    writeUserSettings(home, { "l0.process.service.enabled": true });
    const on = captureIo();
    expect(await runHostCommand({ kind: "service-launch-mode" }, on.io)).toBe(0);
    expect(JSON.parse(on.stdout())).toEqual({ mode: "service" });
  } finally {
    home.dispose();
  }
});

test("service ensure reports a spawn failure as a json value and exits 1", async () => {
  const home = useEngineHome();
  try {
    const captured = captureIo();
    const code = await runHostCommand(
      { kind: "service-ensure", start: { command: "/nonexistent/xeon", args: [] } },
      captured.io,
    );
    expect(code).toBe(1);
    expect(JSON.parse(captured.stdout())).toEqual({ ok: false, reason: "spawn_failed" });
  } finally {
    home.dispose();
  }
});

test("parseHostArgv maps the development entry arguments to commands", () => {
  expect(parseHostArgv(["host", "--stdio"])).toEqual({ ok: true, command: { kind: "host-stdio" } });
  expect(
    parseHostArgv(["config", "schema", "--scope", "project", "--out", "x.json", "--core-only"]),
  ).toEqual({
    ok: true,
    command: { kind: "config-schema", scope: "project", coreOnly: true, out: "x.json" },
  });
  expect(parseHostArgv(["config", "schema", "--scope", "local"])).toEqual({
    ok: true,
    command: { kind: "config-schema", scope: "local", coreOnly: false },
  });
  expect(parseHostArgv(["service", "status", "--json"])).toEqual({
    ok: true,
    command: { kind: "service-status", json: true },
  });
  expect(parseHostArgv(["service", "launch-mode"])).toEqual({
    ok: true,
    command: { kind: "service-launch-mode" },
  });
});

test("parseHostArgv rejects what it does not know", () => {
  expect(parseHostArgv([]).ok).toBe(false);
  expect(parseHostArgv(["host"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--stdio", "extra"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "session"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "user", "--wat"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "user", "--out"]).ok).toBe(false);
  expect(parseHostArgv(["service", "bogus"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--wat"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--listen-tcp", "nohost"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--listen-tcp", "x:99999"]).ok).toBe(false);
});

test("parseHostArgv maps host --service and service run to service-run with safe mode and tcp", () => {
  expect(parseHostArgv(["host", "--service"])).toEqual({
    ok: true,
    command: { kind: "service-run", safeMode: false },
  });
  expect(
    parseHostArgv(["service", "run", "--safe-mode", "--listen-tcp", "127.0.0.1:7777"]),
  ).toEqual({
    ok: true,
    command: { kind: "service-run", safeMode: true, tcp: { host: "127.0.0.1", port: 7777 } },
  });
});

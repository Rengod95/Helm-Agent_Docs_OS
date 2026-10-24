import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostArgv } from "../src/argv.ts";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";
import { runHostCommand, type CommandIo } from "../src/main.ts";
import { renderSettingsSchema } from "../src/settings.ts";

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

test("service commands are not available before M3 and exit 1 with a message on stderr", async () => {
  const kinds = [
    "service-run",
    "service-start",
    "service-stop",
    "service-ensure",
    "service-launch-mode",
  ] as const;
  await Promise.all(
    kinds.map(async (kind) => {
      const captured = captureIo();
      expect(await runHostCommand({ kind }, captured.io)).toBe(1);
      expect(captured.stderr()).toContain("M3");
      expect(captured.stdout()).toBe("");
    }),
  );
  const status = captureIo();
  expect(await runHostCommand({ kind: "service-status", json: true }, status.io)).toBe(1);
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
});

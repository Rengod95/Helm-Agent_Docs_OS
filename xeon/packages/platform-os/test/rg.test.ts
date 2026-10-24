import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { BinaryName } from "@xeon/contracts/services";
import { createRipgrepSource } from "../src/binaries/rg.ts";
import type { CommandOutput, RunCommand } from "../src/proc.ts";
import { memoryLogger } from "./support/clock.ts";

const signal = new AbortController().signal;
const load = (): Promise<{ readonly rgPath: string }> => Promise.resolve({ rgPath: "/bundled/rg" });

function runner(reply: ReturnType<RunCommand>, calls: string[][] = []): RunCommand {
  return (argv) => {
    calls.push([...argv]);
    return reply;
  };
}

function output(stdout: string, exitCode = 0): ReturnType<RunCommand> {
  const out: CommandOutput = { exitCode, stdout };
  return Promise.resolve(ok(out));
}

describe("createRipgrepSource", () => {
  test("gives the @vscode/ripgrep path with the version rg reports", async () => {
    const calls: string[][] = [];
    const source = createRipgrepSource({
      logger: memoryLogger().logger,
      run: runner(output("ripgrep 14.1.1 (rev abc)\nfeatures:+pcre2\n"), calls),
      load: () => Promise.resolve({ rgPath: "/node_modules/@vscode/ripgrep-linux-x64/bin/rg" }),
    });
    expect(await source("rg", signal)).toEqual(
      ok({ path: "/node_modules/@vscode/ripgrep-linux-x64/bin/rg", version: "14.1.1" }),
    );
    expect(calls).toEqual([["/node_modules/@vscode/ripgrep-linux-x64/bin/rg", "--version"]]);
  });

  test("other binaries have no bundled source and rg is never run for them", async () => {
    const calls: string[][] = [];
    const source = createRipgrepSource({
      logger: memoryLogger().logger,
      run: runner(output("x"), calls),
      load: () => Promise.resolve({ rgPath: "/rg" }),
    });
    const names = ["sops", "age", "git", "bwrap", "socat"] as const satisfies readonly BinaryName[];
    const results = await Promise.all(names.map((name) => source(name, signal)));
    expect(results).toEqual(names.map(() => ok(undefined)));
    expect(calls).toEqual([]);
  });

  test("a missing platform package means no bundled rg, so the system rg is used", async () => {
    const calls: string[][] = [];
    const { logger, records } = memoryLogger();
    const source = createRipgrepSource({
      logger,
      run: runner(output("x"), calls),
      load: () => Promise.reject(new Error("Could not find @vscode/ripgrep-linux-x64")),
    });
    expect(await source("rg", signal)).toEqual(ok(undefined));
    expect(calls).toEqual([]);
    // 원인은 사라지지 않고 debug로 남는다
    expect(records).toEqual([
      { level: "debug", event: "os.rg.bundle_unavailable", fields: { code: "Error" } },
    ]);
  });

  test("a bundled rg that cannot report a version is version_unreadable", async () => {
    expect(
      await createRipgrepSource({
        logger: memoryLogger().logger,
        run: runner(output("no digits here")),
        load,
      })("rg", signal),
    ).toEqual(err({ kind: "version_unreadable", name: "rg", path: "/bundled/rg" }));
    expect(
      await createRipgrepSource({
        logger: memoryLogger().logger,
        run: runner(output("ripgrep 14.1.1", 2)),
        load,
      })("rg", signal),
    ).toEqual(err({ kind: "version_unreadable", name: "rg", path: "/bundled/rg" }));
    expect(
      await createRipgrepSource({
        logger: memoryLogger().logger,
        run: runner(Promise.resolve(err({ kind: "spawn_failed", code: "EACCES" }))),
        load,
      })("rg", signal),
    ).toEqual(err({ kind: "version_unreadable", name: "rg", path: "/bundled/rg" }));
  });

  test("a cancelled run is cancelled", async () => {
    const source = createRipgrepSource({
      logger: memoryLogger().logger,
      run: runner(Promise.resolve(err({ kind: "cancelled" }))),
      load: () => Promise.resolve({ rgPath: "/bundled/rg" }),
    });
    expect(await source("rg", signal)).toEqual(err({ kind: "cancelled" }));
  });
});

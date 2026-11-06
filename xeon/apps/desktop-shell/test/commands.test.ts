import { describe, expect, test } from "bun:test";
import { createCommandRegistry, ShellError } from "../src/main/commands.ts";
import { isTrustedFrame } from "../src/main/frame-check.ts";
import type { IpcCaller } from "../src/main/context.ts";

const caller: IpcCaller = { sender: Object.create(null) };

describe("command registry", () => {
  test("dispatches a registered command with its args", async () => {
    const registry = createCommandRegistry();
    registry.handle("echo", (_caller, args) => ({ got: args }));
    expect(await registry.dispatch(caller, "echo", 7)).toEqual({ ok: true, value: { got: 7 } });
  });

  test("rejects an unknown command", async () => {
    const registry = createCommandRegistry();
    expect(await registry.dispatch(caller, "nope", null)).toEqual({
      ok: false,
      error: "unknown-command",
    });
    expect(await registry.dispatch(caller, 5, null)).toEqual({
      ok: false,
      error: "unknown-command",
    });
  });

  test("passes a ShellError payload and hides other errors", async () => {
    const registry = createCommandRegistry();
    registry.handle("deny", () => {
      throw new ShellError({ kind: "busy" });
    });
    registry.handle("boom", () => {
      throw new Error("secret path /Users/x");
    });
    expect(await registry.dispatch(caller, "deny", null)).toEqual({
      ok: false,
      error: { kind: "busy" },
    });
    expect(await registry.dispatch(caller, "boom", null)).toEqual({ ok: false, error: "internal" });
  });

  test("registering a name twice throws", () => {
    const registry = createCommandRegistry();
    registry.handle("a", () => null);
    expect(() => {
      registry.handle("a", () => null);
    }).toThrow("command registered twice: a");
  });
});

describe("frame check", () => {
  test("accepts only the top frame of the UI origin", () => {
    expect(isTrustedFrame({ url: "app://localhost/index.html", isMain: true })).toBe(true);
    expect(isTrustedFrame({ url: "app://localhost/index.html", isMain: false })).toBe(false);
    expect(isTrustedFrame({ url: "fresnel-view://x/a.html", isMain: true })).toBe(false);
    expect(isTrustedFrame({ url: "https://evil.example/", isMain: true })).toBe(false);
    expect(isTrustedFrame({ url: "not a url", isMain: true })).toBe(false);
    expect(isTrustedFrame(null)).toBe(false);
  });
});

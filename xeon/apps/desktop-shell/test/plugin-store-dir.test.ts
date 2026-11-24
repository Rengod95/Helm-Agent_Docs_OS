import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { Launcher } from "../src/main/engine/launcher.ts";
import { createPluginStoreDirSource } from "../src/main/lib/plugin-store-dir.ts";

function launcherOf(
  once: () => ReturnType<Launcher["runOnce"]>,
  calls: { count: number },
): Launcher {
  return {
    launch: () => Promise.resolve(err({ message: "not used" })),
    runOnce: () => {
      calls.count += 1;
      return once();
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("plugin store dir source", () => {
  test("the first read starts the lookup, and the next read returns <dataDir>/plugin-store", async () => {
    const calls = { count: 0 };
    const source = createPluginStoreDirSource(
      launcherOf(
        () =>
          Promise.resolve(
            ok({ exitCode: 0, stdout: JSON.stringify({ dataDir: "/data/fresnel" }), stderr: "" }),
          ),
        calls,
      ),
    );
    expect(source.current()).toBeUndefined();
    expect(source.current()).toBeUndefined();
    expect(calls.count).toBe(1);
    await settle();
    expect(source.current()).toBe("/data/fresnel/plugin-store");
    expect(calls.count).toBe(1);
  });

  test("a failing CLI, a non-zero exit, or a relative dataDir leaves it unknown and the next read tries again", async () => {
    const calls = { count: 0 };
    let reply: ReturnType<Launcher["runOnce"]> = Promise.resolve(err({ message: "no sidecar" }));
    const source = createPluginStoreDirSource(launcherOf(() => reply, calls));
    expect(source.current()).toBeUndefined();
    await settle();
    reply = Promise.resolve(ok({ exitCode: 2, stdout: "", stderr: "x" }));
    expect(source.current()).toBeUndefined();
    await settle();
    reply = Promise.resolve(
      ok({ exitCode: 0, stdout: JSON.stringify({ dataDir: "relative/dir" }), stderr: "" }),
    );
    expect(source.current()).toBeUndefined();
    await settle();
    expect(source.current()).toBeUndefined();
    expect(calls.count).toBe(4);
  });
});

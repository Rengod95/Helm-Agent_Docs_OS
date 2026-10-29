import { afterEach, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import type { EngineConnectOptions } from "../src/engine.ts";
import { devWireRoundTripOf } from "../src/dev-mode.ts";
import { EXIT } from "../src/exit-codes.ts";
import { cliSettings } from "../src/settings.ts";
import { createHarness, type Harness } from "./support/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

test("a source run or XEON_DEV=1 turns the dev wire checks on; a compiled binary turns them off (AC11)", () => {
  expect(devWireRoundTripOf({}, "/home/user/xeon/apps/cli/src/main.ts")).toBe(true);
  expect(devWireRoundTripOf({ XEON_DEV: "1" }, "/$bunfs/root/xeon")).toBe(true);
  expect(devWireRoundTripOf({}, "/$bunfs/root/xeon")).toBe(false);
  expect(devWireRoundTripOf({ XEON_DEV: "0" }, "/$bunfs/root/xeon")).toBe(false);
});

test("connectEngine hands devChecks and the l4.cli settings group to startInProcessHost", async () => {
  const dev = harness({ devWireRoundTrip: true });
  await dev.run(["config", "get", "l4.cli.outputMode"]);
  expect(dev.startOptions[0]?.devChecks).toBe(true);
  expect(dev.startOptions[0]?.settingGroups).toEqual([cliSettings]);

  const release = harness({ devWireRoundTrip: false });
  await release.run(["config", "get", "l4.cli.outputMode"]);
  expect(release.startOptions[0]?.devChecks).toBe(false);
});

test("--remote reaches connectEngine as the raw flag, with the environment and the auto preference", async () => {
  const seen: EngineConnectOptions[] = [];
  const h = harness({
    env: { XEON_REMOTE_TOKEN: "tok-from-env" },
    connect: (options) => {
      seen.push(options);
      return Promise.resolve(err({ kind: "serviceUnreachable", message: "m", fix: "f" }));
    },
  });
  expect(await h.run(["--remote", "tcp://box:7000", "chat", "-p", "x"])).toBe(EXIT.environment);
  expect(seen[0]).toMatchObject({ remote: "tcp://box:7000", preference: "auto" });
  expect(seen[0]?.env).toEqual({ XEON_REMOTE_TOKEN: "tok-from-env" });
  expect(await h.run(["chat", "-p", "x"])).toBe(EXIT.environment);
  expect(seen[1]).not.toHaveProperty("remote");
});

test("the in-process engine is the default and the host sees no extra plugins", async () => {
  const h = harness();
  await h.run(["config", "get", "l4.cli.outputMode"]);
  expect(h.startOptions[0]).not.toHaveProperty("extraPlugins");
  expect(h.startOptions[0]).not.toHaveProperty("dataDir");
});

test("l4.cli.* settings are valid definitions with four keys on the appearance tab", () => {
  expect(Object.keys(cliSettings.defs).toSorted()).toEqual([
    "keybindingsFile",
    "outputMode",
    "statusLine",
    "theme",
  ]);
  for (const def of Object.values(cliSettings.defs)) {
    expect(def.layer).toBe("L4");
    expect(def.ui?.tab).toBe("appearance");
    expect(def.key.startsWith("l4.cli.")).toBe(true);
  }
  expect(cliSettings.defs.keybindingsFile.runtimeChange).toBe("restart");
  expect(cliSettings.defs.keybindingsFile.allowedScopes).not.toContain("session");
  expect(cliSettings.defs.outputMode.default).toBe("text");
  expect(cliSettings.defs.statusLine.default).toEqual(["model", "cwd", "session"]);
});

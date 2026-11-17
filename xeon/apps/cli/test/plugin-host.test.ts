import { afterEach, expect, test } from "bun:test";
import { parseArgv } from "../src/cli/command.ts";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// `fresnel plugin-host --stdio`(내부 진입, L4.host-service.spec §4.9). 인자는 정확히 `--stdio`이고, 도움말에 없고, 엔진을 열지 않는다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness({ env: { NO_COLOR: "1" }, ...options });
  harnesses.push(created);
  return created;
}

const TERMINAL = { stdinIsTty: false, stdoutIsTty: false, columns: null };

test("plugin-host parses exactly --stdio", () => {
  const parsed = parseArgv(["plugin-host", "--stdio"], TERMINAL, {});
  expect(parsed.ok ? parsed.value.command : null).toEqual({ kind: "plugin-host", stdio: true });
});

test("plugin-host rejects every other shape as a usage error", () => {
  const missing = parseArgv(["plugin-host"], TERMINAL, {});
  expect(missing.ok ? null : missing.error.code).toBe("missingArgument");
  expect(missing.ok ? null : missing.error.fix).toBe("fresnel plugin-host --stdio");

  for (const rest of [
    ["--foo"],
    ["--stdio", "x"],
    ["x"],
    ["--stdio", "--stdio"],
    ["--stdio", "-h"],
  ]) {
    const parsed = parseArgv(["plugin-host", ...rest], TERMINAL, {});
    expect(parsed.ok ? null : parsed.error.code).toBe("unexpectedArgument");
  }
});

test("dispatch hands the process streams to the injected runner and never starts the engine", async () => {
  const seen: string[] = [];
  const h = harness({
    stdin: "ping",
    runPluginHost: async (io) => {
      seen.push(await new Response(io.stdin).text());
      const writer = io.stdout.getWriter();
      await writer.write(new TextEncoder().encode("frame\n"));
      await writer.close();
      return 0;
    },
  });
  expect(await h.run(["plugin-host", "--stdio"])).toBe(EXIT.ok);
  expect(seen).toEqual(["ping"]);
  expect(new TextDecoder().decode(Buffer.concat(h.stdoutBytes))).toBe("frame\n");
  expect(h.stdout).toEqual([]);
  expect(h.startOptions).toEqual([]);
  expect(h.methods()).toEqual([]);
});

test("a failed runner maps to the general error code 1", async () => {
  const h = harness({ runPluginHost: () => Promise.resolve(1) });
  expect(await h.run(["plugin-host", "--stdio"])).toBe(EXIT.error);
});

test("a usage error exits 2 without calling the runner", async () => {
  const calls: number[] = [];
  const h = harness({
    runPluginHost: () => {
      calls.push(1);
      return Promise.resolve(0);
    },
  });
  expect(await h.run(["plugin-host"])).toBe(EXIT.usage);
  expect(calls).toEqual([]);
});

test("the help text does not advertise plugin-host", async () => {
  const h = harness();
  expect(await h.run(["help"])).toBe(EXIT.ok);
  expect(h.stdoutText()).not.toContain("plugin-host");
});

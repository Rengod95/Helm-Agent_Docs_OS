import { afterEach, expect, test } from "bun:test";
import type { HostExit, StdioHostOptions } from "@xeon/host";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(exit: HostExit, seen: StdioHostOptions[] = []): Harness {
  const h = createHarness({
    startStdioHost: (options) => {
      seen.push(options);
      return Promise.resolve(exit);
    },
  });
  harnesses.push(h);
  return h;
}

test("host --stdio starts the stdio host with the CLI settings group and never connects an engine", async () => {
  const seen: StdioHostOptions[] = [];
  const h = harness({ code: 0, reason: "eof" }, seen);
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.ok);
  expect(seen).toHaveLength(1);
  const [options] = seen;
  expect(options?.readable).toBeInstanceOf(ReadableStream);
  expect(options?.writable).toBeInstanceOf(WritableStream);
  expect(options?.assemble?.settingGroups?.map((group) => group.namespace)).toEqual(["l4.cli"]);
  expect(options?.assemble?.devChecks).toBe(false);
  expect(h.closed()).toBe(false);
  expect(h.methods()).toEqual([]);
});

test("the contract stream is the byte stdout: nothing human-readable goes to stdout", async () => {
  const h = createHarness({
    startStdioHost: async (options) => {
      const writer = options.writable.getWriter();
      await writer.write(new TextEncoder().encode('{"jsonrpc":"2.0"}\n'));
      writer.releaseLock();
      return { code: 0, reason: "eof" };
    },
  });
  harnesses.push(h);
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.ok);
  expect(new TextDecoder().decode(Buffer.concat(h.stdoutBytes))).toBe('{"jsonrpc":"2.0"}\n');
  expect(h.stdoutText()).toBe("");
});

test("a host that refuses to start exits 1 and explains on stderr only", async () => {
  const h = harness({ code: 1, reason: "startup", message: "store is locked" });
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe("xeon: store is locked\n");
  expect(h.stdoutText()).toBe("");
  expect(h.stdoutBytes).toEqual([]);
});

test("a host that stops on a signal after its deadline exits 1", async () => {
  const h = harness({ code: 1, reason: "signal", message: "the running turn did not stop" });
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.error);
});

test("a development build passes the wire round trip check down, a compiled one does not", async () => {
  const seen: StdioHostOptions[] = [];
  const h = createHarness({
    devWireRoundTrip: true,
    startStdioHost: (options) => {
      seen.push(options);
      return Promise.resolve({ code: 0, reason: "eof" });
    },
  });
  harnesses.push(h);
  await h.run(["host", "--stdio"]);
  expect(seen[0]?.assemble?.devChecks).toBe(true);
});

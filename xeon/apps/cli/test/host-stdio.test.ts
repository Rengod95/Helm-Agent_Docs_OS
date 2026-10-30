import { afterEach, expect, test } from "bun:test";
import type {
  BridgeExit,
  BridgeOptions,
  HostExit,
  RemoteResolution,
  ServiceEndpoint,
  StdioHostOptions,
} from "@xeon/host";
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
  expect(options?.assemble?.settingGroups?.map((group) => group.namespace)).toEqual([
    "l4.cli",
    "l4.ui",
  ]);
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

// 원격 주소가 있으면 엔진을 열지 않고 원격 서비스에 중계한다(HS-89)

const REMOTE: ServiceEndpoint = { kind: "unix", path: "/run/xeon/service.sock" };

test("a remote address relays stdin and stdout to the remote service and never starts the host", async () => {
  const flags: unknown[] = [];
  const bridged: BridgeOptions[] = [];
  const started: StdioHostOptions[] = [];
  const h = createHarness({
    resolveRemote: (options) => {
      flags.push(options);
      return Promise.resolve<RemoteResolution>({ kind: "remote", endpoint: REMOTE, from: "flag" });
    },
    bridgeStdio: (options) => {
      bridged.push(options);
      return Promise.resolve<BridgeExit>({ code: 0, reason: "stdin_closed" });
    },
    startStdioHost: (options) => {
      started.push(options);
      return Promise.resolve({ code: 0, reason: "eof" });
    },
  });
  harnesses.push(h);
  expect(await h.run(["--remote", "unix:/run/xeon/service.sock", "host", "--stdio"])).toBe(EXIT.ok);
  expect(flags).toEqual([{ flag: "unix:/run/xeon/service.sock", env: {} }]);
  expect(bridged).toHaveLength(1);
  expect(bridged[0]?.endpoint).toEqual(REMOTE);
  expect(bridged[0]?.readable).toBeInstanceOf(ReadableStream);
  expect(bridged[0]?.writable).toBeInstanceOf(WritableStream);
  expect(started).toEqual([]);
  expect(h.closed()).toBe(false);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("");
});

test("a remote that closes exits 1 with a two-line explanation on stderr", async () => {
  const h = createHarness({
    resolveRemote: () =>
      Promise.resolve<RemoteResolution>({ kind: "remote", endpoint: REMOTE, from: "setting" }),
    bridgeStdio: () => Promise.resolve<BridgeExit>({ code: 1, reason: "remote_closed" }),
  });
  harnesses.push(h);
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "xeon: 원격 서비스 연결이 끊겼다\n  해결: xeon service status로 원격 서비스를 확인하고 다시 실행한다\n",
  );
  expect(h.stdoutText()).toBe("");
});

test("a connect failure to the remote exits with the start error's code and explains it on stderr", async () => {
  const h = createHarness({
    resolveRemote: () =>
      Promise.resolve<RemoteResolution>({ kind: "remote", endpoint: REMOTE, from: "flag" }),
    bridgeStdio: () =>
      Promise.resolve<BridgeExit>({
        code: 1,
        reason: "connect_failed",
        error: { kind: "not_found", path: "/run/xeon/service.sock" },
      }),
  });
  harnesses.push(h);
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.environment);
  expect(h.stderrText()).toBe(
    "xeon: 서비스 소켓이 없다\n  해결: 원격 서비스가 켜져 있고 주소가 맞는지 확인한다\n",
  );
  expect(h.stdoutText()).toBe("");
});

test("bridge diagnostics go to stderr after the relay ends, never to stdout", async () => {
  const h = createHarness({
    resolveRemote: () =>
      Promise.resolve<RemoteResolution>({ kind: "remote", endpoint: REMOTE, from: "flag" }),
    bridgeStdio: (options) => {
      options.diagnose("dropped an invalid client frame");
      return Promise.resolve<BridgeExit>({ code: 0, reason: "stdin_closed" });
    },
  });
  harnesses.push(h);
  expect(await h.run(["host", "--stdio"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("xeon: dropped an invalid client frame\n");
  expect(h.stdoutBytes).toEqual([]);
});

test("an invalid remote address exits 2 and starts nothing", async () => {
  let bridges = 0;
  let starts = 0;
  const h = createHarness({
    resolveRemote: () =>
      Promise.resolve<RemoteResolution>({
        kind: "invalid",
        text: "ftp://box/x",
        from: "flag",
        error: { kind: "unknown_scheme" },
      }),
    bridgeStdio: () => {
      bridges += 1;
      return Promise.resolve<BridgeExit>({ code: 0, reason: "stdin_closed" });
    },
    startStdioHost: () => {
      starts += 1;
      return Promise.resolve({ code: 0, reason: "eof" });
    },
  });
  harnesses.push(h);
  expect(await h.run(["--remote", "ftp://box/x", "host", "--stdio"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("--remote 주소 형식이 맞지 않다: ftp://box/x");
  expect(bridges).toBe(0);
  expect(starts).toBe(0);
  expect(h.stdoutText()).toBe("");
});

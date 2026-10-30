import { afterEach, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { WireError, wireError } from "@xeon/contracts/wire";
import type { ConnectEngine, EngineStartErrorKind } from "../src/engine.ts";
import { exitCodeOfStartError, failureOfWire } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";
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

function failing(kind: EngineStartErrorKind): ConnectEngine {
  return () => Promise.resolve(err({ kind, message: `${kind} message`, fix: `${kind} fix` }));
}

test("catalog conflicts, missing services and plugin failures are 1; the rest of the start errors are 3 (§4.10)", () => {
  const ones: readonly EngineStartErrorKind[] = [
    "catalogConflict",
    "missingService",
    "pluginFailed",
  ];
  const threes: readonly EngineStartErrorKind[] = [
    "fts5Missing",
    "sopsMissing",
    "dataDirPermission",
    "storeUnavailable",
    "serviceUnreachable",
    "protocolUnsupported",
  ];
  for (const kind of ones) expect(exitCodeOfStartError(kind)).toBe(EXIT.error);
  for (const kind of threes) expect(exitCodeOfStartError(kind)).toBe(EXIT.environment);
});

test("an invalid remote address is a usage error, exit 2 (HS-87)", () => {
  expect(exitCodeOfStartError("invalidRemote")).toBe(EXIT.usage);
});

test("a start error prints its message and fix on two lines and exits with its code", async () => {
  const environment = harness({ connect: failing("fts5Missing") });
  expect(await environment.run(["chat", "-p", "x"])).toBe(EXIT.environment);
  expect(environment.stderrText()).toBe("xeon: fts5Missing message\n  해결: fts5Missing fix\n");

  const broken = harness({ connect: failing("catalogConflict") });
  expect(await broken.run(["config", "get"])).toBe(EXIT.error);
});

test("a lock denied by the host is exit 4 (AC8)", async () => {
  const h = harness({
    server: {
      failures: {
        "turn.start": wireError("thread.locked", {
          details: { ownerKind: "app", options: ["observe"] },
        }),
      },
    },
  });
  expect(await h.run(["chat", "-p", "x"])).toBe(EXIT.lockDenied);
});

function code(kind: Parameters<typeof wireError>[0]): number {
  return failureOfWire(wireError(kind, { details: {} })).code;
}

test("wire error kinds map to the §4.10 table", () => {
  expect(code("thread.notFound")).toBe(EXIT.error);
  expect(code("thread.locked")).toBe(EXIT.lockDenied);
  expect(code("turn.busy")).toBe(EXIT.error);
  expect(code("settings.unknownKey")).toBe(EXIT.usage);
  expect(code("settings.invalidValue")).toBe(EXIT.usage);
  expect(code("settings.scopeNotAllowed")).toBe(EXIT.usage);
  expect(code("settings.locked")).toBe(EXIT.error);
  expect(code("settings.secretValue")).toBe(EXIT.usage);
  expect(code("protocol.unsupported")).toBe(EXIT.environment);
  expect(code("host.shuttingDown")).toBe(EXIT.error);
  expect(code("internal")).toBe(EXIT.error);
  expect(code("events.subscriptionLimit")).toBe(EXIT.error);
});

test("wire messages never reach the user: only kind and details are used", () => {
  const error = new WireError(-32603, "secret developer text", {
    kind: "internal",
    retryable: true,
  });
  const failure = failureOfWire(error);
  expect(JSON.stringify(failure)).not.toContain("developer text");
});

test("settings.invalidValue shows the first issue; scopeNotAllowed lists the allowed scopes", () => {
  const invalid = failureOfWire(
    wireError("settings.invalidValue", {
      details: { key: "l4.cli.theme", issues: [{ path: "", message: "must be one of" }] },
    }),
  );
  expect(invalid.message).toContain("must be one of");
  const scope = failureOfWire(
    wireError("settings.scopeNotAllowed", {
      details: { key: "l4.cli.theme", scope: "project", allowedScopes: ["user", "local"] },
    }),
  );
  expect(scope.fix).toBe("허용 범위: user, local");
});

test("an unknown setting key from config get is exit 2", async () => {
  const h = harness();
  expect(await h.run(["config", "get", "l4.cli.nothing"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("등록되지 않은 설정 키: l4.cli.nothing");
});

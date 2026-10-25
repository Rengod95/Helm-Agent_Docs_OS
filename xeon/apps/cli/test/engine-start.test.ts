import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { wireError, type JsonRpcMessage } from "@xeon/contracts/wire";
import { AssembleError } from "@xeon/host";
import { createHostConnection } from "../src/host-client.ts";
import {
  createConnectEngine,
  startErrorOf,
  tapTransport,
  type EngineConnectOptions,
  type HostApi,
  type StartedHost,
} from "../src/engine.ts";
import { cliSettings } from "../src/settings.ts";
import { startFakeServer } from "./support/fake-server.ts";
import { storeId } from "./support/ids.ts";
import { createTransportPair } from "./support/memory-transport.ts";

const OPTIONS: EngineConnectOptions = {
  workspace: "/work",
  preference: "auto",
  client: { name: "xeon-cli", version: "0.0.0" },
  settingGroups: [cliSettings],
  devWireRoundTrip: false,
};

function api(
  start: HostApi["startInProcessHost"],
  resolveStatePaths: HostApi["resolveHostStatePaths"] = (resolveOptions) =>
    Promise.resolve(
      ok({
        stateDir: "/state",
        cliStateFile: resolveOptions?.cliStateFileOverride ?? "/state/cli/state.json",
      }),
    ),
): HostApi {
  return {
    startInProcessHost: start,
    resolveHostStatePaths: resolveStatePaths,
    createHostConnection,
  };
}

function started(
  close: () => Promise<"clean" | "deadline"> = () => Promise.resolve("clean"),
  failures: Parameters<typeof startFakeServer>[1]["failures"] = {},
): StartedHost {
  const pair = createTransportPair();
  startFakeServer(pair.server, { storeId: storeId(1), failures });
  return {
    client: pair.client,
    secretOutOfBand: { offerEntry: () => () => undefined, offerReveal: () => () => undefined },
    engine: { ports: { ids: { next: () => "evt_x" }, clock: { now: () => 1 } } },
    close,
  };
}

function countClose(state: { closed: number }): () => Promise<"clean" | "deadline"> {
  return () => {
    state.closed += 1;
    return Promise.resolve("clean");
  };
}

function storeKind(message: string): string {
  return startErrorOf(new AssembleError([{ code: "store", message, failure: "unavailable" }])).kind;
}

test("store issues map to fts5Missing, dataDirPermission and storeUnavailable", () => {
  expect(storeKind("fts5Missing")).toBe("fts5Missing");
  expect(storeKind("dataDirPermission")).toBe("dataDirPermission");
  expect(storeKind("storeUnavailable")).toBe("storeUnavailable");
  expect(storeKind("anything else")).toBe("storeUnavailable");
});

test("catalog, missing service and plugin issues map to their own kinds", () => {
  const catalog = startErrorOf(
    new AssembleError([
      {
        code: "catalog",
        issues: [{ code: "duplicateKey", key: "l1.loop.maxSteps", owners: ["a", "b"] }],
      },
    ]),
  );
  expect(catalog.kind).toBe("catalogConflict");
  expect(catalog.message).toContain("l1.loop.maxSteps");
  expect(
    startErrorOf(new AssembleError([{ code: "missingService", service: "xeon.tools" }])).kind,
  ).toBe("missingService");
  expect(
    startErrorOf(new AssembleError([{ code: "plugin", plugin: "platform-exec", message: "boom" }])),
  ).toMatchObject({ kind: "pluginFailed" });
  expect(
    startErrorOf(
      new AssembleError([{ code: "plugin", plugin: "platform-secrets", message: "no binary" }]),
    ).kind,
  ).toBe("sopsMissing");
});

test("a catalog problem wins over a store problem when both are reported", () => {
  const error = startErrorOf(
    new AssembleError([
      { code: "store", message: "fts5Missing", failure: "unavailable" },
      { code: "catalog", issues: [{ code: "foreignNamespace", key: "x.a.b", owner: "o" }] },
    ]),
  );
  expect(error.kind).toBe("catalogConflict");
});

test("an AssembleError from the host becomes an EngineStartError value", async () => {
  const connect = createConnectEngine(
    api(() =>
      Promise.reject(
        new AssembleError([
          { code: "store", message: "dataDirPermission", failure: "unavailable" },
        ]),
      ),
    ),
  );
  const result = await connect(OPTIONS);
  expect(result).toMatchObject({ ok: false, error: { kind: "dataDirPermission" } });
});

test("any other failure while starting is a bug and is thrown", async () => {
  const connect = createConnectEngine(api(() => Promise.reject(new TypeError("bug"))));
  const outcome = await connect(OPTIONS).then(
    () => "resolved",
    (caught: unknown) => caught,
  );
  expect(outcome).toBeInstanceOf(TypeError);
});

test("the service preference is not available before M3", async () => {
  const connect = createConnectEngine(api(() => Promise.resolve(started())));
  const result = await connect({ ...OPTIONS, preference: "service" });
  expect(result).toMatchObject({ ok: false, error: { kind: "serviceUnreachable" } });
});

test("a hello the server refuses as incompatible is protocolUnsupported and closes the host", async () => {
  const state = { closed: 0 };
  const connect = createConnectEngine(
    api(() =>
      Promise.resolve(
        started(countClose(state), {
          "host.hello": wireError("protocol.unsupported", {
            details: { serverVersion: "0.1.0", clientVersion: "9.0.0" },
          }),
        }),
      ),
    ),
  );
  const result = await connect(OPTIONS);
  expect(result).toMatchObject({ ok: false, error: { kind: "protocolUnsupported" } });
  expect(state.closed).toBe(1);
});

test("the handle reports the store id and transport from host.hello and shuts down once", async () => {
  const state = { closed: 0 };
  const connect = createConnectEngine(api(() => Promise.resolve(started(countClose(state)))));
  const result = await connect({ ...OPTIONS, stateFile: "/tmp/x.json" });
  if (!result.ok) throw new Error("connect failed");
  const handle = result.value;
  expect(handle.storeId).toBe(storeId(1));
  expect(handle.transport).toBe("in-process");
  expect(handle.paths.cliStateFile).toBe("/tmp/x.json");
  expect(handle.newRequestId()).toBe("evt_x");
  expect(await handle.shutdown("user")).toBe("clean");
  expect(await handle.shutdown("signal")).toBe("clean");
  expect(state.closed).toBe(1);
});

test("a host whose turn did not stop in time reports a deadline", async () => {
  const state = { closed: 0 };
  const host = started(() => {
    state.closed += 1;
    return Promise.resolve("deadline");
  });
  const connect = createConnectEngine(api(() => Promise.resolve(host)));
  const result = await connect(OPTIONS);
  if (!result.ok) throw new Error("connect failed");
  expect(await result.value.shutdown("signal")).toBe("deadline");
  expect(state.closed).toBe(1);
});

test("a host that fails to close throws its cause instead of reporting a deadline, and the connection is still closed", async () => {
  const stuck = new TypeError("stuck");
  const failingClose = (): Promise<"clean" | "deadline"> => Promise.reject(stuck);
  const host = started(failingClose);
  const connect = createConnectEngine(api(() => Promise.resolve(host)));
  const result = await connect(OPTIONS);
  if (!result.ok) throw new Error("connect failed");
  const handle = result.value;
  let connectionClosed = false;
  const closeConnection = handle.connection.close.bind(handle.connection);
  handle.connection.close = async () => {
    connectionClosed = true;
    await closeConnection();
  };
  const thrown = await handle.shutdown("user").then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(thrown instanceof Error)) throw new Error("expected shutdown to fail");
  expect(thrown.cause).toBe(stuck);
  expect(connectionClosed).toBe(true);
});

test("the state file location comes from the host unless the caller overrides it", async () => {
  const connect = createConnectEngine(api(() => Promise.resolve(started())));
  const result = await connect(OPTIONS);
  if (!result.ok) throw new Error("connect failed");
  expect(result.value.paths.cliStateFile).toBe("/state/cli/state.json");
  const nullOverride = await connect({ ...OPTIONS, stateFile: null });
  if (!nullOverride.ok) throw new Error("connect failed");
  expect(nullOverride.value.paths.cliStateFile).toBe("/state/cli/state.json");
});

test("a state directory failure is a dataDirPermission start error and no host is started", async () => {
  let starts = 0;
  const connect = createConnectEngine(
    api(
      () => {
        starts += 1;
        return Promise.resolve(started());
      },
      () =>
        Promise.resolve(
          err({ kind: "dirs_unavailable", message: "no home", reason: "env_missing" }),
        ),
    ),
  );
  const result = await connect(OPTIONS);
  expect(result).toMatchObject({ ok: false, error: { kind: "dataDirPermission" } });
  expect(starts).toBe(0);
  const denied = createConnectEngine(
    api(
      () => Promise.resolve(started()),
      () => Promise.resolve(err({ kind: "permission", path: "/state/cli", cause: new Error("x") })),
    ),
  );
  const refused = await denied(OPTIONS);
  expect(refused).toMatchObject({ ok: false, error: { kind: "dataDirPermission" } });
  if (!refused.ok) expect(refused.error.message).toContain("/state/cli");
});

test("the observe tap sees every message sent and received, in order", async () => {
  const pair = createTransportPair();
  startFakeServer(pair.server, { storeId: storeId(1), settings: { "l4.cli.theme": "dark" } });
  const seen: JsonRpcMessage[] = [];
  const connection = createHostConnection(
    tapTransport(pair.client, (message) => {
      seen.push(message);
    }),
  );
  await connection.request("settings.get", { keys: ["l4.cli.theme"] });
  expect(seen.map((message) => ("method" in message ? message.method : "response"))).toEqual([
    "settings.get",
    "response",
  ]);
  await connection.close();
});

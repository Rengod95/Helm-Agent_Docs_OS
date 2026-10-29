import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import {
  WIRE_PROTOCOL_VERSION,
  wireError,
  type HostConnection,
  type JsonRpcMessage,
  type Transport,
} from "@xeon/contracts/wire";
import {
  AssembleError,
  type AttachError,
  type AttachOptions,
  type AttachTarget,
  type RemoteResolution,
  type ServiceAttachment,
  type ServiceEndpoint,
} from "@xeon/host";
import { createHostConnection } from "../src/host-client.ts";
import {
  createConnectEngine,
  startErrorOf,
  tapTransport,
  type EngineConnectOptions,
  type EngineStartError,
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
  env: {},
};

/** 시험용 호스트 API. 설정 파일과 원격 주소를 읽지 않도록 기본값은 "설정 없음"이다 */
function api(
  start: HostApi["startInProcessHost"],
  resolveStatePaths: HostApi["resolveHostStatePaths"] = (resolveOptions) =>
    Promise.resolve(
      ok({
        stateDir: "/state",
        cliStateFile: resolveOptions?.cliStateFileOverride ?? "/state/cli/state.json",
      }),
    ),
  extra: Partial<HostApi> = {},
): HostApi {
  return {
    startInProcessHost: start,
    resolveHostStatePaths: resolveStatePaths,
    createHostConnection,
    resolveLaunchMode: () => Promise.resolve("in-process"),
    resolveRemoteEndpoint: () => Promise.resolve<RemoteResolution>({ kind: "none" }),
    attachToService: () => Promise.reject(new Error("attachToService was not expected")),
    serviceClock: () => ({ clock: { now: () => 1 }, ids: { next: () => "evt_service" } }),
    ...extra,
  };
}

/** 시작 횟수와 접속 목록을 세는 기록 */
interface Calls {
  starts: number;
  readonly targets: AttachTarget[];
  readonly attachOptions: AttachOptions[];
  readonly remoteOptions: { readonly flag?: string; readonly env: unknown }[];
}

function newCalls(): Calls {
  return { starts: 0, targets: [], attachOptions: [], remoteOptions: [] };
}

function startCounted(record: Calls): HostApi["startInProcessHost"] {
  return () => {
    record.starts += 1;
    return Promise.resolve(started());
  };
}

/**
 * 서비스 접속의 가짜. 가짜 서버에 붙어 host.hello를 실제로 보낸다. 전송은 kind "socket"이고, wrapTransport가 있으면 그것을 거친다.
 * failure를 주면 그 오류를 돌려준다
 */
function serviceAttach(record: Calls, failure?: AttachError): HostApi["attachToService"] {
  return async (target, options) => {
    record.targets.push(target);
    record.attachOptions.push(options);
    if (failure !== undefined) return err(failure);
    const pair = createTransportPair();
    // 서버가 host.hello에 알리는 전송 종류가 socket이어야 실제 서비스 접속과 같다
    const server: Transport = { ...pair.server, kind: "socket" };
    startFakeServer(server, { storeId: storeId(2) });
    const socketLike: Transport = { ...pair.client, kind: "socket" };
    const transport =
      options.wrapTransport === undefined ? socketLike : options.wrapTransport(socketLike);
    const connection: HostConnection = createHostConnection(transport);
    const hello = await connection.request("host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "xeon-cli", version: "0.0.0", kind: "cli" },
    });
    const attachment: ServiceAttachment = {
      connection,
      hello,
      source: target.kind === "local" ? "local" : "remote",
    };
    return ok(attachment);
  };
}

const TOKEN = "tok-4242-secret";
const TOKEN_ENV = { XEON_REMOTE_TOKEN: TOKEN };

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

// 서비스 접속(HS-87·HS-88): 연결 대상 고르기, 접속 결과, 오류 문구

function invalidResolver(text: string, from: "flag" | "setting"): HostApi["resolveRemoteEndpoint"] {
  return () =>
    Promise.resolve<RemoteResolution>({
      kind: "invalid",
      text,
      from,
      error: { kind: "unknown_scheme" },
    });
}

async function serviceHandle(calls: Calls, options: Partial<EngineConnectOptions> = {}) {
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, { attachToService: serviceAttach(calls) }),
  );
  const result = await connect({ ...OPTIONS, preference: "service", ...options });
  if (!result.ok) throw new Error(`connect failed: ${result.error.kind}`);
  return result.value;
}

const NO_HOST: HostApi["startInProcessHost"] = () =>
  Promise.reject(new Error("in-process was not expected"));

async function startErrorOfAttach(error: AttachError): Promise<EngineStartError> {
  const connect = createConnectEngine(
    api(NO_HOST, undefined, { attachToService: serviceAttach(newCalls(), error) }),
  );
  const result = await connect({ ...OPTIONS, preference: "service", env: TOKEN_ENV });
  if (result.ok) throw new Error("expected a start error");
  return result.error;
}

test("in-process never consults the remote address or the service setting", async () => {
  const calls = newCalls();
  const consulted = { count: 0 };
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, {
      resolveRemoteEndpoint: () => {
        consulted.count += 1;
        return Promise.resolve<RemoteResolution>({
          kind: "remote",
          endpoint: { kind: "unix", path: "/run/x.sock" },
          from: "flag",
        });
      },
      resolveLaunchMode: () => {
        consulted.count += 1;
        return Promise.resolve<"in-process" | "service">("service");
      },
      attachToService: serviceAttach(calls),
    }),
  );
  const result = await connect({ ...OPTIONS, preference: "in-process", remote: "/run/x.sock" });
  expect(result.ok).toBe(true);
  expect(calls.starts).toBe(1);
  expect(calls.targets).toEqual([]);
  expect(consulted.count).toBe(0);
});

test("the service preference attaches to the local service and starts no host", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, { attachToService: serviceAttach(calls) }),
  );
  const result = await connect({ ...OPTIONS, preference: "service" });
  expect(result.ok).toBe(true);
  expect(calls.targets).toEqual([{ kind: "local" }]);
  expect(calls.starts).toBe(0);
});

test("auto with no address and the service setting off starts the in-process host as before", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, { attachToService: serviceAttach(calls) }),
  );
  const result = await connect(OPTIONS);
  expect(result.ok).toBe(true);
  expect(calls.starts).toBe(1);
  expect(calls.targets).toEqual([]);
});

test("auto with the service setting on attaches to the local service", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, {
      resolveLaunchMode: () => Promise.resolve<"in-process" | "service">("service"),
      attachToService: serviceAttach(calls),
    }),
  );
  const result = await connect(OPTIONS);
  expect(result.ok).toBe(true);
  expect(calls.targets).toEqual([{ kind: "local" }]);
  expect(calls.starts).toBe(0);
});

test("auto with a remote address attaches to that endpoint and never asks the service setting", async () => {
  const calls = newCalls();
  const endpoint: ServiceEndpoint = {
    kind: "ssh",
    target: "me@box",
    remoteSocket: "/run/xeon.sock",
  };
  const launch = { asked: 0 };
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, {
      resolveRemoteEndpoint: () =>
        Promise.resolve<RemoteResolution>({ kind: "remote", endpoint, from: "flag" }),
      resolveLaunchMode: () => {
        launch.asked += 1;
        return Promise.resolve<"in-process" | "service">("in-process");
      },
      attachToService: serviceAttach(calls),
    }),
  );
  const result = await connect({ ...OPTIONS, remote: "ssh://me@box/run/xeon.sock" });
  expect(calls.targets).toEqual([{ kind: "endpoint", endpoint }]);
  expect(calls.starts).toBe(0);
  expect(launch.asked).toBe(0);
  expect(result.ok).toBe(true);
});

test("--remote reaches the resolver as the flag, and the environment reaches it for the token", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, {
      resolveRemoteEndpoint: (options) => {
        calls.remoteOptions.push(options);
        return Promise.resolve<RemoteResolution>({ kind: "none" });
      },
    }),
  );
  await connect({ ...OPTIONS, remote: "ssh://box/run/xeon.sock", env: TOKEN_ENV });
  await connect({ ...OPTIONS, env: {} });
  expect(calls.remoteOptions[0]).toEqual({ flag: "ssh://box/run/xeon.sock", env: TOKEN_ENV });
  expect(calls.remoteOptions[1]).not.toHaveProperty("flag");
});

test("an invalid address is invalidRemote with the flag text, and starts nothing", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(startCounted(calls), undefined, {
      resolveRemoteEndpoint: invalidResolver("ftp://box/x", "flag"),
      attachToService: serviceAttach(calls),
    }),
  );
  const result = await connect({ ...OPTIONS, remote: "ftp://box/x" });
  if (result.ok) throw new Error("expected a start error");
  expect(result.error.kind).toBe("invalidRemote");
  expect(result.error.message).toBe("--remote 주소 형식이 맞지 않다: ftp://box/x");
  expect(result.error.fix).toContain("unix:/abs");
  expect(calls.starts).toBe(0);
  expect(calls.targets).toEqual([]);
});

test("an invalid address from the setting, or one with credentials, is not echoed", async () => {
  const fromSetting = createConnectEngine(
    api(NO_HOST, undefined, {
      resolveRemoteEndpoint: invalidResolver("ftp://setting-value/x", "setting"),
    }),
  );
  const setting = await fromSetting(OPTIONS);
  if (setting.ok) throw new Error("expected a start error");
  expect(setting.error.kind).toBe("invalidRemote");
  expect(JSON.stringify(setting.error)).not.toContain("setting-value");

  const withCredentials = createConnectEngine(
    api(NO_HOST, undefined, {
      resolveRemoteEndpoint: invalidResolver("tcp://user:pw-secret@box:1", "flag"),
    }),
  );
  const flagged = await withCredentials({ ...OPTIONS, remote: "tcp://user:pw-secret@box:1" });
  if (flagged.ok) throw new Error("expected a start error");
  expect(flagged.error.kind).toBe("invalidRemote");
  expect(JSON.stringify(flagged.error)).not.toContain("pw-secret");
});

test("a service handle reports the host's store, the socket transport, the state file and the host's features", async () => {
  const calls = newCalls();
  const handle = await serviceHandle(calls, { stateFile: "/tmp/cli.json" });
  expect(handle.storeId).toBe(storeId(2));
  expect(handle.transport).toBe("socket");
  expect(handle.paths.cliStateFile).toBe("/tmp/cli.json");
  expect(handle.secretOutOfBand).toBeNull();
  expect(handle.supports("turn.start")).toBe(true);
  expect(handle.supports("turn.interrupt")).toBe(false);
  expect(handle.clock.now()).toBe(1);
  expect(handle.newRequestId()).toBe("evt_service");
  expect(calls.starts).toBe(0);
  expect(await handle.shutdown("user")).toBe("clean");
});

test("shutting down a service handle closes only its connection, and a second shutdown repeats the result", async () => {
  const handle = await serviceHandle(newCalls());
  const closed = { count: 0 };
  const close = handle.connection.close.bind(handle.connection);
  handle.connection.close = async () => {
    closed.count += 1;
    await close();
  };
  expect(await handle.shutdown("user")).toBe("clean");
  expect(await handle.shutdown("signal")).toBe("clean");
  expect(closed.count).toBe(1);
});

test("a service connection that fails to close throws its cause", async () => {
  const stuck = new TypeError("stuck");
  const handle = await serviceHandle(newCalls());
  handle.connection.close = () => Promise.reject(stuck);
  const thrown = await handle.shutdown("user").then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(thrown instanceof Error)) throw new Error("expected shutdown to fail");
  expect(thrown.cause).toBe(stuck);
});

test("the observe tap sees the host.hello of a service connection", async () => {
  const seen: JsonRpcMessage[] = [];
  const connect = createConnectEngine(
    api(startCounted(newCalls()), undefined, { attachToService: serviceAttach(newCalls()) }),
  );
  const result = await connect({
    ...OPTIONS,
    preference: "service",
    observe: (message) => {
      seen.push(message);
    },
  });
  if (!result.ok) throw new Error("connect failed");
  expect(seen.map((message) => ("method" in message ? message.method : "response"))).toEqual([
    "host.hello",
    "response",
  ]);
  await result.value.shutdown("user");
});

test("a socket that is missing or refuses says to check that the service runs and the address is right", async () => {
  const missing = await startErrorOfAttach({
    kind: "connect_failed",
    error: { kind: "not_found", path: "/run/x.sock" },
  });
  expect(missing).toEqual({
    kind: "serviceUnreachable",
    message: "서비스 소켓이 없다",
    fix: "원격 서비스가 켜져 있고 주소가 맞는지 확인한다",
  });
  const refused = await startErrorOfAttach({
    kind: "connect_failed",
    error: { kind: "refused", path: "/run/x.sock" },
  });
  expect(refused).toEqual({
    kind: "serviceUnreachable",
    message: "서비스가 연결을 거부했다",
    fix: "원격 서비스가 켜져 있고 주소가 맞는지 확인한다",
  });
});

test("a permission failure has its own fix", async () => {
  const denied = await startErrorOfAttach({
    kind: "connect_failed",
    error: { kind: "permission", path: "/run/x.sock" },
  });
  expect(denied).toEqual({
    kind: "serviceUnreachable",
    message: "서비스 소켓에 접근할 수 없다",
    fix: "소켓 파일과 그 폴더의 소유자와 권한을 확인한다",
  });
});

test("an ssh tunnel failure shows its first stderr line on one line", async () => {
  const tunnel = await startErrorOfAttach({
    kind: "connect_failed",
    error: {
      kind: "tunnel_failed",
      failure: {
        kind: "exited",
        detail: "Permission denied (publickey).\nkex_exchange_identification: closed",
      },
    },
  });
  expect(tunnel).toEqual({
    kind: "serviceUnreachable",
    message: "ssh 터널을 열지 못했다: Permission denied (publickey).",
    fix: "ssh 키나 ssh-agent로 암호 없이 접속되는지 확인한다",
  });
});

test("a tunnel port that was not supplied says to reinstall, and an ensure failure says to check the status", async () => {
  const unavailable = await startErrorOfAttach({
    kind: "connect_failed",
    error: { kind: "tunnel_unavailable" },
  });
  expect(unavailable.kind).toBe("serviceUnreachable");
  expect(unavailable.fix).toContain("다시 설치");

  const ensure = await startErrorOfAttach({ kind: "ensure_failed", reason: "start_timeout" });
  expect(ensure).toEqual({
    kind: "serviceUnreachable",
    message: "이 기기의 서비스를 띄우지 못했다 (start_timeout)",
    fix: "xeon service status로 서비스 상태를 확인한다",
  });
});

test("an auth failure names XEON_REMOTE_TOKEN and the status check, and the token value never reaches the error", async () => {
  const calls = newCalls();
  const connect = createConnectEngine(
    api(NO_HOST, undefined, {
      resolveRemoteEndpoint: () =>
        Promise.resolve<RemoteResolution>({
          kind: "remote",
          endpoint: { kind: "tcp", host: "box", port: 7000, token: TOKEN },
          from: "flag",
        }),
      attachToService: serviceAttach(calls, {
        kind: "hello_failed",
        error: { kind: "auth_failed", reason: "invalid" },
      }),
    }),
  );
  const result = await connect({ ...OPTIONS, remote: "tcp://box:7000", env: TOKEN_ENV });
  if (result.ok) throw new Error("expected a start error");
  expect(result.error.kind).toBe("serviceUnreachable");
  expect(result.error.fix).toContain("XEON_REMOTE_TOKEN");
  expect(result.error.fix).toContain("xeon service status");
  expect(JSON.stringify(result)).not.toContain(TOKEN);
});

test("a protocol mismatch on attach is protocolUnsupported; a silent or closed service is serviceUnreachable", async () => {
  const protocol = await startErrorOfAttach({
    kind: "hello_failed",
    error: { kind: "protocol_unsupported" },
  });
  expect(protocol.kind).toBe("protocolUnsupported");
  const silent = await startErrorOfAttach({ kind: "hello_failed", error: { kind: "timeout" } });
  expect(silent.kind).toBe("serviceUnreachable");
  const closed = await startErrorOfAttach({ kind: "hello_failed", error: { kind: "closed" } });
  expect(closed.kind).toBe("serviceUnreachable");
});

test("every attach failure is one start error whose message and fix are one line each and carry no token", async () => {
  const failures: readonly AttachError[] = [
    { kind: "ensure_failed", reason: "spawn_failed" },
    { kind: "connect_failed", error: { kind: "not_found", path: "/a" } },
    { kind: "connect_failed", error: { kind: "refused", path: "/a" } },
    { kind: "connect_failed", error: { kind: "permission", path: "/a" } },
    { kind: "connect_failed", error: { kind: "io", code: "EHOSTUNREACH" } },
    { kind: "connect_failed", error: { kind: "tunnel_unavailable" } },
    {
      kind: "connect_failed",
      error: {
        kind: "tunnel_failed",
        failure: { kind: "timeout", detail: "\n\n  \n" },
      },
    },
    { kind: "hello_failed", error: { kind: "auth_failed", reason: "missing" } },
    { kind: "hello_failed", error: { kind: "auth_failed", reason: "unknown" } },
    { kind: "hello_failed", error: { kind: "protocol_unsupported" } },
    { kind: "hello_failed", error: { kind: "timeout" } },
    { kind: "hello_failed", error: { kind: "closed" } },
  ];
  const errors = await Promise.all(failures.map((failure) => startErrorOfAttach(failure)));
  for (const error of errors) {
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.split("\n")).toHaveLength(1);
    expect(error.fix.length).toBeGreaterThan(0);
    expect(error.fix.split("\n")).toHaveLength(1);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  }
  expect(errors.map((error) => error.kind)).toEqual([
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "serviceUnreachable",
    "protocolUnsupported",
    "serviceUnreachable",
    "serviceUnreachable",
  ]);
});

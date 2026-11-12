import { expect, test } from "bun:test";
import { Bug, err, ok } from "@fresnel/contracts";
import { WireError, type WireParams, type WireResult } from "@fresnel/contracts/wire";
import type { PreflightResult } from "../../src/service/preflight.ts";
import { isNotImplemented } from "../../src/handlers/not-implemented.ts";
import { createRemoteHandlers, remotePortOf, type RemotePort } from "../../src/handlers/remote.ts";
import type { RemoteDevice, RemoteFailure, RemoteStatusView } from "../../src/service/gateway.ts";
import type {
  ProxyExampleOutcome,
  RemoteConfigOutcome,
  RemoteLink,
  RemoteTailscaleReport,
} from "../../src/service/remote-ops.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { OFF_VIEW, RUNNING_VIEW } from "../fixtures/fake-gateway.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// `host.remote.*` 처리기(L4.remote §8.3, §8.8, §10, §11). 포트가 준 값은 와이어 결과로 그대로 나가고, 포트의 실패 값은 정해진 와이어 오류가 된다.
// 시험은 가짜 엔진의 연결로 부른다(처리기 표를 거친다). 포트는 시험이 준다.

const DEVICE: RemoteDevice = {
  id: "dev_0123456789abcdef",
  name: "laptop",
  kind: "web",
  createdAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  address: "192.0.2.7",
};

const LINK: RemoteLink = {
  kind: "tailscale_magicdns",
  url: "https://my-mac.tail1234.ts.net:8443/login#code=ABCDE12345",
};

const PREFLIGHT: PreflightResult = {
  ready: false,
  items: [
    { id: "service_running", status: "pass", cause: null, fix: null, autoFix: null, detail: {} },
    {
      id: "gateway_running",
      status: "fail",
      cause: "gateway_off",
      fix: "turn_on_remote_access",
      autoFix: "enable_gateway",
      detail: {},
    },
  ],
};

const TAILSCALE: RemoteTailscaleReport = {
  state: "ready",
  authUrl: null,
  magicDnsName: "my-mac.tail1234.ts.net",
  ips: ["100.64.0.2"],
  httpsEnabled: false,
  serve: { kind: "off", url: null },
  consentUrl: "https://login.tailscale.com/f/serve?node=abc",
  failure: "https_not_enabled",
};

const CONFIG: RemoteConfigOutcome = {
  settings: {
    listen: "127.0.0.1:8480",
    listenTls: "0.0.0.0:8443",
    hosts: ["fresnel.example.ts.net"],
    tlsCert: null,
    tlsKey: null,
  },
  issues: [{ field: "listen", code: "listen_not_loopback" }],
  written: false,
  restartNeeded: false,
};

const PROXY: ProxyExampleOutcome = {
  text: "fresnel.example.com {\n}\n",
  plan: { listen: "127.0.0.1:8480", listenTls: "127.0.0.1:8443", hosts: ["fresnel.example.com"] },
};

const PREFLIGHT_WIRE: WireResult<"host.remote.preflight"> = {
  ready: false,
  items: [
    { id: "service_running", status: "pass", cause: null, fix: null, autoFix: null, detail: {} },
    {
      id: "gateway_running",
      status: "fail",
      cause: "gateway_off",
      fix: "turn_on_remote_access",
      autoFix: "enable_gateway",
      detail: {},
    },
  ],
};

const TAILSCALE_WIRE: WireResult<"host.remote.tailscale"> = {
  state: "ready",
  authUrl: null,
  magicDnsName: "my-mac.tail1234.ts.net",
  ips: ["100.64.0.2"],
  httpsEnabled: false,
  serve: { kind: "off", url: null },
  consentUrl: "https://login.tailscale.com/f/serve?node=abc",
  failure: "https_not_enabled",
};

const CONFIG_WIRE: WireResult<"host.remote.config"> = {
  settings: {
    listen: "127.0.0.1:8480",
    listenTls: "0.0.0.0:8443",
    hosts: ["fresnel.example.ts.net"],
    tlsCert: null,
    tlsKey: null,
  },
  issues: [{ field: "listen", code: "listen_not_loopback" }],
  written: false,
  restartNeeded: false,
};

const PROXY_WIRE: WireResult<"host.remote.proxyExample"> = {
  text: "fresnel.example.com {\n}\n",
  plan: { listen: "127.0.0.1:8480", listenTls: "127.0.0.1:8443", hosts: ["fresnel.example.com"] },
};

const REMOTE_OFF: RemoteFailure = { kind: "remote-off" };
const STORE_FAILED: RemoteFailure = { kind: "store-failed" };
const GATEWAY_TIMEOUT: RemoteFailure = { kind: "gateway-timeout" };
const PROTOCOL_FAILED: RemoteFailure = { kind: "gateway-protocol", message: "secret-looking" };
const NOT_FOUND: RemoteFailure = { kind: "not-found" };

function portWith(parts: Partial<RemotePort>): RemotePort {
  return {
    status: () => RUNNING_VIEW,
    setEnabled: () => Promise.resolve(ok(RUNNING_VIEW)),
    pair: () =>
      Promise.resolve(ok({ code: "ABCDE12345", expiresAt: 1_800_000_300_000, links: [LINK] })),
    devices: () => Promise.resolve(ok([DEVICE])),
    revoke: () => Promise.resolve(ok({ revoked: 2 })),
    preflight: () => Promise.resolve(PREFLIGHT),
    tailscale: () => Promise.resolve(ok(TAILSCALE)),
    config: () => Promise.resolve(ok(CONFIG)),
    proxyExample: () => ok(PROXY),
    ...parts,
  };
}

/** 와이어 결과의 모양(`hosts`가 가변 배열)으로 옮긴 상태. 비교용이다 */
function wireViewOf(view: RemoteStatusView): WireResult<"host.remote.status"> {
  return { ...view, hosts: [...view.hosts] };
}

/** 던져진 값을 JSON-RPC 오류의 모양으로 바꾼다. WireError가 아니면 시험이 실패한다 */
function wireOf(caught: unknown): { code: number; message: string; data: unknown } {
  if (!(caught instanceof WireError))
    throw new Error(`expected a WireError, got ${String(caught)}`);
  return { code: caught.code, message: caught.message, data: caught.data };
}

/**
 * 가짜 엔진 위에서 연결을 연다. 포트가 없으면 lifecycle에 `remote`를 주지 않는다(in-process, stdio와 같다):
 * 그러면 원격 메서드는 notImplemented다.
 */
async function connectWith(port: RemotePort | undefined) {
  const host = createFakeHost({
    lifecycle:
      port === undefined
        ? { stopRequested: () => undefined }
        : { stopRequested: () => undefined, remote: () => port },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

test("host.remote.status and host.remote.setEnabled return the port's view as the wire result", async () => {
  const connection = await connectWith(
    portWith({
      status: () => OFF_VIEW,
      setEnabled: (enabled) => Promise.resolve(ok({ ...RUNNING_VIEW, enabled })),
    }),
  );
  try {
    expect(await connection.request("host.remote.status", {})).toEqual(wireViewOf(OFF_VIEW));
    expect(await connection.request("host.remote.setEnabled", { enabled: false })).toEqual(
      wireViewOf({ ...RUNNING_VIEW, enabled: false }),
    );
  } finally {
    await connection.close();
  }
});

test("host.remote.pair, devices and revoke return the port's values, and revoke passes both target shapes", async () => {
  const seen: unknown[] = [];
  const connection = await connectWith(
    portWith({
      revoke: (target) => {
        seen.push(target);
        return Promise.resolve(ok({ revoked: 2 }));
      },
    }),
  );
  try {
    expect(await connection.request("host.remote.pair", {})).toEqual({
      code: "ABCDE12345",
      expiresAt: 1_800_000_300_000,
      links: [LINK],
    });
    expect(await connection.request("host.remote.devices", {})).toEqual({ devices: [DEVICE] });
    const byId: WireParams<"host.remote.revoke"> = { id: DEVICE.id };
    expect(await connection.request("host.remote.revoke", byId)).toEqual({ revoked: 2 });
    expect(await connection.request("host.remote.revoke", { all: true })).toEqual({ revoked: 2 });
    expect(seen).toEqual([{ id: DEVICE.id }, { all: true }]);
  } finally {
    await connection.close();
  }
});

test("pair answers an empty links array when no allowed remote address is left", async () => {
  const connection = await connectWith(
    portWith({
      pair: () => Promise.resolve(ok({ code: "ABCDE12345", expiresAt: 1, links: [] })),
    }),
  );
  try {
    expect(await connection.request("host.remote.pair", {})).toEqual({
      code: "ABCDE12345",
      expiresAt: 1,
      links: [],
    });
  } finally {
    await connection.close();
  }
});

test("host.remote.preflight, tailscale, config and proxyExample return the port's values and pass their params through", async () => {
  const seen: unknown[] = [];
  const connection = await connectWith(
    portWith({
      tailscale: (action) => {
        seen.push(action);
        return Promise.resolve(ok(TAILSCALE));
      },
      config: (patch, dryRun) => {
        seen.push({ patch, dryRun });
        return Promise.resolve(ok(CONFIG));
      },
      proxyExample: (input) => {
        seen.push(input);
        return ok(PROXY);
      },
    }),
  );
  try {
    expect(await connection.request("host.remote.preflight", {})).toEqual(PREFLIGHT_WIRE);
    expect(await connection.request("host.remote.tailscale", { action: "serveOn" })).toEqual(
      TAILSCALE_WIRE,
    );
    expect(
      await connection.request("host.remote.config", {
        patch: { hosts: ["fresnel.example.ts.net"] },
        dryRun: true,
      }),
    ).toEqual(CONFIG_WIRE);
    expect(await connection.request("host.remote.config", {})).toEqual(CONFIG_WIRE);
    expect(
      await connection.request("host.remote.proxyExample", {
        kind: "caddy",
        domain: "fresnel.example.com",
        tlsPort: 8443,
      }),
    ).toEqual(PROXY_WIRE);
    expect(seen).toEqual([
      "serveOn",
      { patch: { hosts: ["fresnel.example.ts.net"] }, dryRun: true },
      { patch: null, dryRun: false },
      { kind: "caddy", domain: "fresnel.example.com", tlsPort: 8443 },
    ]);
  } finally {
    await connection.close();
  }
});

test("a remote-off failure is the wire error remote.off (5008) for pair, devices, revoke and tailscale", async () => {
  const connection = await connectWith(
    portWith({
      pair: () => Promise.resolve(err(REMOTE_OFF)),
      devices: () => Promise.resolve(err(REMOTE_OFF)),
      revoke: () => Promise.resolve(err(REMOTE_OFF)),
      tailscale: () => Promise.resolve(err(REMOTE_OFF)),
    }),
  );
  try {
    // 거부를 만들자마자 받아 둔다(기다리는 차례가 올 때까지 처리되지 않은 거부가 생기지 않게)
    const failures = [
      rejectionOf(connection.request("host.remote.pair", {})),
      rejectionOf(connection.request("host.remote.devices", {})),
      rejectionOf(connection.request("host.remote.revoke", { all: true })),
      rejectionOf(connection.request("host.remote.tailscale", { action: "serveOff" })),
    ];
    for (const caught of await Promise.all(failures)) {
      expect(wireOf(caught)).toMatchObject({ code: 5008, data: { kind: "remote.off" } });
    }
  } finally {
    await connection.close();
  }
});

test("store and gateway failures map to internal with the kind only; a missing device is invalid params", async () => {
  const connection = await connectWith(
    portWith({
      setEnabled: () => Promise.resolve(err(STORE_FAILED)),
      pair: () => Promise.resolve(err(GATEWAY_TIMEOUT)),
      devices: () => Promise.resolve(err(PROTOCOL_FAILED)),
      revoke: () => Promise.resolve(err(NOT_FOUND)),
      config: () => Promise.resolve(err(STORE_FAILED)),
    }),
  );
  try {
    const store = wireOf(
      await rejectionOf(connection.request("host.remote.setEnabled", { enabled: true })),
    );
    expect(store).toMatchObject({ code: -32603, data: { kind: "internal" } });
    expect(store.message).toContain("store-failed");

    const timeout = wireOf(await rejectionOf(connection.request("host.remote.pair", {})));
    expect(timeout).toMatchObject({ code: -32603, data: { kind: "internal" } });
    expect(timeout.message).toContain("gateway-timeout");

    // 프로토콜 실패의 값(message)은 응답 어디에도 싣지 않는다
    const protocol = wireOf(await rejectionOf(connection.request("host.remote.devices", {})));
    expect(protocol).toMatchObject({ code: -32603, data: { kind: "internal" } });
    expect(JSON.stringify(protocol)).not.toContain("secret-looking");

    const missing = wireOf(
      await rejectionOf(connection.request("host.remote.revoke", { id: DEVICE.id })),
    );
    expect(missing).toMatchObject({
      code: -32602,
      data: { details: { issues: [{ path: "/id", message: "not_found" }] } },
    });

    // 설정 저장 실패도 kind만 싣는 internal이다
    const config = wireOf(await rejectionOf(connection.request("host.remote.config", {})));
    expect(config).toMatchObject({ code: -32603, data: { kind: "internal" } });
    expect(config.message).toContain("store-failed");
  } finally {
    await connection.close();
  }
});

test("a bad proxy domain or port is invalid params that names the field; a port outside 1..65535 is refused by the schema", async () => {
  const connection = await connectWith(
    portWith({
      // 스키마를 통과하는 값(공백이 든 도메인)만 포트까지 간다. 포트가 거절한 종류를 경로와 함께 옮긴다
      proxyExample: (input) =>
        err(input.domain === "bad domain" ? { kind: "invalid_domain" } : { kind: "invalid_port" }),
    }),
  );
  try {
    const domain = wireOf(
      await rejectionOf(
        connection.request("host.remote.proxyExample", {
          kind: "nginx",
          domain: "bad domain",
          tlsPort: 8443,
        }),
      ),
    );
    expect(domain).toMatchObject({
      code: -32602,
      data: { details: { issues: [{ path: "/domain", message: "invalid_domain" }] } },
    });
    const port = wireOf(
      await rejectionOf(
        connection.request("host.remote.proxyExample", {
          kind: "nginx",
          domain: "fresnel.example.com",
          tlsPort: 8443,
        }),
      ),
    );
    expect(port).toMatchObject({
      code: -32602,
      data: { details: { issues: [{ path: "/tlsPort", message: "invalid_port" }] } },
    });
    const range = wireOf(
      await rejectionOf(
        connection.request("host.remote.proxyExample", {
          kind: "caddy",
          domain: "fresnel.example.com",
          tlsPort: 0,
        }),
      ),
    );
    expect(range).toMatchObject({ code: -32602 });
  } finally {
    await connection.close();
  }
});

test("without a port (in-process and stdio hosts) the nine remote methods are notImplemented", async () => {
  for (const handler of Object.values(createRemoteHandlers(undefined))) {
    expect(isNotImplemented(handler)).toBe(true);
  }
  expect(Object.keys(createRemoteHandlers(undefined))).toHaveLength(9);
  const connection = await connectWith(undefined);
  try {
    const failure = wireOf(await rejectionOf(connection.request("host.remote.status", {})));
    expect(failure).toMatchObject({
      code: -32601,
      data: { details: { method: "host.remote.status" } },
    });
  } finally {
    await connection.close();
  }
});

test("remotePortOf reads the port at call time and is a Bug while the service has not wired it", () => {
  expect(remotePortOf(undefined)).toBeUndefined();
  const slot: { port: RemotePort | undefined } = { port: undefined };
  const forwarded = remotePortOf(() => slot.port);
  if (forwarded === undefined) throw new Error("a read function must give a port");
  expect(() => forwarded.status()).toThrow(Bug);
  expect(() => forwarded.preflight()).toThrow(Bug);
  expect(() => forwarded.proxyExample({ kind: "caddy", domain: "a.b", tlsPort: 1 })).toThrow(Bug);
  slot.port = portWith({ status: () => OFF_VIEW });
  expect(forwarded.status()).toEqual(OFF_VIEW);
  expect(forwarded.proxyExample({ kind: "caddy", domain: "a.b", tlsPort: 1 })).toEqual(ok(PROXY));
});

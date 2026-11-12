import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { AutostartStatus } from "../src/service/autostart.ts";
import type { RemoteStatusView } from "../src/service/gateway.ts";
import {
  pairLinksOf,
  remoteConfigOf,
  remoteProxyExampleOf,
  remoteTailscaleOf,
  type RemoteOpsEnv,
} from "../src/service/remote-ops.ts";
import type { TailscaleDeps } from "../src/service/tailscale.ts";
import { OFF_VIEW, RUNNING_VIEW } from "./fixtures/fake-gateway.ts";

// 원격 동작 묶음(`remote-ops.ts`)의 값 시험. `tailscale`은 가짜로 바꾸고(실제 tailnet과 실제 홈을 쓰지 않는다), 설정 쓰기는 기록만 한다.

interface Reply {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

const STATUS = "tailscale status --json";
const ENABLE = "tailscale serve --bg --https=443 https+insecure://127.0.0.1:8443";
const SERVE_STATUS = "tailscale serve status --json";
const READY = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "my-mac.tail1234.ts.net.", TailscaleIPs: ["100.64.0.2", "fd7a::2"] },
  CertDomains: [],
  CurrentTailnet: { Name: "tail1234.ts.net" },
});
const SERVE_ON = JSON.stringify({
  Web: {
    "my-mac.tail1234.ts.net:443": {
      Handlers: { "/": { Proxy: "https+insecure://127.0.0.1:8443" } },
    },
  },
});
const CONSENT =
  "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n\t https://login.tailscale.com/f/serve?node=abc\n";

const AUTOSTART: AutostartStatus = {
  platform: "linux",
  supported: false,
  registered: false,
  active: false,
  path: null,
  upToDate: false,
  linger: null,
};

/** 표에 없는 명령은 종료 코드 2(시험 잘못)로 답해 드러나게 한다 */
function tailscaleWith(table: Readonly<Record<string, Reply>>): TailscaleDeps {
  return {
    platform: "linux",
    run(cmd, args) {
      const reply = table[[cmd, ...args].join(" ")] ?? { exitCode: 2, stderr: "not in this test" };
      return Promise.resolve({
        exitCode: reply.exitCode,
        stdout: reply.stdout ?? "",
        stderr: reply.stderr ?? "",
      });
    },
  };
}

interface EnvOptions {
  readonly view?: RemoteStatusView;
  readonly tailscale: TailscaleDeps;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly writes?: { key: string; value: unknown }[];
  readonly failWrites?: boolean;
}

function envOf(options: EnvOptions): RemoteOpsEnv {
  const settings = options.settings ?? {};
  const writes = options.writes ?? [];
  return {
    status: () => options.view ?? OFF_VIEW,
    read: (key) => settings[key],
    writer: {
      write(_scope, key, value) {
        if (options.failWrites === true) return Promise.resolve(err({ kind: "locked" }));
        writes.push({ key, value });
        return Promise.resolve(ok(value));
      },
    },
    tailscale: options.tailscale,
    clock: { now: () => 1_800_000_000_000 },
    autostart: () => Promise.resolve(AUTOSTART),
  };
}

test("status without a gateway reads the tailscale state and leaves serve unavailable", async () => {
  const env = envOf({ tailscale: tailscaleWith({ [STATUS]: { exitCode: 127 } }) });
  expect(await remoteTailscaleOf(env, "status")).toEqual(
    ok({
      state: "not_installed",
      authUrl: null,
      magicDnsName: null,
      ips: [],
      httpsEnabled: null,
      serve: { kind: "unavailable", url: null },
      consentUrl: null,
      failure: null,
    }),
  );
});

test("serveOn and serveOff need the loopback port: with the gateway off they are remote-off", async () => {
  const env = envOf({ tailscale: tailscaleWith({ [STATUS]: { exitCode: 0, stdout: READY } }) });
  expect(await remoteTailscaleOf(env, "serveOn")).toEqual(err({ kind: "remote-off" }));
  expect(await remoteTailscaleOf(env, "serveOff")).toEqual(err({ kind: "remote-off" }));
});

test("serveOn with HTTPS off in the tailnet gives the consent link as a value; serve stays off", async () => {
  const env = envOf({
    view: { ...RUNNING_VIEW, tlsPort: 8443 },
    tailscale: tailscaleWith({
      [STATUS]: { exitCode: 0, stdout: READY },
      [ENABLE]: { exitCode: 1, stderr: CONSENT },
      [SERVE_STATUS]: { exitCode: 0, stdout: "{}" },
    }),
  });
  expect(await remoteTailscaleOf(env, "serveOn")).toEqual(
    ok({
      state: "ready",
      authUrl: null,
      magicDnsName: "my-mac.tail1234.ts.net",
      ips: ["100.64.0.2", "fd7a::2"],
      httpsEnabled: false,
      serve: { kind: "off", url: null },
      consentUrl: "https://login.tailscale.com/f/serve?node=abc",
      failure: "https_not_enabled",
    }),
  );
});

test("serveOn that succeeds reports the public URL of the serve setting", async () => {
  const env = envOf({
    view: { ...RUNNING_VIEW, tlsPort: 8443 },
    tailscale: tailscaleWith({
      [STATUS]: { exitCode: 0, stdout: READY },
      [ENABLE]: { exitCode: 0 },
      [SERVE_STATUS]: { exitCode: 0, stdout: SERVE_ON },
    }),
  });
  expect(await remoteTailscaleOf(env, "serveOn")).toEqual(
    ok({
      state: "ready",
      authUrl: null,
      magicDnsName: "my-mac.tail1234.ts.net",
      ips: ["100.64.0.2", "fd7a::2"],
      httpsEnabled: false,
      serve: { kind: "on", url: "https://my-mac.tail1234.ts.net" },
      consentUrl: null,
      failure: null,
    }),
  );
});

test("config: a dry run checks without writing; a write stores the patch and reports the restart when the gateway runs", async () => {
  const writes: { key: string; value: unknown }[] = [];
  const env = envOf({
    view: { ...RUNNING_VIEW, tlsPort: 8443 },
    writes,
    settings: {
      "l4.remote.web.listen": "127.0.0.1:8480",
      "l4.remote.web.listenTls": "0.0.0.0:8443",
    },
    tailscale: tailscaleWith({}),
  });
  const merged = {
    listen: "127.0.0.1:8480",
    listenTls: "0.0.0.0:8443",
    hosts: ["fresnel.example.ts.net"],
    tlsCert: null,
    tlsKey: null,
  };

  expect(await remoteConfigOf(env, { hosts: ["fresnel.example.ts.net"] }, true)).toEqual(
    ok({ settings: merged, issues: [], written: false, restartNeeded: false }),
  );
  expect(writes).toEqual([]);

  // 루프백이 아닌 listen은 검사에 걸린다. 쓰지 않고 issues만 돌려준다
  expect(await remoteConfigOf(env, { listen: "0.0.0.0:8480" }, true)).toEqual(
    ok({
      settings: { ...merged, listen: "0.0.0.0:8480", hosts: [] },
      issues: [{ field: "listen", code: "listen_not_loopback" }],
      written: false,
      restartNeeded: false,
    }),
  );
  expect(writes).toEqual([]);

  expect(await remoteConfigOf(env, { hosts: ["fresnel.example.ts.net"] }, false)).toEqual(
    ok({ settings: merged, issues: [], written: true, restartNeeded: true }),
  );
  expect(writes).toEqual([{ key: "l4.remote.web.hosts", value: ["fresnel.example.ts.net"] }]);
});

test("config: a storage failure is the store-failed value, and nothing is reported as written", async () => {
  const env = envOf({ failWrites: true, tailscale: tailscaleWith({}) });
  expect(await remoteConfigOf(env, { hosts: ["fresnel.example.ts.net"] }, false)).toEqual(
    err({ kind: "store-failed" }),
  );
});

test("proxyExample answers the text and the loopback plan with the settings' listen port; a bad domain or port is a value", () => {
  const env = envOf({
    tailscale: tailscaleWith({}),
    settings: { "l4.remote.web.listen": "127.0.0.1:9000" },
  });
  const made = remoteProxyExampleOf(env, {
    kind: "caddy",
    domain: "fresnel.example.com",
    tlsPort: 8443,
  });
  const withNames = envOf({
    tailscale: tailscaleWith({}),
    settings: { "l4.remote.web.hosts": ["mine.example", "box.local"] },
  });
  const added = remoteProxyExampleOf(withNames, {
    kind: "caddy",
    domain: "fresnel.example.com",
    tlsPort: 8443,
  });
  expect(added.ok ? added.value.plan.hosts : null).toEqual([
    "mine.example",
    "box.local",
    "fresnel.example.com",
  ]);
  expect(made.ok ? made.value.plan : null).toEqual({
    listen: "127.0.0.1:9000",
    listenTls: "127.0.0.1:8443",
    hosts: ["fresnel.example.com"],
  });
  expect(made.ok && made.value.text.includes("reverse_proxy https://127.0.0.1:8443")).toBe(true);
  expect(remoteProxyExampleOf(env, { kind: "nginx", domain: "bad domain", tlsPort: 8443 })).toEqual(
    err({ kind: "invalid_domain" }),
  );
  expect(
    remoteProxyExampleOf(env, { kind: "nginx", domain: "fresnel.example.com", tlsPort: 0 }),
  ).toEqual(err({ kind: "invalid_port" }));

  // 설정에 listen이 없으면 루프백 포트는 8480이다
  const bare = envOf({ tailscale: tailscaleWith({}) });
  const plain = remoteProxyExampleOf(bare, {
    kind: "nginx",
    domain: "fresnel.example.com",
    tlsPort: 8443,
  });
  expect(plain.ok ? plain.value.plan.listen : null).toBe("127.0.0.1:8480");
});

test("pair links are loopback only while no remote address is reachable", async () => {
  const env = envOf({
    view: RUNNING_VIEW,
    tailscale: tailscaleWith({ [STATUS]: { exitCode: 0, stdout: READY } }),
  });
  expect(await pairLinksOf(env, "ABCDE12345")).toEqual([
    { kind: "loopback", url: "http://127.0.0.1:8480/login#code=ABCDE12345" },
  ]);
});

test("pair links carry the code for each allowed remote address, the Tailscale names among them", async () => {
  const env = envOf({
    view: { ...RUNNING_VIEW, tlsPort: 8443 },
    settings: { "l4.remote.web.listenTls": "0.0.0.0:8443" },
    tailscale: tailscaleWith({ [STATUS]: { exitCode: 0, stdout: READY } }),
  });
  const links = await pairLinksOf(env, "ABCDE12345");
  expect(links).toContainEqual({
    kind: "tailscale_magicdns",
    url: "https://my-mac.tail1234.ts.net:8443/login#code=ABCDE12345",
  });
  expect(links).toContainEqual({
    kind: "tailscale_ip",
    url: "https://100.64.0.2:8443/login#code=ABCDE12345",
  });
  expect(links.every((link) => link.url.endsWith("#code=ABCDE12345"))).toBe(true);
  expect(links.some((link) => link.kind === "loopback")).toBe(false);
});

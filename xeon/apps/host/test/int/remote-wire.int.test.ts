import { afterAll, expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import { WireError, type HostConnection, type WireResult } from "@fresnel/contracts/wire";
import type {
  GatewaySupervisor,
  RemoteFailure,
  RemoteStatusView,
} from "../../src/service/gateway.ts";
import { startService, type ServiceOptions } from "../../src/index.ts";
import type { TailscaleDeps } from "../../src/service/tailscale.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { fakeGateway, OFF_VIEW, RUNNING_VIEW } from "../fixtures/fake-gateway.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  manualTime,
  scratchRuntimeDir,
  wireErrorOf,
} from "../fixtures/service-harness.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";

// 서비스의 원격 접속 메서드 세 개(L4.remote §8.8, §11): `host.remote.revoke`, `host.remote.tailscale`, `host.remote.proxyExample`.
// 이 메서드들은 서비스가 채우는 포트에서만 답한다(in-process 호스트는 notImplemented). 그래서 실제 서비스를 띄운다.
// 게이트웨이는 기존 가짜 감독자(fixtures/fake-gateway.ts)이고, `tailscale`은 기존 방식의 가짜 실행 파일(TailscaleDeps)이다.
// 실제 tailscale, 실제 게이트웨이 자식 프로세스, 실제 홈은 쓰지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

const DEVICE_ID = "dev_0123456789abcdef";
const MISSING_DEVICE_ID = "dev_ffffffffffffffff";
const NOT_FOUND: RemoteFailure = { kind: "not-found" };

/** `revoke`가 받은 목표를 쌓는 감독자. 없는 기기 id는 not-found로 답한다(가짜 감독자는 항상 한 대로 답하므로 이 감싸기가 필요하다) */
function gatewayRecordingRevokes(initial: RemoteStatusView = RUNNING_VIEW) {
  const inner = fakeGateway(initial);
  const revokes: unknown[] = [];
  const supervisor: GatewaySupervisor = {
    ...inner.supervisor,
    revoke(target) {
      revokes.push(target);
      if ("id" in target && target.id === MISSING_DEVICE_ID) return Promise.resolve(err(NOT_FOUND));
      return inner.supervisor.revoke(target);
    },
  };
  return { supervisor, revokes };
}

// ── 가짜 tailscale 실행 파일 ────────────────────────────────────────────────────────────────
// 한 줄 명령(`실행 파일 인자…`)을 받아 답하고 부른 줄을 쌓는다. 내보내기 상태(serve)는 켜기·끄기 명령에 따라 바뀐다.
// 답이 없는 명령은 종료 코드 2로 답해 시험 잘못이 드러나게 한다.

const APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const PORT = 8443;
const SERVE_ON_LINE = `tailscale serve --bg --https=443 https+insecure://127.0.0.1:${PORT}`;
const SERVE_STATUS_LINE = "tailscale serve status --json";
const SERVE_OFF_LINE = "tailscale serve --https=443 off";
const STATUS_LINE = "tailscale status --json";

interface Reply {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

const RUNNING = JSON.stringify({
  BackendState: "Running",
  AuthURL: "",
  Self: { DNSName: "My-Mac.Tail1234.ts.net.", TailscaleIPs: ["100.64.0.5", "fd7a:115c:a1e0::5"] },
  CurrentTailnet: { Name: "example.com", MagicDNSEnabled: true },
  CertDomains: ["my-mac.tail1234.ts.net"],
});

/** 같은 기기지만 tailnet에서 HTTPS 인증서가 꺼져 있다(CertDomains가 비었다) */
const RUNNING_HTTPS_OFF = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "My-Mac.Tail1234.ts.net.", TailscaleIPs: ["100.64.0.5", "fd7a:115c:a1e0::5"] },
  CurrentTailnet: { Name: "example.com", MagicDNSEnabled: true },
  CertDomains: [],
});

const SERVE_OURS = JSON.stringify({
  TCP: { "443": { HTTPS: true } },
  Web: {
    "my-mac.tail1234.ts.net:443": {
      Handlers: { "/": { Proxy: `https+insecure://127.0.0.1:${PORT}` } },
    },
  },
});

interface FakeTailscale extends TailscaleDeps {
  readonly calls: string[];
}

interface TailscaleScript {
  /** `tailscale status --json`의 답(PATH의 CLI와 앱 번들 CLI가 같은 답을 준다) */
  readonly status?: Reply;
  /** false면 PATH에도 앱 번들에도 CLI가 없다(모든 실행이 127) */
  readonly installed?: boolean;
  /** 시작할 때 내보내기가 켜져 있는가 */
  readonly serving?: boolean;
  /** `serve --bg`가 실패할 때의 답. 없으면 성공한다 */
  readonly serveOnFailure?: Reply;
}

/** 부른 줄 그대로 쌓는다(앱 번들 경로 포함). 답은 이름만 다른 CLI와 같다 */
function fakeTailscale(script: TailscaleScript): FakeTailscale {
  const calls: string[] = [];
  let serving = script.serving === true;
  const installed = script.installed !== false;
  const answer = (line: string): Reply => {
    if (line === SERVE_ON_LINE) {
      if (script.serveOnFailure !== undefined) return script.serveOnFailure;
      serving = true;
      return {
        exitCode: 0,
        stdout: "Available within your tailnet:\n\nhttps://my-mac.tail1234.ts.net/\n",
      };
    }
    if (line === SERVE_OFF_LINE) {
      serving = false;
      return { exitCode: 0 };
    }
    if (line === SERVE_STATUS_LINE) return { exitCode: 0, stdout: serving ? SERVE_OURS : "{}" };
    if (line === STATUS_LINE) return script.status ?? { exitCode: 0, stdout: RUNNING };
    return { exitCode: 2, stderr: `시험에 없는 명령: ${line}` };
  };
  return {
    platform: "darwin",
    calls,
    run(cmd, args) {
      calls.push([cmd, ...args].join(" "));
      if (!installed) return Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
      const reply = answer(["tailscale", ...args].join(" "));
      return Promise.resolve({
        exitCode: reply.exitCode ?? 0,
        stdout: reply.stdout ?? "",
        stderr: reply.stderr ?? "",
      });
    },
  };
}

// ── 서비스 한 개 ──────────────────────────────────────────────────────────────────────────

function optionsFor(runtimeDir: string, extra: Partial<ServiceOptions>): ServiceOptions {
  return {
    runtimeDir,
    assemble: { devChecks: true, defaultGroups: false },
    time: manualTime(),
    handleSignals: false,
    startupGraceMs: 0,
    idleGraceMs: 60_000,
    ...extra,
  };
}

/** 서비스를 띄우고 연결을 열어 본문에 넘긴다. 끝나면 연결을 닫고 서비스를 세운다 */
async function withService(
  extra: Partial<ServiceOptions>,
  body: (client: HostConnection) => Promise<void>,
): Promise<void> {
  const runtime = scratchRuntimeDir();
  const started = await startService(optionsFor(runtime.dir, extra));
  if (!started.started) {
    runtime.dispose();
    throw new Error(`the service did not start: ${started.reason}`);
  }
  const handle = started.handle;
  const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
  try {
    await body(client);
  } finally {
    await client.close();
    await handle.shutdown("stop");
    runtime.dispose();
  }
}

// ── host.remote.revoke ────────────────────────────────────────────────────────────────────

realTest(
  "host.remote.revoke forwards a device id or the all form to the gateway and answers the count it revoked",
  async () => {
    writeUserSettings(home, { "l4.remote.web.enabled": true });
    const recording = gatewayRecordingRevokes();
    await withService({ gateway: recording.supervisor }, async (client) => {
      expect(await client.request("host.remote.revoke", { id: DEVICE_ID })).toEqual({ revoked: 1 });
      expect(await client.request("host.remote.revoke", { all: true })).toEqual({ revoked: 1 });
    });
    expect(recording.revokes).toEqual([{ id: DEVICE_ID }, { all: true }]);
  },
  60_000,
);

realTest(
  "host.remote.revoke of an id the gateway does not know is jsonrpc.invalidParams with the id issue",
  async () => {
    writeUserSettings(home, { "l4.remote.web.enabled": true });
    const recording = gatewayRecordingRevokes();
    await withService({ gateway: recording.supervisor }, async (client) => {
      const failure = await wireErrorOf(
        client.request("host.remote.revoke", { id: MISSING_DEVICE_ID }),
      );
      expect(failure.data.kind).toBe("jsonrpc.invalidParams");
      expect(failure.data.details).toEqual({ issues: [{ path: "/id", message: "not_found" }] });
    });
    expect(recording.revokes).toEqual([{ id: MISSING_DEVICE_ID }]);
  },
  60_000,
);

realTest(
  "host.remote.revoke with remote access off reaches the gateway and answers remote.off (5008)",
  async () => {
    writeUserSettings(home, {});
    const recording = gatewayRecordingRevokes(OFF_VIEW);
    await withService({ gateway: recording.supervisor }, async (client) => {
      const failure = await wireErrorOf(client.request("host.remote.revoke", { all: true }));
      expect(failure).toBeInstanceOf(WireError);
      expect(failure.code).toBe(5008);
      expect(failure.data.kind).toBe("remote.off");
    });
    expect(recording.revokes).toEqual([{ all: true }]);
  },
  60_000,
);

// ── host.remote.tailscale ─────────────────────────────────────────────────────────────────
// 포트는 게이트웨이의 TLS 리스너(`tlsPort`)다. 켜기·끄기는 그 포트로 `tailscale serve`를 부른다(§8.8).

/** 준비된 Tailscale의 결과에서 serve를 뺀 나머지. 시험마다 serve만 바꿔 쓴다 */
const READY_REPORT: Omit<WireResult<"host.remote.tailscale">, "serve"> = {
  state: "ready",
  authUrl: null,
  magicDnsName: "my-mac.tail1234.ts.net",
  ips: ["100.64.0.5", "fd7a:115c:a1e0::5"],
  httpsEnabled: true,
  consentUrl: null,
  failure: null,
};

/** 게이트웨이가 TLS 포트 8443에서 떠 있다는 상태 */
const TLS_RUNNING = { ...RUNNING_VIEW, tlsPort: PORT };

realTest(
  "host.remote.tailscale status reads the Tailscale state and the serve state of the gateway TLS port, and runs no change",
  async () => {
    writeUserSettings(home, {});
    const tailscale = fakeTailscale({ status: { stdout: RUNNING } });
    await withService(
      { gateway: fakeGateway(TLS_RUNNING).supervisor, tailscaleDeps: tailscale },
      async (client) => {
        expect(await client.request("host.remote.tailscale", { action: "status" })).toEqual({
          ...READY_REPORT,
          serve: { kind: "off", url: null },
        });
      },
    );
    expect(tailscale.calls).toEqual([STATUS_LINE, SERVE_STATUS_LINE]);
  },
  60_000,
);

realTest(
  "host.remote.tailscale serveOn turns the serve on for the TLS port and reads the URL back; serveOff turns it off again",
  async () => {
    writeUserSettings(home, {});
    const tailscale = fakeTailscale({ status: { stdout: RUNNING } });
    await withService(
      { gateway: fakeGateway(TLS_RUNNING).supervisor, tailscaleDeps: tailscale },
      async (client) => {
        expect(await client.request("host.remote.tailscale", { action: "serveOn" })).toEqual({
          ...READY_REPORT,
          serve: { kind: "on", url: "https://my-mac.tail1234.ts.net" },
        });
        expect(await client.request("host.remote.tailscale", { action: "serveOff" })).toEqual({
          ...READY_REPORT,
          serve: { kind: "off", url: null },
        });
      },
    );
    expect(tailscale.calls).toEqual([
      SERVE_ON_LINE,
      SERVE_STATUS_LINE,
      STATUS_LINE,
      SERVE_STATUS_LINE,
      SERVE_STATUS_LINE,
      SERVE_OFF_LINE,
      STATUS_LINE,
      SERVE_STATUS_LINE,
    ]);
  },
  60_000,
);

realTest(
  "host.remote.tailscale serveOn with HTTPS off on the tailnet answers https_not_enabled with the consent link, and changes nothing",
  async () => {
    writeUserSettings(home, {});
    const tailscale = fakeTailscale({
      status: { stdout: RUNNING_HTTPS_OFF },
      serveOnFailure: {
        exitCode: 1,
        stderr:
          "Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=abc123.\n",
      },
    });
    await withService(
      { gateway: fakeGateway(TLS_RUNNING).supervisor, tailscaleDeps: tailscale },
      async (client) => {
        expect(await client.request("host.remote.tailscale", { action: "serveOn" })).toEqual({
          ...READY_REPORT,
          httpsEnabled: false,
          serve: { kind: "off", url: null },
          consentUrl: "https://login.tailscale.com/f/serve?node=abc123",
          failure: "https_not_enabled",
        });
      },
    );
    // 켜기가 실패했으므로 serve 상태를 다시 읽는 것은 보고서 한 번뿐이다
    expect(tailscale.calls).toEqual([SERVE_ON_LINE, STATUS_LINE, SERVE_STATUS_LINE]);
  },
  60_000,
);

realTest(
  "host.remote.tailscale without Tailscale installed says not_installed and tries the app bundle CLI as well",
  async () => {
    writeUserSettings(home, {});
    // PATH에도 앱 번들에도 CLI가 없다(모든 실행이 127)
    const tailscale = fakeTailscale({ installed: false });
    await withService(
      { gateway: fakeGateway(TLS_RUNNING).supervisor, tailscaleDeps: tailscale },
      async (client) => {
        expect(await client.request("host.remote.tailscale", { action: "status" })).toEqual({
          state: "not_installed",
          authUrl: null,
          magicDnsName: null,
          ips: [],
          httpsEnabled: null,
          serve: { kind: "unavailable", url: null },
          consentUrl: null,
          failure: null,
        });
      },
    );
    // PATH의 CLI를 부르고, 없으면 앱 번들 CLI를 한 번 더 부른다. 상태 읽기와 serve 상태 읽기 모두
    expect(tailscale.calls).toEqual([
      STATUS_LINE,
      `${APP} status --json`,
      SERVE_STATUS_LINE,
      `${APP} serve status --json`,
    ]);
  },
  60_000,
);

realTest(
  "host.remote.tailscale needs_login keeps the sign-in address and serveOn without the TLS port is remote.off with no command run",
  async () => {
    writeUserSettings(home, {});
    const login = fakeTailscale({
      status: {
        stdout: JSON.stringify({
          BackendState: "NeedsLogin",
          AuthURL: "https://login.tailscale.com/a/abc",
        }),
      },
    });
    await withService(
      { gateway: fakeGateway(TLS_RUNNING).supervisor, tailscaleDeps: login },
      async (client) => {
        expect(await client.request("host.remote.tailscale", { action: "status" })).toEqual({
          state: "needs_login",
          authUrl: "https://login.tailscale.com/a/abc",
          magicDnsName: null,
          ips: [],
          httpsEnabled: null,
          serve: { kind: "off", url: null },
          consentUrl: null,
          failure: null,
        });
      },
    );

    // 게이트웨이 TLS 포트가 없으면(원격 접속이 꺼져 있다) 켜기는 remote.off이고 tailscale을 부르지 않는다
    const untouched = fakeTailscale({ status: { stdout: RUNNING } });
    await withService(
      { gateway: fakeGateway(OFF_VIEW).supervisor, tailscaleDeps: untouched },
      async (client) => {
        const failure = await wireErrorOf(
          client.request("host.remote.tailscale", { action: "serveOn" }),
        );
        expect(failure.code).toBe(5008);
        expect(failure.data.kind).toBe("remote.off");
      },
    );
    expect(untouched.calls).toEqual([]);
  },
  60_000,
);

// ── host.remote.proxyExample ──────────────────────────────────────────────────────────────

const CADDY_TEXT = [
  "# The Fresnel gateway listens only on 127.0.0.1:8443 (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.",
  "# Add fresnel.example.com to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.",
  "# The gateway's own certificate is self-signed, so Caddy skips verifying it on this local hop. Caddy adds the WebSocket upgrade headers itself.",
  "fresnel.example.com {",
  "  reverse_proxy https://127.0.0.1:8443 {",
  "    transport http {",
  "      tls_insecure_skip_verify",
  "    }",
  "  }",
  "}",
  "",
].join("\n");

const NGINX_TEXT = [
  "# The Fresnel gateway listens only on 127.0.0.1:9443 (TLS, l4.remote.web.listenTls). This proxy handles external HTTPS.",
  "# Add fresnel.example.com to l4.remote.web.hosts: the gateway's TLS listener checks the Host header and the Origin against it.",
  "# The gateway's own certificate is self-signed, so nginx skips verifying it on this local hop.",
  "server {",
  "  listen 443 ssl;",
  "  server_name fresnel.example.com;",
  "  ssl_certificate /etc/letsencrypt/live/fresnel.example.com/fullchain.pem;",
  "  ssl_certificate_key /etc/letsencrypt/live/fresnel.example.com/privkey.pem;",
  "",
  "  location / {",
  "    proxy_pass https://127.0.0.1:9443;",
  "    proxy_ssl_verify off;",
  "    proxy_http_version 1.1;",
  "    proxy_set_header Upgrade $http_upgrade;",
  '    proxy_set_header Connection "upgrade";',
  "    proxy_set_header Host $host;",
  "    proxy_set_header X-Forwarded-For $remote_addr;",
  "    proxy_set_header X-Forwarded-Proto $scheme;",
  "    proxy_read_timeout 3600s;",
  "  }",
  "}",
  "",
  "server {",
  "  listen 80;",
  "  server_name fresnel.example.com;",
  "  return 301 https://$host$request_uri;",
  "}",
  "",
].join("\n");

realTest(
  "host.remote.proxyExample fills the Caddy example with the domain and the TLS port, plans the loopback-only listeners, and changes no setting",
  async () => {
    writeUserSettings(home, {});
    await withService({ gateway: fakeGateway(OFF_VIEW).supervisor }, async (client) => {
      expect(
        await client.request("host.remote.proxyExample", {
          kind: "caddy",
          domain: "fresnel.example.com",
          tlsPort: PORT,
        }),
      ).toEqual({
        text: CADDY_TEXT,
        plan: {
          listen: "127.0.0.1:8480",
          listenTls: "127.0.0.1:8443",
          hosts: ["fresnel.example.com"],
        },
      });
      // 상태는 바꾸지 않는다: 허용 호스트는 그대로 비어 있고 사용자 범위에 쓴 값이 없다(출처가 기본값이다)
      expect(await client.request("settings.get", { keys: ["l4.remote.web.hosts"] })).toMatchObject(
        { settings: [{ key: "l4.remote.web.hosts", value: [], source: { scope: "default" } }] },
      );
    });
  },
  60_000,
);

realTest(
  "host.remote.proxyExample fills the nginx example with the given TLS port",
  async () => {
    writeUserSettings(home, {});
    await withService({ gateway: fakeGateway(OFF_VIEW).supervisor }, async (client) => {
      expect(
        await client.request("host.remote.proxyExample", {
          kind: "nginx",
          domain: "fresnel.example.com",
          tlsPort: 9443,
        }),
      ).toEqual({
        text: NGINX_TEXT,
        plan: {
          listen: "127.0.0.1:8480",
          listenTls: "127.0.0.1:9443",
          hosts: ["fresnel.example.com"],
        },
      });
    });
  },
  60_000,
);

realTest(
  "host.remote.proxyExample refuses a domain that is not a DNS name with the /domain issue",
  async () => {
    writeUserSettings(home, {});
    await withService({ gateway: fakeGateway(OFF_VIEW).supervisor }, async (client) => {
      const failure = await wireErrorOf(
        client.request("host.remote.proxyExample", {
          kind: "caddy",
          domain: "not a domain!",
          tlsPort: PORT,
        }),
      );
      expect(failure.data.kind).toBe("jsonrpc.invalidParams");
      expect(failure.data.details).toEqual({
        issues: [{ path: "/domain", message: "invalid_domain" }],
      });
    });
  },
  60_000,
);

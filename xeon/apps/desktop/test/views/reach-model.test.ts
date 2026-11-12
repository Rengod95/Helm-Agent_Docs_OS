import { describe, expect, test } from "bun:test";
import {
  autoFixOf,
  causeTextOf,
  configIssueTextOf,
  defaultReachMode,
  domainIssueOf,
  fixTextOf,
  isPublicDomain,
  kindOfHost,
  loginLinkOf,
  panelAddressesOf,
  publicDomainOf,
  reachLinesOf,
  scopeOfKind,
  serveCommandOf,
  serveFailureTextOf,
  tailscaleBandOf,
} from "../../src/views/pages/connection/reach-model.ts";
import { preflightOf, TAILSCALE_READY } from "./reach-fixtures.ts";

// 휴대폰·브라우저 구역의 순수 판단. 값으로 비교한다.

describe("reachLinesOf", () => {
  test("groups the seven items into four lines in order", () => {
    const lines = reachLinesOf({ kind: "ready", value: preflightOf() });
    expect(lines.map((line) => [line.id, line.state, line.cause])).toEqual([
      ["service", "passed", null],
      ["remote", "passed", "desktop.connection.reach.cause.certSelfSigned"],
      ["port", "passed", null],
      ["address", "passed", null],
    ]);
  });

  test("a failed item wins its line and brings its fix and auto fix", () => {
    const lines = reachLinesOf({
      kind: "ready",
      value: preflightOf({
        allowed_hosts: {
          status: "fail",
          cause: "host_missing",
          fix: "set_allowed_hosts",
          autoFix: "add_allowed_hosts",
          detail: { missing: ["my-mac.local", 3] },
        },
        autostart: {
          status: "fail",
          cause: "autostart_missing",
          fix: "enable_autostart",
          autoFix: "install_autostart",
        },
      }),
    });
    // 자동 시작은 막는 항목이 아니라 확인 필요(attention)다
    expect(lines[0]).toEqual({
      id: "service",
      state: "attention",
      cause: "desktop.connection.reach.cause.autostartMissing",
      fix: "desktop.connection.reach.fix.enableAutostart",
      autoFix: "autostart",
      missingHosts: [],
    });
    expect(lines[2]).toEqual({
      id: "port",
      state: "failed",
      cause: "desktop.connection.reach.cause.hostMissing",
      fix: "desktop.connection.reach.fix.setHosts",
      autoFix: "addHosts",
      missingHosts: ["my-mac.local"],
    });
  });

  test("all skipped is skipped with the first cause", () => {
    const lines = reachLinesOf({
      kind: "ready",
      value: preflightOf({
        listen_port: { status: "skip", cause: "depends_on_failed" },
        allowed_hosts: { status: "skip", cause: "no_tls_port" },
      }),
    });
    expect(lines[2]?.state).toBe("skipped");
    expect(lines[2]?.cause).toBe("desktop.connection.reach.cause.dependsOnFailed");
  });

  test("loading is running, idle and failed are waiting", () => {
    expect(reachLinesOf({ kind: "loading" }).map((line) => line.state)).toEqual([
      "running",
      "running",
      "running",
      "running",
    ]);
    expect(reachLinesOf({ kind: "idle" })[0]?.state).toBe("waiting");
    expect(reachLinesOf({ kind: "failed", error: { kind: "bad-reply" } })[3]?.state).toBe(
      "waiting",
    );
  });
});

describe("codes", () => {
  test("unknown cause is the generic line, unknown fix and auto fix are none", () => {
    expect(causeTextOf("something_new")).toBe("desktop.connection.reach.cause.unknown");
    expect(causeTextOf(null)).toBeNull();
    expect(fixTextOf("something_new")).toBeNull();
    expect(autoFixOf("toString")).toBeNull();
    expect(autoFixOf("start_service")).toBe("startService");
    expect(autoFixOf("enable_gateway")).toBe("enableRemote");
    expect(autoFixOf("refresh_autostart")).toBe("autostart");
  });

  test("config issues and serve failures", () => {
    expect(configIssueTextOf("host_bad_name")).toBe(
      "desktop.connection.reach.configIssue.hostBadName",
    );
    expect(configIssueTextOf("tls_cert_invalid")).toBe(
      "desktop.connection.reach.configIssue.unknown",
    );
    expect(serveFailureTextOf("https_not_enabled")).toBe(
      "desktop.connection.reach.serveFailure.httpsNotEnabled",
    );
    expect(serveFailureTextOf("weird")).toBe("desktop.connection.reach.serveFailure.failed");
  });

  test("serve command uses the TLS port", () => {
    expect(serveCommandOf(47443)).toBe(
      "tailscale serve --bg --https=443 https+insecure://127.0.0.1:47443",
    );
  });
});

describe("default mode", () => {
  test("tailscale serve on, then a public domain, then wifi", () => {
    const on = {
      ...TAILSCALE_READY,
      serve: { kind: "on" as const, url: "https://my-mac.tail1234.ts.net" },
    };
    expect(defaultReachMode(on, ["fresnel.example.com"])).toBe("tailscale");
    expect(defaultReachMode(TAILSCALE_READY, ["192.168.0.10", "fresnel.example.com"])).toBe(
      "public",
    );
    expect(defaultReachMode(null, ["192.168.0.10", "my-mac.local"])).toBe("wifi");
  });

  test("public domain detection", () => {
    expect(isPublicDomain("fresnel.example.com")).toBe(true);
    expect(isPublicDomain("192.168.0.10")).toBe(false);
    expect(isPublicDomain("my-mac.local")).toBe(false);
    expect(isPublicDomain("my-mac.tail1234.ts.net")).toBe(false);
    expect(isPublicDomain("localhost")).toBe(false);
    expect(isPublicDomain("fe80::1")).toBe(false);
    expect(publicDomainOf(["my-mac.local", "a.example.org"])).toBe("a.example.org");
  });
});

describe("domainIssueOf", () => {
  test("names only", () => {
    expect(domainIssueOf("  ")).toBe("empty");
    expect(domainIssueOf("https://fresnel.example.com")).toBe("notDomain");
    expect(domainIssueOf("fresnel.example.com:443")).toBe("notDomain");
    expect(domainIssueOf("bad_name.example.com")).toBe("notDomain");
    expect(domainIssueOf("my-mac.local")).toBe("notPublic");
    expect(domainIssueOf(" fresnel.example.com ")).toBeNull();
  });
});

describe("addresses", () => {
  test("host kinds and scopes", () => {
    expect(kindOfHost("127.0.0.1")).toBe("loopback");
    expect(kindOfHost("100.101.1.2")).toBe("tailscale_ip");
    expect(kindOfHost("100.200.1.2")).toBe("lan_ip");
    expect(kindOfHost("my-mac.tail1234.ts.net")).toBe("tailscale_magicdns");
    expect(kindOfHost("my-mac.local")).toBe("mdns_local");
    expect(scopeOfKind("mdns_local")).toBe("wifi");
    expect(scopeOfKind("tailscale_ip")).toBe("tailscale");
  });

  test("login link keeps the code in the fragment", () => {
    expect(loginLinkOf("https://fresnel.example.com", "ABCDE12345")).toBe(
      "https://fresnel.example.com/login#code=ABCDE12345",
    );
    expect(loginLinkOf("not a url", "X")).toBeNull();
  });

  test("wifi keeps LAN links, tailscale prefers the serve address, public uses the domain", () => {
    const links = [
      { kind: "lan_ip" as const, url: "https://192.168.0.10:47443/login#code=ABCDE12345" },
      { kind: "tailscale_ip" as const, url: "https://100.101.1.2:47443/login#code=ABCDE12345" },
    ];
    const base = { links, urls: [], code: "ABCDE12345", serveUrl: null, domain: null };
    expect(panelAddressesOf({ ...base, mode: "wifi" })).toEqual([
      {
        base: "https://192.168.0.10:47443",
        link: "https://192.168.0.10:47443/login#code=ABCDE12345",
        scope: "wifi",
      },
    ]);
    expect(
      panelAddressesOf({ ...base, mode: "tailscale", serveUrl: "https://my-mac.tail1234.ts.net" }),
    ).toEqual([
      {
        base: "https://my-mac.tail1234.ts.net",
        link: "https://my-mac.tail1234.ts.net/login#code=ABCDE12345",
        scope: "tailscale",
      },
    ]);
    expect(panelAddressesOf({ ...base, mode: "public", domain: "fresnel.example.com" })).toEqual([
      {
        base: "https://fresnel.example.com",
        link: "https://fresnel.example.com/login#code=ABCDE12345",
        scope: "internet",
      },
    ]);
    expect(panelAddressesOf({ ...base, mode: "public" })).toEqual([]);
  });

  test("without a code the status addresses are sorted by scope", () => {
    expect(
      panelAddressesOf({
        mode: "wifi",
        links: [],
        urls: [
          "https://192.168.0.10:47443",
          "https://my-mac.local:47443",
          "http://127.0.0.1:47100",
        ],
        code: null,
        serveUrl: null,
        domain: null,
      }).map((address) => [address.base, address.link]),
    ).toEqual([
      ["https://192.168.0.10:47443", null],
      ["https://my-mac.local:47443", null],
    ]);
  });
});

describe("tailscaleBandOf", () => {
  test("states", () => {
    expect(tailscaleBandOf(TAILSCALE_READY)).toEqual({
      tone: "success",
      title: "desktop.connection.reach.tailscale.ready",
      name: "my-mac.tail1234.ts.net",
      description: null,
      action: null,
    });
    expect(tailscaleBandOf({ ...TAILSCALE_READY, state: "not_installed" }).action).toBe("download");
    expect(
      tailscaleBandOf({ ...TAILSCALE_READY, state: "needs_login", authUrl: "https://login" })
        .action,
    ).toBe("login");
    expect(tailscaleBandOf({ ...TAILSCALE_READY, state: "needs_login" }).action).toBe("reload");
    expect(tailscaleBandOf({ ...TAILSCALE_READY, state: "unreadable" }).tone).toBe("danger");
  });
});

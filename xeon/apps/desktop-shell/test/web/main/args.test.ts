// 인자 해석 표: 정상 값과 기본값, 루프백 제한, 짝이 맞는 인증서, 상대 경로 거절, 모르는 옵션, 중복, 값 없음, 포트와 호스트 모양.
import { describe, expect, test } from "bun:test";
import {
  parseArgs,
  parseHostPort,
  USAGE_TEXT,
  type ArgDefaults,
} from "../../../src/web/main/args.ts";

const DEFAULTS: ArgDefaults = { uiDir: "/opt/fresnel/ui" };
const BASE: readonly string[] = [
  "--socket",
  "/run/fresnel/fresnel.sock",
  "--state-dir",
  "/var/fresnel/state",
];

/** 사용법 오류의 문장, 성공이면 null */
function usageOf(argv: readonly string[]): string | null {
  const parsed = parseArgs(argv, DEFAULTS);
  return parsed.ok ? null : parsed.error.message;
}

describe("parseArgs: accepted", () => {
  test("the required pair alone gives the defaults: loopback 8480, no TLS, the default UI folder", () => {
    expect(parseArgs(BASE, DEFAULTS)).toEqual({
      ok: true,
      value: {
        kind: "run",
        options: {
          socketPath: "/run/fresnel/fresnel.sock",
          stateDir: "/var/fresnel/state",
          loopbackPort: 8480,
          tls: null,
          uiDir: "/opt/fresnel/ui",
        },
      },
    });
  });

  test("port 0 is allowed on the loopback listener, and --name=value works", () => {
    const parsed = parseArgs(
      ["--socket=/s.sock", "--state-dir=/state", "--listen=localhost:0", "--ui=/ui"],
      DEFAULTS,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "run",
        options: {
          socketPath: "/s.sock",
          stateDir: "/state",
          loopbackPort: 0,
          tls: null,
          uiDir: "/ui",
        },
      },
    });
  });

  test("an external TLS listener with two extra names and a user certificate", () => {
    const parsed = parseArgs(
      [
        ...BASE,
        "--listen-tls",
        "192.168.1.20:8443",
        "--hosts",
        "fresnel.lan,alt.lan",
        "--tls-cert",
        "/certs/fullchain.pem",
        "--tls-key",
        "/certs/key.pem",
      ],
      DEFAULTS,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "run",
        options: {
          socketPath: "/run/fresnel/fresnel.sock",
          stateDir: "/var/fresnel/state",
          loopbackPort: 8480,
          tls: {
            host: "192.168.1.20",
            port: 8443,
            hosts: ["192.168.1.20", "fresnel.lan", "alt.lan"],
            certPath: "/certs/fullchain.pem",
            keyPath: "/certs/key.pem",
          },
          uiDir: "/opt/fresnel/ui",
        },
      },
    });
  });

  test("a wildcard TLS address takes its names from --hosts only", () => {
    const parsed = parseArgs(
      [...BASE, "--listen-tls", "[::]:8443", "--hosts", "fresnel.lan"],
      DEFAULTS,
    );
    expect(parsed.ok && parsed.value.kind === "run" && parsed.value.options.tls).toEqual({
      host: "::",
      port: 8443,
      hosts: ["fresnel.lan"],
      certPath: null,
      keyPath: null,
    });
  });

  test("--help wins when the rest is valid", () => {
    expect(parseArgs(["--help"], DEFAULTS)).toEqual({ ok: true, value: { kind: "help" } });
    expect(parseArgs([...BASE, "--help"], DEFAULTS)).toEqual({ ok: true, value: { kind: "help" } });
  });
});

describe("parseArgs: rejected (exit 2 usage)", () => {
  const cases: readonly (readonly [string, readonly string[], string])[] = [
    ["a missing socket", ["--state-dir", "/state"], "--socket is required"],
    ["a missing state folder", ["--socket", "/s.sock"], "--state-dir is required"],
    [
      "a relative socket path",
      ["--socket", "fresnel.sock", "--state-dir", "/state"],
      "--socket must be an absolute path",
    ],
    [
      "a relative state folder",
      ["--socket", "/s.sock", "--state-dir", "state"],
      "--state-dir must be an absolute path",
    ],
    ["a relative UI folder", [...BASE, "--ui", "ui"], "--ui must be an absolute path"],
    [
      "a relative certificate",
      [...BASE, "--listen-tls", "127.0.0.1:0", "--tls-cert", "cert.pem", "--tls-key", "/k.pem"],
      "--tls-cert must be an absolute path",
    ],
    [
      "a non-loopback HTTP listener",
      [...BASE, "--listen", "0.0.0.0:8480"],
      "--listen must be a loopback address (127.0.0.1 or localhost), not 0.0.0.0",
    ],
    [
      "a LAN address for the HTTP listener",
      [...BASE, "--listen", "192.168.1.5:8480"],
      "--listen must be a loopback address (127.0.0.1 or localhost), not 192.168.1.5",
    ],
    [
      "an IPv6 loopback that the listener cannot bind",
      [...BASE, "--listen", "[::1]:8480"],
      "--listen must be a loopback address (127.0.0.1 or localhost), not ::1",
    ],
    [
      "a port above 65535",
      [...BASE, "--listen", "127.0.0.1:70000"],
      "--listen needs <host>:<port>",
    ],
    [
      "a listener without a port",
      [...BASE, "--listen", "127.0.0.1"],
      "--listen needs <host>:<port>",
    ],
    [
      "a certificate without a key",
      [...BASE, "--listen-tls", "127.0.0.1:0", "--tls-cert", "/c.pem"],
      "--tls-cert and --tls-key must be given together",
    ],
    [
      "a key without a certificate",
      [...BASE, "--listen-tls", "127.0.0.1:0", "--tls-key", "/k.pem"],
      "--tls-cert and --tls-key must be given together",
    ],
    [
      "a certificate without the TLS listener",
      [...BASE, "--tls-cert", "/c.pem", "--tls-key", "/k.pem"],
      "--tls-cert and --tls-key need --listen-tls",
    ],
    [
      "extra names without the TLS listener",
      [...BASE, "--hosts", "fresnel.lan"],
      "--hosts needs --listen-tls",
    ],
    [
      "a wildcard TLS address without names",
      [...BASE, "--listen-tls", "0.0.0.0:8443"],
      "--listen-tls on a wildcard address needs --hosts (the names the browser uses)",
    ],
    [
      "a bad name in --hosts",
      [...BASE, "--listen-tls", "127.0.0.1:0", "--hosts", "bad name"],
      '--hosts has a bad name: "bad name"',
    ],
    [
      "an empty name in --hosts",
      [...BASE, "--listen-tls", "127.0.0.1:0", "--hosts", "a.lan,,b.lan"],
      '--hosts has a bad name: ""',
    ],
    ["an unknown option", [...BASE, "--bogus", "1"], "unknown option: --bogus"],
    ["a positional argument", [...BASE, "extra"], "unknown option: extra"],
    ["a repeated option", [...BASE, "--socket", "/other.sock"], "--socket is given more than once"],
    ["an option without its value", ["--socket"], "--socket needs a value"],
    [
      "an option followed by another option",
      ["--socket", "--state-dir", "/state"],
      "--socket needs a value",
    ],
    ["an empty value", ["--socket="], "--socket needs a value"],
    ["--help with a value", ["--help=yes"], "--help takes no value"],
  ];
  for (const [name, argv, message] of cases) {
    test(name, () => {
      expect(usageOf(argv)).toBe(message);
    });
  }

  test("the usage text names every option", () => {
    for (const flag of [
      "--socket",
      "--state-dir",
      "--listen",
      "--listen-tls",
      "--hosts",
      "--tls-cert",
      "--tls-key",
      "--ui",
      "--help",
    ]) {
      expect(USAGE_TEXT).toContain(flag);
    }
  });
});

describe("parseHostPort", () => {
  test("splits names, IPv4 and bracketed IPv6", () => {
    expect(parseHostPort("127.0.0.1:8480")).toEqual({ host: "127.0.0.1", port: 8480 });
    expect(parseHostPort("[::1]:0")).toEqual({ host: "::1", port: 0 });
    expect(parseHostPort("fresnel.lan:65535")).toEqual({ host: "fresnel.lan", port: 65535 });
    expect(parseHostPort("no-port")).toBeNull();
    expect(parseHostPort("host:65536")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { parseServiceEndpoint } from "../src/endpoint.ts";

// 원격 서비스 주소 문법(설정 키 l0.process.service.remote와 --remote). 값으로 비교한다.

describe("parseServiceEndpoint", () => {
  test("unix: and a bare absolute path", () => {
    expect(parseServiceEndpoint("unix:/run/user/1000/xeon/xeon.sock")).toEqual({
      ok: true,
      value: { kind: "unix", path: "/run/user/1000/xeon/xeon.sock" },
    });
    expect(parseServiceEndpoint("  /tmp/x.sock ")).toEqual({
      ok: true,
      value: { kind: "unix", path: "/tmp/x.sock" },
    });
  });

  test("tcp with a name, an IPv4 address and a bracketed IPv6 address (brackets are dropped)", () => {
    expect(parseServiceEndpoint("tcp://box.tailnet.ts.net:7421")).toEqual({
      ok: true,
      value: { kind: "tcp", host: "box.tailnet.ts.net", port: 7421 },
    });
    expect(parseServiceEndpoint("tcp://100.64.0.7:1")).toEqual({
      ok: true,
      value: { kind: "tcp", host: "100.64.0.7", port: 1 },
    });
    expect(parseServiceEndpoint("tcp://[fd7a::1]:65535")).toEqual({
      ok: true,
      value: { kind: "tcp", host: "fd7a::1", port: 65_535 },
    });
  });

  test("ssh with and without user and port; the remote socket is the path", () => {
    expect(parseServiceEndpoint("ssh://me@box.example:2222/run/user/1000/xeon/xeon.sock")).toEqual({
      ok: true,
      value: {
        kind: "ssh",
        target: "me@box.example",
        remoteSocket: "/run/user/1000/xeon/xeon.sock",
        port: 2222,
      },
    });
    expect(parseServiceEndpoint("ssh://box/home/me/xeon.sock")).toEqual({
      ok: true,
      value: { kind: "ssh", target: "box", remoteSocket: "/home/me/xeon.sock" },
    });
  });

  test("rejects empty text, unknown schemes, bad ports and hosts", () => {
    expect(parseServiceEndpoint("   ")).toEqual({ ok: false, error: { kind: "empty" } });
    expect(parseServiceEndpoint("http://box:80")).toEqual({
      ok: false,
      error: { kind: "unknown_scheme" },
    });
    expect(parseServiceEndpoint("relative.sock")).toEqual({
      ok: false,
      error: { kind: "unknown_scheme" },
    });
    expect(parseServiceEndpoint("tcp://box:0")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "port" },
    });
    expect(parseServiceEndpoint("tcp://box:70000")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "port" },
    });
    expect(parseServiceEndpoint("tcp://:7000")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "host" },
    });
    expect(parseServiceEndpoint("tcp://box")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "host" },
    });
  });

  test("rejects an ssh target that ssh would read as an option or that carries shell text, and unsafe socket paths", () => {
    for (const text of [
      "ssh://-oProxyCommand=touch@box/run/x.sock",
      "ssh://-box/run/x.sock",
      "ssh://me@box;reboot/run/x.sock",
      "ssh://me@bo x/run/x.sock",
    ]) {
      expect(parseServiceEndpoint(text)).toEqual({
        ok: false,
        error: { kind: "invalid", part: "target" },
      });
    }
    for (const text of ["ssh://box", "ssh://box/run/a b.sock", "ssh://box/run/a:b.sock"]) {
      expect(parseServiceEndpoint(text)).toEqual({
        ok: false,
        error: { kind: "invalid", part: "path" },
      });
    }
    expect(parseServiceEndpoint("unix:relative")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "path" },
    });
    expect(parseServiceEndpoint("ssh://box:99999/run/x.sock")).toEqual({
      ok: false,
      error: { kind: "invalid", part: "port" },
    });
  });
});

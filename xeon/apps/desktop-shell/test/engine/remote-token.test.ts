import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ProcessRunner, RunRequest } from "@fresnel/platform-secrets/vault";
import { remoteTokenAccount, remoteTokenSource } from "../../src/main/engine/remote-token.ts";

// wss 대상의 기기 토큰을 OS 보안 저장소 도구(`security`)로 읽는 길. 진짜 키체인은 건드리지 않고 가짜 실행기만 쓴다.

const FAKE = "stored-device-token-for-tests-only";

function recording(stdout: string): {
  readonly runner: ProcessRunner;
  readonly calls: RunRequest[];
} {
  const calls: RunRequest[] = [];
  const runner: ProcessRunner = (request) => {
    calls.push(request);
    return Promise.resolve(
      ok({ exitCode: 0, stdout: new TextEncoder().encode(stdout), stderr: "" }),
    );
  };
  return { runner, calls };
}

const notFound: ProcessRunner = () =>
  Promise.resolve(ok({ exitCode: 44, stdout: new Uint8Array(), stderr: "" }));

describe("remoteTokenAccount", () => {
  test("host:port, lowercase host, bracketed IPv6, pin suffix ignored, only wss", () => {
    expect(remoteTokenAccount("wss://Box.Example.com:8443")).toBe("box.example.com:8443");
    expect(remoteTokenAccount(`wss://box.example.com:8443/pin/${"a".repeat(64)}`)).toBe(
      "box.example.com:8443",
    );
    expect(remoteTokenAccount("wss://[fd7a::1]:8443")).toBe("[fd7a::1]:8443");
    expect(remoteTokenAccount("tcp://127.0.0.1:7421")).toBeNull();
    expect(remoteTokenAccount("unix:/tmp/a.sock")).toBeNull();
  });
});

describe("remoteTokenSource", () => {
  test("a wss address reads the keychain item of host:port and returns the value", async () => {
    const { runner, calls } = recording(`${FAKE}\n`);
    const source = remoteTokenSource({
      platform: "darwin",
      env: { PATH: "/usr/bin", HOME: "/Users/tester", SECRET_ELSEWHERE: "no" },
      runner,
    });
    expect(await source("wss://box.example.com:8443/pin/" + "b".repeat(64))).toBe(FAKE);
    expect(calls.map((call) => call.argv)).toEqual([
      [
        "/usr/bin/security",
        "find-generic-password",
        "-s",
        "fresnel.remote-device",
        "-a",
        "box.example.com:8443",
        "-w",
      ],
    ]);
    expect(calls[0]?.env).toEqual({ PATH: "/usr/bin", HOME: "/Users/tester" });
  });

  test("a non-wss address, or a platform without a store, never reaches the runner", async () => {
    const darwin = recording(FAKE);
    expect(
      await remoteTokenSource({ platform: "darwin", env: {}, runner: darwin.runner })(
        "tcp://127.0.0.1:1",
      ),
    ).toBeUndefined();
    expect(darwin.calls).toEqual([]);
    const other = recording(FAKE);
    expect(
      await remoteTokenSource({ platform: "win32", env: {}, runner: other.runner })(
        "wss://box.example.com:8443",
      ),
    ).toBeUndefined();
    expect(other.calls).toEqual([]);
  });

  test("a missing item (exit 44) is undefined", async () => {
    expect(
      await remoteTokenSource({ platform: "darwin", env: {}, runner: notFound })(
        "wss://box.example.com:8443",
      ),
    ).toBeUndefined();
  });
});

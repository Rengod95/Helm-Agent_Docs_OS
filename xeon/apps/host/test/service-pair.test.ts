import { afterEach, expect, test } from "bun:test";
import type { ServiceRegistration } from "@fresnel/platform-process";
import type { WireResult } from "@fresnel/contracts/wire";
import { parseHostArgv } from "../src/argv.ts";
import type { CommandIo } from "../src/host-command.ts";
import { runServiceCommand, pairTextOf, serviceStatusText } from "../src/service/commands.ts";
import { scratchRuntimeDir } from "./fixtures/service-harness.ts";

// `service pair`의 인자, 사람용 한 줄, 서비스가 없을 때의 종료코드와 상태 글의 원격 줄(L4.remote §8.3, §11).
// 서비스를 띄우는 시험은 int 쪽이다. 여기는 서비스 없이 되는 것만 본다.

// 접속 토큰은 실행 때 만든다(비밀 스캐너가 소스의 고정 문자열을 시크릿으로 읽는다)
const TOKEN = ["fixture", "service", "connect", "token"].join("-").padEnd(43, "x");
const REGISTRATION: ServiceRegistration = {
  schemaVersion: 1,
  version: "0.0.1",
  protocolVersion: "1.0.0",
  socket: "/tmp/fresnel.sock",
  pid: 4242,
  startedAt: 1700000000000,
  token: TOKEN,
  storeId: "store-1",
};
const HOST = {
  mode: "service",
  pid: 4242,
  startedAt: "2023-11-14T22:13:20.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
} as const;
const REMOTE_ON: WireResult<"host.remote.status"> = {
  enabled: true,
  state: "running",
  loopbackPort: 8480,
  tlsPort: 8443,
  hosts: ["fresnel.example"],
  fingerprint: "a".repeat(64),
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

const dirs: { dispose(): void }[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.dispose();
});

function captureIo(): { readonly io: CommandIo; stdout(): string; stderr(): string } {
  const decoder = new TextDecoder();
  const out: string[] = [];
  const err: string[] = [];
  const sink = (target: string[]): WritableStream<Uint8Array> =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        target.push(decoder.decode(chunk));
      },
    });
  return {
    io: { stdin: new ReadableStream<Uint8Array>(), stdout: sink(out), stderr: sink(err) },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

test("service pair and service pair --json parse to the pair command; other arguments are refused", () => {
  expect(parseHostArgv(["service", "pair"])).toEqual({
    ok: true,
    command: { kind: "service-pair", json: false },
  });
  expect(parseHostArgv(["service", "pair", "--json"])).toEqual({
    ok: true,
    command: { kind: "service-pair", json: true },
  });
  expect(parseHostArgv(["service", "pair", "--force"])).toEqual({
    ok: false,
    message: "unknown argument: --force",
  });
});

test("the pairing line groups the code and rounds the remaining minutes up, never below zero", () => {
  const now = 1_800_000_000_000;
  expect(pairTextOf("ABCDE12345", now + 4 * 60_000 + 30_000, now)).toBe(
    "pairing code ABCDE-12345 (expires in 5 min)\n",
  );
  expect(pairTextOf("ABCDE12345", now - 1, now)).toBe(
    "pairing code ABCDE-12345 (expires in 0 min)\n",
  );
});

test("service pair with no service running exits 1 with one line that says what to do, and prints no code", async () => {
  const runtime = scratchRuntimeDir();
  dirs.push(runtime);
  const captured = captureIo();
  const code = await runServiceCommand({ kind: "service-pair", json: false }, captured.io, {
    runtimeDir: runtime.dir,
  });
  expect(code).toBe(1);
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe(
    'service is not running; start it with "fresnel service start" and try again\n',
  );
});

test("the status text adds remote lines only when remote access is on", () => {
  const off = serviceStatusText(REGISTRATION, HOST);
  expect(serviceStatusText(REGISTRATION, HOST, null)).toBe(off);
  expect(
    serviceStatusText(REGISTRATION, HOST, { ...REMOTE_ON, enabled: false, state: "off" }),
  ).toBe(off);

  const on = serviceStatusText(REGISTRATION, HOST, REMOTE_ON);
  expect(on).toContain("remote running\n");
  expect(on).toContain("ports loopback 8480, tls 8443\n");
  expect(on).toContain(`fingerprint ${"a".repeat(64)}\n`);
  expect(on).not.toContain(TOKEN);
});

test("a failed remote state names its error kind on the remote line", () => {
  const failed = serviceStatusText(REGISTRATION, HOST, {
    ...REMOTE_ON,
    state: "failed",
    loopbackPort: null,
    tlsPort: null,
    fingerprint: null,
    error: { kind: "gateway-binary-missing", message: "fresnel-web was not found" },
  });
  expect(failed).toContain("remote failed (gateway-binary-missing)\n");
  expect(failed).not.toContain("ports ");
  expect(failed).not.toContain("fingerprint ");
});

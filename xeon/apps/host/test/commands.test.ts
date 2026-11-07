import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceRegistration } from "@fresnel/platform-process";
import { parseHostArgv } from "../src/argv.ts";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";
import { runHostCommand, type CommandIo } from "../src/main.ts";
import { listenTcpNotAppliedNotice, serviceStatusText } from "../src/service/commands.ts";
import { renderSettingsSchema } from "../src/settings.ts";
import { useEngineHome } from "./fixtures/engine-home.ts";
import { writeUserSettings } from "./fixtures/user-settings.ts";

const scratch = mkdtempSync(join(tmpdir(), "xh-cmd-"));

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
// TCP 주소는 등록 파일이 더한 필드다(스키마에 없어 교차형으로 적는다)
const WITH_TCP: ServiceRegistration & { readonly tcp: string } = {
  ...REGISTRATION,
  tcp: "127.0.0.1:7777",
};
const HOST = {
  mode: "service",
  pid: 4242,
  startedAt: "2023-11-14T22:13:20.000Z",
  connections: 1,
  liveTurns: 0,
  idleShutdownAt: null,
} as const;
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
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
    io: {
      stdin: new ReadableStream<Uint8Array>(),
      stdout: sink(out),
      stderr: sink(err),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

function coreSchema(scope: "managed" | "user" | "project" | "local"): string {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return renderSettingsSchema(built.catalog, scope);
}

test("config-schema writes the schema to stdout and exits 0", async () => {
  const captured = captureIo();
  const code = await runHostCommand(
    { kind: "config-schema", scope: "user", coreOnly: true },
    captured.io,
  );
  expect(code).toBe(0);
  expect(captured.stdout()).toBe(coreSchema("user"));
  expect(captured.stderr()).toBe("");
});

test("config-schema --out writes the file and leaves stdout empty", async () => {
  const captured = captureIo();
  const out = join(scratch, "managed.json");
  const code = await runHostCommand(
    { kind: "config-schema", scope: "managed", coreOnly: false, out },
    captured.io,
  );
  expect(code).toBe(0);
  expect(readFileSync(out, "utf8")).toBe(coreSchema("managed"));
  expect(captured.stdout()).toBe("");
});

test("service status and stop with no service running: status exits 1 with a value, stop exits 0", async () => {
  const home = useEngineHome();
  try {
    const status = captureIo();
    expect(await runHostCommand({ kind: "service-status", json: true }, status.io)).toBe(1);
    expect(JSON.parse(status.stdout())).toEqual({ running: false, reason: "no_registration" });
    const stop = captureIo();
    expect(await runHostCommand({ kind: "service-stop" }, stop.io)).toBe(0);
    expect(stop.stdout()).toBe("service not running\n");
  } finally {
    home.dispose();
  }
});

test("service launch-mode reads the user settings file without an engine", async () => {
  const home = useEngineHome();
  try {
    const off = captureIo();
    expect(await runHostCommand({ kind: "service-launch-mode" }, off.io)).toBe(0);
    expect(JSON.parse(off.stdout())).toEqual({ mode: "in-process" });
    writeUserSettings(home, { "l0.process.service.enabled": true });
    const on = captureIo();
    expect(await runHostCommand({ kind: "service-launch-mode" }, on.io)).toBe(0);
    expect(JSON.parse(on.stdout())).toEqual({ mode: "service" });
  } finally {
    home.dispose();
  }
});

test("service ensure reports a spawn failure as a json value and exits 1", async () => {
  const home = useEngineHome();
  try {
    const captured = captureIo();
    const code = await runHostCommand(
      { kind: "service-ensure", start: { command: "/nonexistent/fresnel", args: [] } },
      captured.io,
    );
    expect(code).toBe(1);
    expect(JSON.parse(captured.stdout())).toEqual({ ok: false, reason: "spawn_failed" });
  } finally {
    home.dispose();
  }
});

test("parseHostArgv maps the development entry arguments to commands", () => {
  expect(parseHostArgv(["host", "--stdio"])).toEqual({ ok: true, command: { kind: "host-stdio" } });
  expect(
    parseHostArgv(["config", "schema", "--scope", "project", "--out", "x.json", "--core-only"]),
  ).toEqual({
    ok: true,
    command: { kind: "config-schema", scope: "project", coreOnly: true, out: "x.json" },
  });
  expect(parseHostArgv(["config", "schema", "--scope", "local"])).toEqual({
    ok: true,
    command: { kind: "config-schema", scope: "local", coreOnly: false },
  });
  expect(parseHostArgv(["service", "status", "--json"])).toEqual({
    ok: true,
    command: { kind: "service-status", json: true },
  });
  expect(parseHostArgv(["service", "launch-mode"])).toEqual({
    ok: true,
    command: { kind: "service-launch-mode" },
  });
});

test("parseHostArgv rejects what it does not know", () => {
  expect(parseHostArgv([]).ok).toBe(false);
  expect(parseHostArgv(["host"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--stdio", "extra"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "launch"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "user", "--wat"]).ok).toBe(false);
  expect(parseHostArgv(["config", "schema", "--scope", "user", "--out"]).ok).toBe(false);
  expect(parseHostArgv(["service", "bogus"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--wat"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--listen-tcp", "nohost"]).ok).toBe(false);
  expect(parseHostArgv(["host", "--service", "--listen-tcp", "x:99999"]).ok).toBe(false);
});

test("service status text shows the tcp address and the idle line, and never the token", () => {
  expect(serviceStatusText(WITH_TCP, HOST)).toBe(
    [
      "service running (pid 4242, version 0.0.1)",
      "socket /tmp/fresnel.sock",
      "tcp 127.0.0.1:7777",
      "connections 1, live turns 0",
      "idle shutdown none (clients are connected)",
      "",
    ].join("\n"),
  );
  expect(serviceStatusText(WITH_TCP, HOST)).not.toContain(TOKEN);
});

test("service status text without tcp has no tcp line, and a set idle shutdown time is printed with its time", () => {
  expect(
    serviceStatusText(REGISTRATION, {
      ...HOST,
      connections: 0,
      idleShutdownAt: "2023-11-14T22:14:20.000Z",
      safeMode: true,
    }),
  ).toBe(
    [
      "service running (pid 4242, version 0.0.1)",
      "socket /tmp/fresnel.sock",
      "connections 0, live turns 0",
      "idle shutdown at 2023-11-14T22:14:20.000Z, safe mode",
      "",
    ].join("\n"),
  );
});

test("--listen-tcp on a service that is already running is named on stderr and not applied", () => {
  const warning =
    'the service was already running, so --listen-tcp was not applied; run "fresnel service stop" and start it again to open TCP\n';
  expect(
    listenTcpNotAppliedNotice(
      { host: "127.0.0.1", port: 7777 },
      { kind: "connected", registration: REGISTRATION, started: false },
    ),
  ).toBe(warning);
  expect(
    listenTcpNotAppliedNotice(
      { host: "127.0.0.1", port: 8888 },
      { kind: "connected", registration: WITH_TCP, started: false },
    ),
  ).toBe(warning);
  // 요청한 주소로 이미 열려 있으면 알릴 것이 없다
  expect(
    listenTcpNotAppliedNotice(
      { host: "127.0.0.1", port: 7777 },
      { kind: "connected", registration: WITH_TCP, started: false },
    ),
  ).toBeUndefined();
  // 이 실행이 새로 띄운 서비스이면 옵션이 적용된 것이다
  expect(
    listenTcpNotAppliedNotice(
      { host: "127.0.0.1", port: 7777 },
      { kind: "connected", registration: WITH_TCP, started: true },
    ),
  ).toBeUndefined();
});

test("parseHostArgv maps host --service and service run to service-run with safe mode and tcp", () => {
  expect(parseHostArgv(["host", "--service"])).toEqual({
    ok: true,
    command: { kind: "service-run", safeMode: false },
  });
  expect(
    parseHostArgv(["service", "run", "--safe-mode", "--listen-tcp", "127.0.0.1:7777"]),
  ).toEqual({
    ok: true,
    command: { kind: "service-run", safeMode: true, tcp: { host: "127.0.0.1", port: 7777 } },
  });
});

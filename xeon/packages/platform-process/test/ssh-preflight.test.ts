import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSshTarget,
  runSshPreflight,
  spawnExec,
  type ExecFn,
  type PreflightCode,
  type PreflightEvent,
  type PreflightResult,
  type SshPreflightDeps,
  type SshPreflightInput,
} from "../src/index.ts";
import { makeFakeSsh, type FakeSsh } from "./support/fake-ssh.ts";
import { realClock } from "./support/real-time.ts";

// L0 사전 점검(ssh-preflight.ts). 가짜 ssh 도구(셸 스크립트)를 sshPath 등으로 끼워 실제 자식 프로세스 경로를 시험한다.
// 결과와 이벤트는 값으로 비교한다. 시간(durationMs)은 비교하지 않는다.

const OPTS =
  "-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=0";
const LOCAL = { cli: "0.4.0", contract: "0.1.0" };
const SOCKET = "/run/user/1000/fresnel/fresnel.sock";
const KEY_A = "box.example ssh-ed25519 AAAAFAKEKEY1";
const KEY_B = "box.example ssh-ed25519 BBBBFAKEKEY2";
const NEW_KEY_ERR =
  "No ED25519 host key is known for box.example and you have requested strict checking.\nHost key verification failed.\n";
const CHANGED_ERR =
  "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nHost key verification failed.\n";

const dirs: string[] = [];
const cleanup = (): void => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
};
afterEach(cleanup);

function fixture(): FakeSsh {
  const fake = makeFakeSsh();
  dirs.push(fake.root);
  return fake;
}

interface Outcome {
  readonly result: PreflightResult;
  readonly events: PreflightEvent[];
}

async function preflight(
  fake: FakeSsh,
  input: SshPreflightInput,
  overrides: Partial<SshPreflightDeps> = {},
): Promise<Outcome> {
  const events: PreflightEvent[] = [];
  const result = await runSshPreflight(
    input,
    {
      home: fake.home,
      clock: realClock(),
      sshPath: fake.sshPath,
      keyscanPath: fake.keyscanPath,
      keygenPath: fake.keygenPath,
      ...overrides,
    },
    (event) => {
      events.push(event);
    },
  );
  return { result, events };
}

/** 단계와 상태와 코드만 남긴다. 값 비교용 */
function summary(events: readonly PreflightEvent[]): string[] {
  return events.map((event) => `${event.step}:${event.status}:${event.code}`);
}

const knownHostsOf = (fake: FakeSsh): string => join(fake.home, ".ssh", "known_hosts");

describe("runSshPreflight: success", () => {
  test("a reachable host with fresnel running passes every step; address and socket are values", async () => {
    const fake = fixture();
    const { result, events } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: true,
      address: `ssh://me@box.example${SOCKET}`,
      socket: SOCKET,
      remoteVersion: { cli: "0.4.0", contract: "0.1.0" },
      serviceVersion: "0.4.0",
    });
    expect(summary(events)).toEqual([
      "resolve:running:running",
      "resolve:pass:ok",
      "connect:running:running",
      "connect:pass:ok",
      "install:running:running",
      "install:pass:ok",
      "service:running:running",
      "service:pass:ok",
      "socket:running:running",
      "socket:pass:ok",
    ]);
    expect(events[1]?.detail).toEqual({
      hostname: "box.example",
      port: 22,
      proxyJump: false,
      user: "me",
    });
    expect(fake.calls()).toEqual([
      `ssh ${OPTS} -G -- me@box.example`,
      `ssh ${OPTS} -- me@box.example true`,
      `ssh ${OPTS} -- me@box.example fresnel version --json`,
      `ssh ${OPTS} -- me@box.example fresnel service status --json`,
    ]);
  });

  test("an explicit port goes in as -p before the --, and the address carries it", async () => {
    const fake = fixture();
    const { result } = await preflight(fake, { target: "me@box.example:2222", local: LOCAL });
    expect(result).toEqual({
      ok: true,
      address: `ssh://me@box.example:2222${SOCKET}`,
      socket: SOCKET,
      remoteVersion: { cli: "0.4.0", contract: "0.1.0" },
      serviceVersion: "0.4.0",
    });
    expect(fake.calls()[1]).toBe(`ssh ${OPTS} -p 2222 -- me@box.example true`);
  });

  test("a service that is not running is started by ensure and the pass says so", async () => {
    const fake = fixture();
    fake.reply("status", { out: '{"running":false,"reason":"no_registration"}\n' });
    fake.reply("ensure", {
      out: `{"ok":true,"socket":"${SOCKET}","version":"0.4.0","action":"spawned"}\n`,
    });
    const { result, events } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toMatchObject({ ok: true, socket: SOCKET, serviceVersion: "0.4.0" });
    expect(events.find((event) => event.step === "service" && event.status === "pass")).toEqual({
      step: "service",
      status: "pass",
      code: "ok",
      durationMs: expect.any(Number),
      actions: [],
      detail: { action: "started_service" },
    });
    expect(fake.calls()).toContain(`ssh ${OPTS} -- me@box.example fresnel service ensure --json`);
  });

  test("a remote CLI that differs only in cli version passes with cliDiffers", async () => {
    const fake = fixture();
    fake.reply("version", { out: '{"cli":"0.3.9","contract":"0.1.0","bun":"1.3.0"}\n' });
    const { result, events } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result.ok).toBe(true);
    expect(
      events.find((event) => event.step === "install" && event.status === "pass")?.detail,
    ).toEqual({
      cliDiffers: true,
    });
  });
});

describe("runSshPreflight: host keys", () => {
  test("a new host key stops at action with the fingerprint; nothing is written to known_hosts", async () => {
    const fake = fixture();
    fake.reply("keyscan", { out: `${KEY_A}\n` });
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 1);
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "action",
      code: "host_key_new",
      actions: ["trust_host_key"],
      detail: {
        hostKey: {
          fingerprint: "SHA256:AAAAFAKEKEY1",
          keyType: "ED25519",
          hostname: "box.example",
          port: 22,
          scanned: [KEY_A],
        },
      },
    });
    expect(existsSync(knownHostsOf(fake))).toBe(false);
  });

  test("trusting the shown fingerprint adds that line, sets 0600 and 0700, and retries to a pass", async () => {
    const fake = fixture();
    fake.reply("keyscan", { out: `${KEY_A}\n` });
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 1);
    await preflight(fake, { target: "me@box.example", local: LOCAL });
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 2);
    const { result, events } = await preflight(fake, {
      target: "me@box.example",
      local: LOCAL,
      trustHostKey: { fingerprint: "SHA256:AAAAFAKEKEY1" },
    });
    expect(result.ok).toBe(true);
    expect(summary(events).slice(2, 4)).toEqual(["connect:running:running", "connect:pass:ok"]);
    expect(readFileSync(knownHostsOf(fake), "utf8")).toBe(`${KEY_A}\n`);
    expect(statSync(knownHostsOf(fake)).mode & 0o777).toBe(0o600);
    expect(statSync(join(fake.home, ".ssh")).mode & 0o777).toBe(0o700);
  });

  test("a keyscan that now shows a different key fails with host_key_mismatch_scan and writes nothing", async () => {
    const fake = fixture();
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 1);
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 2);
    fake.reply("keyscan", { out: `${KEY_A}\n` }, 1);
    fake.reply("keyscan", { out: `${KEY_B}\n` }, 2);
    await preflight(fake, { target: "me@box.example", local: LOCAL });
    const { result } = await preflight(fake, {
      target: "me@box.example",
      local: LOCAL,
      trustHostKey: { fingerprint: "SHA256:AAAAFAKEKEY1" },
    });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "host_key_mismatch_scan",
      actions: ["retry"],
    });
    expect(existsSync(knownHostsOf(fake))).toBe(false);
  });

  test("a changed key without permission fails with replace_host_key and the new fingerprint; ssh-keygen -R is not run", async () => {
    const fake = fixture();
    mkdirSync(join(fake.home, ".ssh"));
    writeFileSync(knownHostsOf(fake), "box.example ssh-ed25519 OLDKEY\n");
    fake.reply("keyscan", { out: `${KEY_A}\n` });
    fake.reply("connect", { code: 255, err: CHANGED_ERR }, 1);
    const { result, events } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "host_key_changed",
      actions: ["replace_host_key"],
      detail: {
        hostKey: {
          fingerprint: "SHA256:AAAAFAKEKEY1",
          keyType: "ED25519",
          hostname: "box.example",
          port: 22,
          scanned: [KEY_A],
        },
      },
    });
    expect(summary(events).at(-1)).toBe("connect:fail:host_key_changed");
    expect(fake.calls().some((line) => line.startsWith("ssh-keygen -R"))).toBe(false);
  });

  test("a changed key with replace and trust removes the old line with ssh-keygen -R, adds the new line, and passes", async () => {
    const fake = fixture();
    mkdirSync(join(fake.home, ".ssh"));
    writeFileSync(knownHostsOf(fake), "box.example ssh-ed25519 OLDKEY\n");
    fake.reply("keyscan", { out: `${KEY_A}\n` });
    fake.reply("connect", { code: 255, err: CHANGED_ERR }, 1);
    fake.reply("connect", { code: 255, err: CHANGED_ERR }, 2);
    await preflight(fake, { target: "me@box.example", local: LOCAL });
    const { result } = await preflight(fake, {
      target: "me@box.example",
      local: LOCAL,
      trustHostKey: { fingerprint: "SHA256:AAAAFAKEKEY1" },
      replaceChangedHostKey: true,
    });
    expect(result.ok).toBe(true);
    expect(fake.calls()).toContain(`ssh-keygen -R box.example -f ${knownHostsOf(fake)}`);
    const lines = readFileSync(knownHostsOf(fake), "utf8").split("\n");
    expect(lines.filter((line) => line === KEY_A)).toHaveLength(1);
  });

  test("a jump host with a new key fails with host_key_proxy and a copyable ssh line; no keyscan runs", async () => {
    const fake = fixture();
    fake.reply("resolve", {
      out: "hostname box.example\nport 22\nuser me\nproxyjump bastion\nproxycommand none\n",
    });
    fake.reply("connect", { code: 255, err: NEW_KEY_ERR }, 1);
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "host_key_proxy",
      actions: ["copy_command", "retry"],
      fix: { commands: ["ssh me@box.example"], hint: "run_once_in_terminal" },
    });
    expect(fake.calls().some((line) => line.startsWith("ssh-keyscan"))).toBe(false);
  });
});

describe("runSshPreflight: ssh failures", () => {
  test("a password-only server gets a copyable ssh-copy-id line, with the port when one was given", async () => {
    const fake = fixture();
    const denied = "me@box.example: Permission denied (publickey,password).\n";
    fake.reply("connect", { code: 255, err: denied }, 1);
    fake.reply("connect", { code: 255, err: denied }, 2);
    const plain = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(plain.result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "auth_password_only",
      actions: ["copy_command", "retry"],
      fix: { commands: ["ssh-copy-id me@box.example"] },
    });
    const ported = await preflight(fake, { target: "me@box.example:2222", local: LOCAL });
    expect(ported.result).toMatchObject({
      code: "auth_password_only",
      fix: { commands: ["ssh-copy-id -p 2222 me@box.example"] },
    });
  });

  test("a publickey-only refusal is auth_denied with no fix", async () => {
    const fake = fixture();
    fake.reply(
      "connect",
      { code: 255, err: "me@box.example: Permission denied (publickey).\n" },
      1,
    );
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "auth_denied",
      actions: ["retry"],
    });
  });

  test("dns, refused and timed-out connects are classified from the ssh stderr", async () => {
    const fake = fixture();
    fake.reply(
      "connect",
      {
        code: 255,
        err: "ssh: Could not resolve hostname nohost.example: nodename nor servname provided, or not known\n",
      },
      1,
    );
    fake.reply(
      "connect",
      { code: 255, err: "ssh: connect to host box.example port 22: Connection refused\n" },
      2,
    );
    fake.reply(
      "connect",
      { code: 255, err: "ssh: connect to host box.example port 22: Operation timed out\n" },
      3,
    );
    const first = await preflight(fake, { target: "me@box.example", local: LOCAL });
    const second = await preflight(fake, { target: "me@box.example", local: LOCAL });
    const third = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect([first, second, third].map((run) => (run.result.ok ? "pass" : run.result.code))).toEqual(
      ["dns", "refused", "timeout"],
    );
  });

  test("an unknown ssh failure keeps the first stderr line, cut to 200 characters", async () => {
    const fake = fixture();
    const long = `Bad thing ${"x".repeat(300)}`;
    fake.reply("connect", { code: 255, err: `${long}\nsecond line\n` }, 1);
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "connect",
      status: "fail",
      code: "unknown",
      actions: ["retry"],
      detail: { stderr: long.slice(0, 200) },
    });
  });

  test("a missing ssh executable is ssh_missing at resolve and again at connect", async () => {
    const fake = fixture();
    const { result, events } = await preflight(
      fake,
      { target: "me@box.example", local: LOCAL },
      { sshPath: "/nonexistent/fresnel-ssh" },
    );
    expect(result).toMatchObject({ ok: false, step: "connect", code: "ssh_missing" });
    expect(summary(events)).toEqual([
      "resolve:running:running",
      "resolve:fail:ssh_missing",
      "connect:running:running",
      "connect:fail:ssh_missing",
    ]);
  });

  test("a timed-out run (from the exec port) is timeout", async () => {
    const fake = fixture();
    const { result } = await preflight(
      fake,
      { target: "me@box.example", local: LOCAL },
      { exec: stalledExec },
    );
    expect(result).toMatchObject({ ok: false, step: "connect", code: "timeout" });
  });
});

/** 시한을 넘긴 실행을 흉내 낸다 */
const stalledExec: ExecFn = () =>
  Promise.resolve({
    code: null,
    signal: "SIGKILL",
    stdout: "",
    stderr: "",
    spawnError: null,
    timedOut: true,
  });

describe("runSshPreflight: remote steps", () => {
  test("a remote without fresnel on the non-interactive PATH is not_installed with no install path", async () => {
    const fake = fixture();
    fake.reply("version", { code: 127, err: "bash: fresnel: command not found\n" });
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "install",
      status: "fail",
      code: "not_installed",
      actions: ["retry"],
      fix: { commands: [], installPath: null, hint: "path_noninteractive" },
    });
  });

  test("version JSON that does not parse is version_unreadable", async () => {
    const fake = fixture();
    fake.reply("version", { out: "not json\n" });
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toMatchObject({ ok: false, step: "install", code: "version_unreadable" });
  });

  test("a contract mismatch names the lower side: local, remote, and numeric order (0.9.0 < 0.10.0)", async () => {
    const fake = fixture();
    fake.reply("version", { out: '{"cli":"0.4.0","contract":"0.2.0","bun":"1.3.0"}\n' });
    const localLower = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(localLower.result).toEqual({
      ok: false,
      step: "install",
      status: "fail",
      code: "version_mismatch",
      actions: ["upgrade_local"],
      fix: { commands: [], hint: "upgrade_local" },
      detail: { local: "0.1.0", remote: "0.2.0", lower: "local" },
    });
    fake.reply("version", { out: '{"cli":"0.4.0","contract":"0.0.9","bun":"1.3.0"}\n' });
    const remoteLower = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(remoteLower.result).toEqual({
      ok: false,
      step: "install",
      status: "fail",
      code: "version_mismatch",
      actions: ["upgrade_remote"],
      fix: { commands: [], hint: "upgrade_remote" },
      detail: { local: "0.1.0", remote: "0.0.9", lower: "remote" },
    });
    fake.reply("version", { out: '{"cli":"0.4.0","contract":"0.10.0","bun":"1.3.0"}\n' });
    const numeric = await preflight(fake, {
      target: "me@box.example",
      local: { cli: "0.4.0", contract: "0.9.0" },
    });
    expect(numeric.result).toMatchObject({ code: "version_mismatch", detail: { lower: "local" } });
  });

  test("status JSON that fails to parse is service_status_unreadable", async () => {
    const fake = fixture();
    fake.reply("status", { out: "garbage\n" });
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toMatchObject({ ok: false, step: "service", code: "service_status_unreadable" });
  });

  test("a failed ensure is service_start_failed with the reason", async () => {
    const fake = fixture();
    fake.reply("status", { out: '{"running":false,"reason":"no_registration"}\n' });
    fake.reply("ensure", { out: '{"ok":false,"reason":"unreachable"}\n', code: 1 });
    const { result } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "service",
      status: "fail",
      code: "service_start_failed",
      actions: ["retry"],
      detail: { reason: "unreachable" },
    });
  });

  test("a status with no socket is socket_unreadable at the socket step", async () => {
    const fake = fixture();
    fake.reply("status", {
      out: '{"running":true,"registration":{"version":"0.4.0"}}\n',
    });
    const { result, events } = await preflight(fake, { target: "me@box.example", local: LOCAL });
    expect(result).toEqual({
      ok: false,
      step: "socket",
      status: "fail",
      code: "socket_unreadable",
      actions: ["retry"],
    });
    expect(summary(events).at(-1)).toBe("socket:fail:socket_unreadable");
  });
});

describe("runSshPreflight: observeOnly", () => {
  test("a service that is not running stops at service with service_not_running and never calls ensure", async () => {
    const fake = fixture();
    fake.reply("status", { out: '{"running":false,"reason":"no_registration"}\n' });
    const { result, events } = await preflight(fake, {
      target: "me@box.example",
      local: LOCAL,
      observeOnly: true,
    });
    expect(result).toEqual({
      ok: false,
      step: "service",
      status: "fail",
      code: "service_not_running",
      actions: [],
    });
    expect(summary(events).at(-1)).toBe("service:fail:service_not_running");
    expect(fake.calls()).toContain(`ssh ${OPTS} -- me@box.example fresnel service status --json`);
    expect(fake.calls().some((line) => line.includes("service ensure"))).toBe(false);
  });

  test("a running service passes the service step without ensure, and the address is still built", async () => {
    const fake = fixture();
    const { result, events } = await preflight(fake, {
      target: "me@box.example",
      local: LOCAL,
      observeOnly: true,
    });
    expect(result).toMatchObject({ ok: true, socket: SOCKET, serviceVersion: "0.4.0" });
    expect(summary(events)).toContain("service:pass:ok");
    expect(fake.calls().some((line) => line.includes("service ensure"))).toBe(false);
  });
});

describe("runSshPreflight: target validation", () => {
  test("bad targets fail at resolve before any ssh call; the code says which kind of bad", async () => {
    const cases: [string, PreflightCode][] = [
      ["-oProxyCommand=x", "invalid_target"],
      ["me @box.example", "invalid_target"],
      ["box.example\u0001", "invalid_target"],
      ["[::1]:22", "invalid_target"],
      ["me@box%x", "invalid_target"],
      ["", "invalid_target"],
      ["box.example:0", "invalid_port"],
      ["box.example:70000", "invalid_port"],
    ];
    const runs = await Promise.all(
      cases.map(async ([target, code]) => {
        const fake = fixture();
        const outcome = await preflight(fake, { target, local: LOCAL });
        return { code, fake, outcome };
      }),
    );
    for (const { code, fake, outcome } of runs) {
      expect(outcome.result).toEqual({
        ok: false,
        step: "resolve",
        status: "fail",
        code,
        actions: [],
      });
      expect(summary(outcome.events)).toEqual(["resolve:running:running", `resolve:fail:${code}`]);
      expect(fake.calls()).toEqual([]);
    }
  });
});

describe("parseSshTarget", () => {
  test("splits user, host and port; rejects IPv6 brackets, option-like and shell-like text, bad ports", () => {
    expect(parseSshTarget("me@box.example:2222")).toEqual({
      ok: true,
      value: { target: "me@box.example", port: 2222 },
    });
    expect(parseSshTarget("  box  ")).toEqual({ ok: true, value: { target: "box", port: null } });
    expect(parseSshTarget("me@box.example:1").ok).toBe(true);
    expect(parseSshTarget("[::1]:22")).toEqual({ ok: false, error: { kind: "invalid_target" } });
    expect(parseSshTarget("::1:22")).toEqual({ ok: false, error: { kind: "invalid_target" } });
    expect(parseSshTarget("-box")).toEqual({ ok: false, error: { kind: "invalid_target" } });
    expect(parseSshTarget("me@-box").ok).toBe(false);
    expect(parseSshTarget("a@b@c")).toEqual({ ok: false, error: { kind: "invalid_target" } });
    expect(parseSshTarget("box;reboot")).toEqual({ ok: false, error: { kind: "invalid_target" } });
    expect(parseSshTarget("box:0")).toEqual({ ok: false, error: { kind: "invalid_port" } });
    expect(parseSshTarget("box:65536")).toEqual({ ok: false, error: { kind: "invalid_port" } });
    expect(parseSshTarget("   ")).toEqual({ ok: false, error: { kind: "empty" } });
  });
});

describe("spawnExec", () => {
  const short = { timeoutMs: 5000 };

  test("returns the exit code and the captured stdout and stderr", async () => {
    expect(await spawnExec("/bin/sh", ["-c", "printf hi; printf oops >&2; exit 3"], short)).toEqual(
      {
        code: 3,
        signal: null,
        stdout: "hi",
        stderr: "oops",
        spawnError: null,
        timedOut: false,
      },
    );
  });

  test("passes stdin when given", async () => {
    expect(await spawnExec("/bin/cat", [], { ...short, stdin: "hello\n" })).toMatchObject({
      code: 0,
      stdout: "hello\n",
    });
  });

  test("a missing executable is spawnError ENOENT with no exit code", async () => {
    expect(await spawnExec("/nonexistent/fresnel-tool", [], short)).toEqual({
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      spawnError: "ENOENT",
      timedOut: false,
    });
  });

  test("a run past its time limit is killed and reported as timedOut", async () => {
    const result = await spawnExec("/bin/sh", ["-c", "exec sleep 5"], { timeoutMs: 200 });
    expect(result).toMatchObject({
      code: null,
      signal: "SIGKILL",
      timedOut: true,
      spawnError: null,
    });
  });

  test("stdout is cut at 64KB", async () => {
    const result = await spawnExec("/bin/sh", ["-c", "head -c 100000 /dev/zero"], short);
    expect(Buffer.byteLength(result.stdout)).toBe(64 * 1024);
  });
});

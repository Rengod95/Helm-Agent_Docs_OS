import { describe, expect, test } from "bun:test";
import { createDesktopIpc, type DesktopIpc, type PreflightEvent } from "../../src/transport/ipc.ts";
import { createElectronBridge, type FresnelShellApi } from "../../src/shell/electron-bridge.ts";
import { rawShellIpc } from "./shell-mock.ts";

// 원격 붙기 명령의 답과 단계 채널을 셸이 보낸 모양 그대로 읽는다(TY-10). 모르는 필드는 거절하지 않고, 모양이 맞지 않는
// 답은 `invalid`다. 채널 메시지는 `{type: "step", event}`만 단계 이벤트로 받는다.

const STEP: PreflightEvent = {
  step: "connect",
  status: "pass",
  code: "ok",
  durationMs: 31,
  actions: [],
};

const STOPPED_AT_RESOLVE = {
  ok: false,
  step: "resolve",
  status: "fail",
  code: "ssh_missing",
  actions: ["retry"],
};

/** 채널을 열어 두고, 명령이 불릴 때 `messages`를 그 채널로 흘린 뒤 `reply`를 돌려주는 셸 대역 */
function preflightShell(messages: readonly unknown[], reply: unknown): DesktopIpc {
  let sink: ((message: unknown) => void) | undefined;
  const api: FresnelShellApi = {
    invoke: (command) => {
      if (command === "ssh_preflight") {
        for (const message of messages) sink?.(message);
      }
      return Promise.resolve(reply);
    },
    openChannel: (onMessage) => {
      sink = onMessage;
      return { $channel: 1 };
    },
    closeChannel: () => {},
    listen: () => () => {},
  };
  return createDesktopIpc(createElectronBridge(api));
}

describe("ssh_preflight: the step events come through the channel", () => {
  test("only the messages that read as step events reach the caller", async () => {
    const seen: PreflightEvent[] = [];
    const ipc = preflightShell(
      [
        { type: "step", event: STEP },
        { type: "step", event: { step: "unknown_step", status: "pass" } },
        { type: "other", event: STEP },
        "not an object",
      ],
      STOPPED_AT_RESOLVE,
    );
    const outcome = await ipc.sshPreflight({ target: "me@build" }, (event) => {
      seen.push(event);
    });
    expect(seen.map((event) => event.step)).toEqual(["connect"]);
    expect(outcome.ok && outcome.value.ok).toBe(false);
  });

  test("a reply that does not read as an outcome is invalid", async () => {
    const ipc = preflightShell([], { ok: "yes" });
    expect(await ipc.sshPreflight({ target: "me@build" }, () => {})).toEqual({
      ok: false,
      error: { kind: "invalid", command: "ssh_preflight" },
    });
  });

  test("a success reply carries the address, the socket and the versions", async () => {
    const ipc = preflightShell([], {
      ok: true,
      address: "ssh://me@build/run/fresnel/service.sock",
      socket: "/run/fresnel/service.sock",
      remoteVersion: { cli: "1.2.3", contract: "0.4.0" },
      serviceVersion: "1.2.3",
      tunnelMs: 88,
    });
    const outcome = await ipc.sshPreflight({ target: "me@build" }, () => {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.ok) return;
    expect(outcome.value.address).toBe("ssh://me@build/run/fresnel/service.sock");
    expect(outcome.value.remoteVersion.contract).toBe("0.4.0");
    expect(outcome.value.tunnelMs).toBe(88);
  });
});

describe("the other remote commands read their replies", () => {
  test("ssh_hosts reads the list and does not reject fields it does not need", async () => {
    const ipc = rawShellIpc((command) =>
      command === "ssh_hosts"
        ? {
            hosts: [
              {
                name: "build",
                hostName: "build.local",
                user: null,
                port: 2222,
                proxyJump: false,
                identityFile: "~/.ssh/id",
              },
            ],
            unreadable: null,
          }
        : undefined,
    );
    const read = await ipc.sshHosts();
    expect(read.ok && read.value.hosts[0]?.port).toBe(2222);
    expect(read.ok && read.value.unreadable).toBeNull();
  });

  test("ssh_hosts with the wrong shape is invalid", async () => {
    const ipc = rawShellIpc(() => ({ hosts: "none", unreadable: null }));
    expect(await ipc.sshHosts()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "ssh_hosts" },
    });
  });

  test("remote_test reads a failure with its code and time", async () => {
    const ipc = rawShellIpc((command) =>
      command === "remote_test"
        ? { ok: false, code: "hello_failed", durationMs: 90, detail: { reason: "timeout" } }
        : undefined,
    );
    expect(await ipc.remoteTest("wss://gw.local:7421")).toEqual({
      ok: true,
      value: { ok: false, code: "hello_failed", durationMs: 90, detail: { reason: "timeout" } },
    });
  });

  test("remote_fingerprint reads a fingerprint or a probe code", async () => {
    const found = rawShellIpc((command) =>
      command === "remote_fingerprint" ? { ok: true, fingerprint: "ab:cd" } : undefined,
    );
    expect(await found.remoteFingerprint("gw.local", 7421)).toEqual({
      ok: true,
      value: { ok: true, fingerprint: "ab:cd" },
    });
    const refused = rawShellIpc((command) =>
      command === "remote_fingerprint" ? { ok: false, code: "refused" } : undefined,
    );
    expect(await refused.remoteFingerprint("gw.local", 7421)).toEqual({
      ok: true,
      value: { ok: false, code: "refused" },
    });
  });

  test("remote_pair reads the device name, or the code and the wait, and never a token", async () => {
    const granted = rawShellIpc((command) =>
      command === "remote_pair" ? { ok: true, deviceName: "laptop" } : undefined,
    );
    expect(
      await granted.remotePair({
        host: "gw.local",
        port: 7421,
        pin: "ab".repeat(32),
        code: "123456",
        deviceName: "laptop",
      }),
    ).toEqual({ ok: true, value: { ok: true, deviceName: "laptop" } });
    const locked = rawShellIpc((command) =>
      command === "remote_pair" ? { ok: false, code: "locked", retryAfterSeconds: 30 } : undefined,
    );
    expect(
      await locked.remotePair({
        host: "gw.local",
        port: 7421,
        pin: "ab".repeat(32),
        code: "123456",
        deviceName: "laptop",
      }),
    ).toEqual({ ok: true, value: { ok: false, code: "locked", retryAfterSeconds: 30 } });
  });

  test("ssh_service_alive needs the alive flag; a missing one is invalid", async () => {
    const alive = rawShellIpc((command) =>
      command === "ssh_service_alive" ? { alive: true, version: "1.2.3", code: "ok" } : undefined,
    );
    expect(await alive.sshServiceAlive("me@build")).toEqual({
      ok: true,
      value: { alive: true, version: "1.2.3", code: "ok" },
    });
    const broken = rawShellIpc(() => ({ version: "1.2.3", code: "ok" }));
    expect(await broken.sshServiceAlive("me@build")).toEqual({
      ok: false,
      error: { kind: "invalid", command: "ssh_service_alive" },
    });
  });
});

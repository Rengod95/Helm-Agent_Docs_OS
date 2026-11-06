import { describe, expect, test } from "bun:test";
import { createElectronBridge, type FresnelShellApi } from "../../src/shell/electron-bridge.ts";
import { selectShellBridge } from "../../src/shell/index.ts";
import { createDesktopIpc } from "../../src/transport/ipc.ts";

type Call = { readonly command: string; readonly args: unknown };

/** preload의 window.fresnelShell 대역. 채널 번호는 1부터 붙는다 */
function fakeShell(reply: (command: string, args: unknown) => unknown): {
  readonly api: FresnelShellApi;
  readonly calls: Call[];
  readonly channels: Map<number, (message: unknown) => void>;
  readonly listeners: Map<string, () => void>;
} {
  const calls: Call[] = [];
  const channels = new Map<number, (message: unknown) => void>();
  const listeners = new Map<string, () => void>();
  const api: FresnelShellApi = {
    invoke: async (command, args) => {
      calls.push({ command, args });
      const value = reply(command, args);
      // oxlint-disable-next-line prefer-promise-reject-errors -- 셸 명령 오류는 Error가 아니라 문자열로 거부된다 (L4.desktop.design §15.1)
      if (value instanceof Error) return Promise.reject(value.message);
      return value;
    },
    openChannel: (onMessage) => {
      const id = channels.size + 1;
      channels.set(id, onMessage);
      return { $channel: id };
    },
    closeChannel: (id) => {
      channels.delete(id);
    },
    listen: (event, onEvent) => {
      listeners.set(event, onEvent);
      return () => {
        listeners.delete(event);
      };
    },
  };
  return { api, calls, channels, listeners };
}

describe("selectShellBridge", () => {
  test("picks Electron when the preload API exists and an unavailable bridge otherwise", () => {
    const shell = fakeShell(() => null);
    expect(selectShellBridge({ fresnelShell: shell.api }).kind).toBe("electron");
    expect(selectShellBridge({ fresnelShell: undefined }).kind).toBe("none");
  });
});

describe("Electron bridge", () => {
  test("sends a byte command as { body, headers } with the epoch header", async () => {
    const shell = fakeShell(() => null);
    const ipc = createDesktopIpc(createElectronBridge(shell.api));
    const result = await ipc.write(3, new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ ok: true, value: null });
    expect(shell.calls).toEqual([
      {
        command: "engine_write",
        args: { body: new Uint8Array([1, 2, 3]), headers: { "x-fresnel-epoch": "3" } },
      },
    ]);
  });

  test("attach passes two channels, delivers bytes and state, and parses the result", async () => {
    const shell = fakeShell(() => ({
      epoch: 2,
      state: { kind: "running", source: "sidecar", pid: 77 },
    }));
    const ipc = createDesktopIpc(createElectronBridge(shell.api));
    const bytes: number[][] = [];
    const states: string[] = [];
    const attached = await ipc.attach(
      (chunk) => bytes.push([...chunk]),
      (state) => states.push(state.kind),
    );
    expect(attached).toEqual({
      ok: true,
      value: { epoch: 2, state: { kind: "running", source: "sidecar", pid: 77 } },
    });
    expect(shell.calls[0]).toEqual({
      command: "engine_attach",
      args: { onBytes: { $channel: 1 }, onState: { $channel: 2 } },
    });
    shell.channels.get(1)?.(new Uint8Array([10, 11]));
    shell.channels.get(1)?.("not bytes");
    shell.channels.get(2)?.({ kind: "stopped" });
    shell.channels.get(2)?.({ kind: "nonsense" });
    expect(bytes).toEqual([[10, 11]]);
    expect(states).toEqual(["stopped"]);
  });

  test("a string rejection becomes the command code", async () => {
    const shell = fakeShell(() => new Error("stale-epoch"));
    const ipc = createDesktopIpc(createElectronBridge(shell.api));
    expect(await ipc.ack(1, 5)).toEqual({
      ok: false,
      error: { kind: "command", command: "engine_ack", code: "stale-epoch" },
    });
  });

  test("listen resolves to an unlisten function", async () => {
    const shell = fakeShell(() => null);
    const bridge = createElectronBridge(shell.api);
    const woken: string[] = [];
    const unlisten = await bridge.listen("shell-intent", () => woken.push("woke"));
    shell.listeners.get("shell-intent")?.();
    unlisten();
    expect(woken).toEqual(["woke"]);
    expect(shell.listeners.size).toBe(0);
  });
});

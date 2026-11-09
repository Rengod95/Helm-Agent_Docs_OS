import { describe, expect, test } from "bun:test";
import { MAX_SHELL_FRAME_CHARS } from "../../../src/web/session/protocol.ts";
import type { ShimSocket, SocketHandlers } from "../../../src/web/shim/env.ts";
import { createShim, OFFLINE_TEXT } from "../../../src/web/shim/shim.ts";
import { ownField } from "../../../src/web/shim/util.ts";
import {
  channelIdOf,
  fakeLocation,
  fakePage,
  liveEnv,
  manualTimers,
  replyError,
  replyOk,
  settled,
  shimEnv,
  startShellServer,
} from "./support.ts";

function last<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error("no items");
  return item;
}

function silentSocket(): ShimSocket {
  return {
    send: () => undefined,
    close: () => undefined,
  };
}

describe("shell transport", () => {
  test("invoke resolves with the reply value", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        replyOk(call, { echo: call.args });
      },
    });
    const api = createShim(liveEnv(server));
    expect(await api.invoke("echo", { n: 1 })).toEqual({ echo: { n: 1 } });
  });

  test("byte arguments and replies round-trip through $bytes", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        const body = ownField(call.args, "body");
        replyOk(call, { bytes: body, sawBytes: body instanceof Uint8Array });
      },
    });
    const api = createShim(liveEnv(server));
    const value = await api.invoke("upload", { body: new Uint8Array([0, 255, 7]) });
    expect(ownField(value, "sawBytes")).toBe(true);
    expect(ownField(value, "bytes")).toEqual(new Uint8Array([0, 255, 7]));
    expect(ownField(value, "bytes") instanceof Uint8Array).toBe(true);
  });

  test("channel messages reach the channel as Uint8Array", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        call.socket.send({
          t: "channel",
          id: channelIdOf(call.args),
          message: { chunk: new Uint8Array([1, 2]) },
        });
        replyOk(call, null);
      },
    });
    const api = createShim(liveEnv(server));
    const received: unknown[] = [];
    const channel = api.openChannel((message) => {
      received.push(message);
    });
    await api.invoke("watch", { ch: channel });
    expect(received.length).toBe(1);
    expect(ownField(received[0], "chunk")).toEqual(new Uint8Array([1, 2]));
    expect(ownField(received[0], "chunk") instanceof Uint8Array).toBe(true);
  });

  test("commands issued before the socket opens are queued and sent in order after it opens", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        replyOk(call, call.command);
      },
    });
    const api = createShim(liveEnv(server));
    const first = api.invoke("first");
    const second = api.invoke("second");
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(server.commands).toEqual(["first", "second"]);
  });

  test("error replies reject with the raw string or object value", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        if (call.command === "missing") {
          replyError(call, "not-found");
        } else {
          replyError(call, { kind: "denied" });
        }
      },
    });
    const api = createShim(liveEnv(server));
    expect(await settled(api.invoke("missing"))).toEqual({ ok: false, error: "not-found" });
    expect(await settled(api.invoke("forbidden"))).toEqual({
      ok: false,
      error: { kind: "denied" },
    });
  });

  test("a successful reply without a value resolves undefined, as a void desktop command does", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        call.socket.send({ t: "reply", id: call.id, ok: true });
      },
    });
    const api = createShim(liveEnv(server));
    expect(await api.invoke("void-command")).toBe(undefined);
  });

  test("a reply with the wrong shape rejects with invalid-reply", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        call.socket.send({ t: "reply", id: call.id, ok: "yes" });
      },
    });
    const api = createShim(liveEnv(server));
    expect(await settled(api.invoke("odd"))).toEqual({ ok: false, error: "invalid-reply" });
  });

  test("a request in flight when the socket drops rejects connection-lost, and the page reloads once after the reconnect", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        if (call.command === "drop") {
          call.socket.close(1011, "gone");
          return;
        }
        replyOk(call, "ok");
      },
    });
    const location = fakeLocation(`127.0.0.1:${server.port}`);
    const page = fakePage();
    const timers = manualTimers();
    const api = createShim(liveEnv(server, { location, page, timers }));
    expect(await api.invoke("first")).toBe("ok");
    expect(await settled(api.invoke("drop"))).toEqual({ ok: false, error: "connection-lost" });
    await timers.runNext();
    await location.reloaded;
    expect(location.reloads).toBe(1);
    expect(server.connections()).toBe(2);
    expect(timers.delays).toEqual([500]);
    expect(page.state.notices).toEqual([OFFLINE_TEXT]);
  });

  test("an auth close (4401) navigates to /login and does not reconnect", async () => {
    const server = startShellServer({
      onOpen: (socket) => {
        socket.close(4401, "auth");
      },
      onInvoke: () => undefined,
    });
    const location = fakeLocation(`127.0.0.1:${server.port}`);
    const timers = manualTimers();
    createShim(liveEnv(server, { location, timers }));
    expect(await location.navigated).toBe("/login");
    expect(location.assigned).toEqual(["/login"]);
    expect(timers.delays).toEqual([]);
    expect(location.reloads).toBe(0);
  });

  test("reconnect waits double from 500 ms up to 15 s, and an open resets the wait", async () => {
    const sockets: SocketHandlers[] = [];
    const timers = manualTimers();
    const location = fakeLocation("127.0.0.1:1");
    createShim(
      shimEnv({
        host: "127.0.0.1:1",
        location,
        timers,
        openSocket: (_url, handlers) => {
          sockets.push(handlers);
          return silentSocket();
        },
      }),
    );
    // 열리지 못한 연결이 여섯 번 끊기는 동안 기다림이 두 배씩 늘고 15 s에서 멈춘다
    const failAgain = async (remaining: number): Promise<void> => {
      if (remaining === 0) return;
      last(sockets).close(1006);
      await timers.runNext();
      return failAgain(remaining - 1);
    };
    await failAgain(6);
    expect(timers.delays).toEqual([500, 1000, 2000, 4000, 8000, 15000]);
    last(sockets).open();
    last(sockets).close(1006);
    await timers.runNext();
    expect(timers.delays.at(-1)).toBe(500);
    expect(location.reloads).toBe(0);
  });

  test("a 1008 close navigates to /login as well", async () => {
    const sockets: SocketHandlers[] = [];
    const location = fakeLocation("127.0.0.1:1");
    const timers = manualTimers();
    createShim(
      shimEnv({
        host: "127.0.0.1:1",
        location,
        timers,
        openSocket: (_url, handlers) => {
          sockets.push(handlers);
          return silentSocket();
        },
      }),
    );
    last(sockets).close(1008);
    expect(await location.navigated).toBe("/login");
    expect(timers.delays).toEqual([]);
  });

  test("event frames call the listeners until they unlisten", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        call.socket.send({ t: "event", name: "shell-intent" });
        replyOk(call, null);
      },
    });
    const api = createShim(liveEnv(server));
    let heard = 0;
    const stop = api.listen("shell-intent", () => {
      heard += 1;
    });
    await api.invoke("poke");
    expect(heard).toBe(1);
    stop();
    await api.invoke("poke");
    expect(heard).toBe(1);
  });

  test("a frame over the size limit is refused without being sent", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        replyOk(call, call.command);
      },
    });
    const api = createShim(liveEnv(server));
    const huge = "x".repeat(MAX_SHELL_FRAME_CHARS);
    expect(await settled(api.invoke("big", { text: huge }))).toEqual({
      ok: false,
      error: "too-large",
    });
    expect(await api.invoke("small")).toBe("small");
    expect(server.commands).toEqual(["small"]);
  });

  test("closeChannel drops the channel and tells the server", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        replyOk(call, call.command);
      },
    });
    const api = createShim(liveEnv(server));
    const channel = api.openChannel(() => undefined);
    const id = ownField(channel, "$channel");
    if (typeof id !== "number") throw new Error("no channel id");
    api.closeChannel(id);
    await api.invoke("ping");
    expect(server.channelCloses).toEqual([id]);
  });

  test("a frame that is not JSON reports shell-protocol and drops the connection", async () => {
    const server = startShellServer({
      onInvoke: (call) => {
        if (call.command === "garbage") {
          call.socket.raw("{not json");
          return;
        }
        replyOk(call, "ok");
      },
    });
    const page = fakePage();
    const timers = manualTimers();
    const api = createShim(liveEnv(server, { page, timers }));
    expect(await settled(api.invoke("garbage"))).toEqual({ ok: false, error: "connection-lost" });
    expect(page.state.reports).toEqual(["shell-protocol"]);
    expect(timers.delays).toEqual([500]);
  });
});

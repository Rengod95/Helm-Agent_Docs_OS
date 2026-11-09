import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import {
  cleanupTempDirs,
  type CloseInfo,
  deviceNamed,
  type Harness,
  jsonOf,
  openSocket,
  pairWeb,
  rawHttp,
  rawUpgrade,
  receivedBytes,
  settle,
  startHarness,
  type TestSocket,
} from "./support.ts";

const harnesses: Harness[] = [];

async function harness(options: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const started = await startHarness(options);
  harnesses.push(started);
  return started;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((item) => item.stop()));
  cleanupTempDirs();
});

function wsUrl(h: Harness, route: string): string {
  return `ws://127.0.0.1:${String(h.loopbackPort ?? 0)}${route}`;
}

function hostOf(h: Harness): string {
  return `127.0.0.1:${String(h.loopbackPort ?? 0)}`;
}

/** 데스크톱 기기 하나를 페어링하고 토큰을 받는다(`Authorization: Bearer`로 쓴다) */
async function desktopToken(h: Harness, name: string): Promise<string> {
  const issued = h.auth.createPairingCode();
  const res = await rawHttp({
    port: h.loopbackPort ?? 0,
    method: "POST",
    path: "/pair",
    headers: { host: hostOf(h), origin: h.origin },
    body: JSON.stringify({ code: issued.code, deviceName: name, kind: "desktop" }),
  });
  const body = jsonOf(res.body);
  if (
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
  ) {
    return body.token;
  }
  throw new Error(`no token for ${name}`);
}

function bytesOf(message: string | ArrayBuffer): Buffer {
  return typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
}

/** 메시지를 받을 때마다 다음 것을 기다린다(재귀로 쓴다: 순서대로 모은 조각들을 돌려준다) */
async function receiveAtLeast(
  socket: TestSocket,
  total: number,
  got: Buffer[] = [],
): Promise<Buffer[]> {
  const sum = got.reduce((size, piece) => size + piece.length, 0);
  if (sum >= total) return got;
  const piece = bytesOf(await socket.next());
  return receiveAtLeast(socket, total, [...got, piece]);
}

describe("upgrade gates: nothing is connected before the token and origin pass", () => {
  test("no token is 401 on /wire and the service socket is never opened", async () => {
    const h = await harness();
    const res = await rawUpgrade({
      port: h.loopbackPort ?? 0,
      path: "/wire",
      headers: { origin: h.origin, host: hostOf(h) },
    });
    expect(res.status).toBe(401);
    expect(jsonOf(res.body)).toEqual({ error: "unauthenticated" });
    await settle();
    expect(h.service.sides.length).toBe(0);
  });

  test("no token is 401 on /shell as well", async () => {
    const h = await harness();
    const res = await rawUpgrade({
      port: h.loopbackPort ?? 0,
      path: "/shell",
      headers: { origin: h.origin, host: hostOf(h) },
    });
    expect(res.status).toBe(401);
  });

  test("a wrong Origin is 403 and a missing Origin is 403, on both routes", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Origins");
    const attempts = ["/wire", "/shell"].flatMap((route) => [
      rawUpgrade({
        port: h.loopbackPort ?? 0,
        path: route,
        headers: {
          host: hostOf(h),
          origin: "http://evil.example.com",
          authorization: `Bearer ${token}`,
        },
      }),
      rawUpgrade({
        port: h.loopbackPort ?? 0,
        path: route,
        headers: { host: hostOf(h), authorization: `Bearer ${token}` },
      }),
    ]);
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
    }
    await settle();
    expect(h.service.sides.length).toBe(0);
  });

  test("a Host outside the listener's names is 421", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Hosts");
    const res = await rawUpgrade({
      port: h.loopbackPort ?? 0,
      path: "/wire",
      headers: { host: "evil.example.com", origin: h.origin, authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(421);
  });

  test("a revoked token is 401", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Gone");
    const revoked = h.auth.revokeDevice(paired.deviceId);
    expect(revoked.ok).toBe(true);
    const res = await rawUpgrade({
      port: h.loopbackPort ?? 0,
      path: "/shell",
      headers: { host: hostOf(h), origin: h.origin, cookie: paired.cookie },
    });
    expect(res.status).toBe(401);
    expect(h.sessions.length).toBe(0);
  });
});

describe("/wire relays bytes in both directions", () => {
  test("a desktop Bearer upgrade opens one service connection and carries bytes as-is", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Desktop");
    const socket = await openSocket(wsUrl(h, "/wire"), {
      origin: h.origin,
      authorization: `Bearer ${token}`,
    });
    await settle();
    expect(h.service.sides.length).toBe(1);
    const side = h.service.sides[0];
    if (side === undefined) throw new Error("no service side");

    socket.ws.send(new Uint8Array([1, 2, 3]));
    socket.ws.send('{"jsonrpc":"2.0"}\n');
    await settle();
    expect(
      receivedBytes(side).equals(
        Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from('{"jsonrpc":"2.0"}\n')]),
      ),
    ).toBe(true);

    side.socket.write(Buffer.from([9, 8, 7]));
    expect(bytesOf(await socket.next()).equals(Buffer.from([9, 8, 7]))).toBe(true);
    socket.ws.close(1000);
    await socket.closed;
  });

  test("a large service reply arrives complete and byte-equal", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Large");
    const socket = await openSocket(wsUrl(h, "/wire"), {
      origin: h.origin,
      authorization: `Bearer ${token}`,
    });
    await settle();
    const side = h.service.sides[0];
    if (side === undefined) throw new Error("no service side");
    const payload = randomBytes(300 * 1024);
    side.socket.write(payload);
    const got = await receiveAtLeast(socket, payload.length);
    expect(Buffer.concat(got).equals(payload)).toBe(true);
    socket.ws.close(1000);
    await socket.closed;
  });

  test("a message over one frame plus its newline closes with 1009", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Huge");
    const socket = await openSocket(wsUrl(h, "/wire"), {
      origin: h.origin,
      authorization: `Bearer ${token}`,
    });
    socket.ws.send(new Uint8Array(1_048_576 + 2));
    const closed: CloseInfo = await socket.closed;
    expect(closed.code).toBe(1009);
  });

  test("a closed service connection closes the browser side with 1011", async () => {
    const h = await harness();
    const token = await desktopToken(h, "ServiceGone");
    const socket = await openSocket(wsUrl(h, "/wire"), {
      origin: h.origin,
      authorization: `Bearer ${token}`,
    });
    await settle();
    const side = h.service.sides[0];
    if (side === undefined) throw new Error("no service side");
    side.socket.destroy();
    expect(await socket.closed).toEqual({ code: 1011, reason: "service_closed" });
    await side.closed;
  });

  test("with the service down the connection closes with 1011 service_unavailable", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Down");
    await h.service.close();
    const socket = await openSocket(wsUrl(h, "/wire"), {
      origin: h.origin,
      authorization: `Bearer ${token}`,
    });
    expect(await socket.closed).toEqual({ code: 1011, reason: "service_unavailable" });
  });

  test("the service reply is delayed by backpressure and still arrives intact after the reader resumes", async () => {
    const h = await harness();
    const token = await desktopToken(h, "Backpressure");
    const side = await rawWireConnect(h, token);
    await settle();
    const serviceSide = h.service.sides[0];
    if (serviceSide === undefined) throw new Error("no service side");
    const total = 12 * 1024 * 1024;
    const payload = randomBytes(total);
    serviceSide.socket.write(payload);
    // 읽기를 멈춘다: 게이트웨이 송신 버퍼가 차면 서비스 읽기도 멈춰야 한다
    side.socket.pause();
    await settle(300);
    side.socket.resume();
    const received = await readFrames(side, total);
    expect(received.length).toBe(total);
    expect(received.equals(payload)).toBe(true);
    side.socket.destroy();
  });
});

/* ---------- /shell ---------- */

describe("/shell carries frames to and from the tab session", () => {
  test("a cookie upgrade opens a session for the device and frames flow both ways", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Shell");
    const socket = await openSocket(wsUrl(h, "/shell"), {
      origin: h.origin,
      cookie: paired.cookie,
    });
    expect(h.sessions.length).toBe(1);
    const record = h.sessions[0];
    if (record === undefined) throw new Error("no session");
    expect(record.input.deviceId).toBe(paired.deviceId);
    expect(record.input.deviceName).toBe("Shell");

    socket.ws.send('{"t":"close-channel","id":1}');
    await settle();
    expect(record.received).toEqual(['{"t":"close-channel","id":1}']);

    record.input.send('{"t":"reply","id":1,"ok":true,"value":null}');
    expect(await socket.next()).toBe('{"t":"reply","id":1,"ok":true,"value":null}');
    socket.ws.close(1000);
    await socket.closed;
    await settle();
    expect(record.closeCalls).toBe(1);
  });

  test("a binary frame closes the socket with 1003", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Binary");
    const socket = await openSocket(wsUrl(h, "/shell"), {
      origin: h.origin,
      cookie: paired.cookie,
    });
    socket.ws.send(new Uint8Array([1, 2]));
    expect((await socket.closed).code).toBe(1003);
    await settle();
    expect(h.sessions[0]?.closeCalls).toBe(1);
  });

  test("a session that asks to close the connection closes it with its code", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Protocol");
    const socket = await openSocket(wsUrl(h, "/shell"), {
      origin: h.origin,
      cookie: paired.cookie,
    });
    h.sessions[0]?.input.closeConnection(4000, "protocol_error");
    expect(await socket.closed).toEqual({ code: 4000, reason: "protocol_error" });
  });
});

/* ---------- 폐기와 종료 ---------- */

describe("revocation and shutdown close the open sockets", () => {
  test("revoking a device closes its /wire and /shell with 4401 and closes the service side", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Revoked");
    const shell = await openSocket(wsUrl(h, "/shell"), { origin: h.origin, cookie: paired.cookie });
    const wire = await openSocket(wsUrl(h, "/wire"), { origin: h.origin, cookie: paired.cookie });
    await settle();
    const side = h.service.sides[0];
    if (side === undefined) throw new Error("no service side");

    const revoked = h.auth.revokeDevice(paired.deviceId);
    expect(revoked.ok).toBe(true);

    expect(await wire.closed).toEqual({ code: 4401, reason: "auth" });
    expect(await shell.closed).toEqual({ code: 4401, reason: "auth" });
    await side.closed;
    await settle();
    expect(h.sessions[0]?.closeCalls).toBe(1);
    expect(deviceNamed(h, "Revoked")).toBeUndefined();

    const again = await rawUpgrade({
      port: h.loopbackPort ?? 0,
      path: "/wire",
      headers: { host: hostOf(h), origin: h.origin, cookie: paired.cookie },
    });
    expect(again.status).toBe(401);
  });

  test("revoking one device leaves another device's sockets open", async () => {
    const h = await harness();
    const first = await pairWeb(h, h.origin, "First");
    const second = await pairWeb(h, h.origin, "Second");
    const kept = await openSocket(wsUrl(h, "/shell"), { origin: h.origin, cookie: second.cookie });
    const dropped = await openSocket(wsUrl(h, "/shell"), {
      origin: h.origin,
      cookie: first.cookie,
    });
    h.auth.revokeDevice(first.deviceId);
    expect(await dropped.closed).toEqual({ code: 4401, reason: "auth" });
    kept.ws.send("still here");
    await settle();
    expect(h.sessions.find((item) => item.input.deviceId === second.deviceId)?.received).toEqual([
      "still here",
    ]);
  });

  test("stopping the gateway closes the open sockets with 1001", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Stopping");
    const shell = await openSocket(wsUrl(h, "/shell"), { origin: h.origin, cookie: paired.cookie });
    await h.gateway.stop();
    expect(await shell.closed).toEqual({ code: 1001, reason: "gateway_stopped" });
  });

  test("closing a device with no open sockets does nothing", async () => {
    const h = await harness();
    expect(() => {
      h.gateway.closeDevice("dev_0000000000000000", "revoked");
    }).not.toThrow();
  });
});

/* ---------- 원시 소켓으로 읽기를 멈추는 시험 ---------- */

interface RawConnection {
  readonly socket: Socket;
  /** 핸드셰이크 뒤 남은 바이트(프레임) */
  readonly leftover: Buffer;
}

/** `/wire`에 원시 소켓으로 업그레이드한다(읽기를 직접 멈출 수 있게) */
function rawWireConnect(h: Harness, token: string): Promise<RawConnection> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: h.loopbackPort ?? 0 });
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(
        [
          "GET /wire HTTP/1.1",
          `Host: ${hostOf(h)}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          `Origin: ${h.origin}`,
          `Authorization: Bearer ${token}`,
          "",
          "",
        ].join("\r\n"),
      );
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.off("data", onData);
        const status = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
        if (!status.includes("101")) {
          reject(new Error(`upgrade refused: ${status}`));
          return;
        }
        // 핸드셰이크 뒤의 바이트는 프레임이다. 되돌려 준다
        resolve({ socket, leftover: head.subarray(end + 4) });
      };
      socket.on("data", onData);
    });
  });
}

/** 서버 프레임(마스크 없음)을 읽어 페이로드를 `total` 바이트까지 모은다 */
function readFrames(connection: RawConnection, total: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const payloads: Buffer[] = [];
    let raw = connection.leftover;
    let collected = 0;
    const drain = (): void => {
      for (;;) {
        const frame = frameAt(raw);
        if (frame === null) break;
        payloads.push(frame.body);
        collected += frame.body.length;
        raw = raw.subarray(frame.next);
      }
      if (collected >= total) {
        connection.socket.off("data", onData);
        resolve(Buffer.concat(payloads));
      }
    };
    const onData = (chunk: Buffer): void => {
      raw = Buffer.concat([raw, chunk]);
      drain();
    };
    connection.socket.on("data", onData);
    drain();
  });
}

interface Frame {
  readonly body: Buffer;
  readonly next: number;
}

function frameAt(raw: Buffer): Frame | null {
  if (raw.length < 2) return null;
  const short = (raw[1] ?? 0) & 0x7f;
  let headerLength = 2;
  let length = short;
  if (short === 126) {
    if (raw.length < 4) return null;
    length = raw.readUInt16BE(2);
    headerLength = 4;
  } else if (short === 127) {
    if (raw.length < 10) return null;
    length = Number(raw.readBigUInt64BE(2));
    headerLength = 10;
  }
  const end = headerLength + length;
  if (raw.length < end) return null;
  return { body: raw.subarray(headerLength, end), next: end };
}

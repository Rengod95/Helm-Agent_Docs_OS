import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import { WireError, type JsonRpcMessage, type Transport } from "@fresnel/contracts/wire";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { sampleMeta } from "../fixtures/fake-secrets.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// F.wire-settings.spec §3.3.1 secret.beginEntry·beginReveal의 `channel`(로컬 일회용 채널, secrets/channel.ts).
// CLI 쪽은 실제 유닉스 소켓으로 흉내 낸다: 0700 폴더에 소켓을 열고, 입력은 한 번 연결되면 값을 쓰고 닫고,
// 열람은 연결된 쪽이 쓴 바이트를 모은다. 값은 wire 프레임 어디에도 없어야 한다.

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const EXA = nameOf("exa-key");
const VALUE = "sk-live-0123456789abcdef";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * CLI 쪽 흉내. `reply`가 문자열이면 첫 연결에 그 바이트를 쓰고 닫는다(입력). `null`이면 아무것도 쓰지 않고 닫는다(취소).
 * `collect`이면 연결된 쪽이 쓴 바이트를 `received`에 모은다(열람).
 */
interface Channel {
  readonly path: string;
  readonly received: string[];
  /** 열람 시험: 호스트가 쓰고 닫아 CLI 쪽이 끝까지 읽었을 때 끝난다 */
  readonly done: Promise<void>;
}

async function openChannel(
  mode: { readonly reply: string | null } | { readonly collect: true },
  folderMode = 0o700,
): Promise<Channel> {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-chan-"));
  dirs.push(dir);
  chmodSync(dir, folderMode);
  const path = join(dir, "c.sock");
  const received: string[] = [];
  const finished = Promise.withResolvers<void>();
  const server = createServer((socket: Socket) => {
    if ("collect" in mode) {
      socket.on("data", (chunk: Uint8Array) => {
        received.push(new TextDecoder().decode(chunk));
      });
      socket.on("end", () => finished.resolve());
      socket.on("close", () => finished.resolve());
      return;
    }
    if (mode.reply !== null && mode.reply !== "") socket.write(mode.reply);
    socket.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(path, () => {
      resolve();
    });
  });
  return { path, received, done: finished.promise };
}

/** 프레임을 기록하는 전송 감싸기. 보낸 것과 받은 것을 모두 문자열로 쌓는다 */
function recording(server: Transport, frames: string[]): Transport {
  return {
    kind: server.kind,
    send(message: JsonRpcMessage) {
      frames.push(JSON.stringify(message));
      return server.send(message);
    },
    onMessage(handler) {
      return server.onMessage((raw) => {
        frames.push(JSON.stringify(raw));
        handler(raw);
      });
    },
    onClose: (handler) => server.onClose(handler),
    close: (reason) => server.close(reason),
  };
}

async function openLocal(host: ReturnType<typeof createFakeHost>, frames?: string[]) {
  const { connection } = host.connect(
    frames === undefined ? undefined : (s) => recording(s, frames),
  );
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function openRemote(host: ReturnType<typeof createFakeHost>) {
  const { connection } = host.connect();
  await connection.request("host.hello", {
    ...HELLO_PARAMS,
    client: { ...HELLO_PARAMS.client, origin: "remote", deviceId: "dev_0123456789abcdef" },
  });
  return connection;
}

function storedMeta(value: string) {
  return {
    meta: sampleMeta(EXA),
    exists: true,
    decryptable: true,
    value,
    lastUsedAt: null,
    activeLeases: 0,
  };
}

test("a local connection with the channel adds the value the CLI wrote, byte for byte", async () => {
  const host = createFakeHost();
  const connection = await openLocal(host);
  const channel = await openChannel({ reply: VALUE });
  expect(
    await connection.request("secret.beginEntry", {
      name: EXA,
      action: "add",
      channel: channel.path,
    }),
  ).toEqual({ started: true });
  expect(host.fake.secrets.received).toEqual([VALUE]);
  expect(host.fake.secrets.records.get(EXA)?.value).toBe(VALUE);
  await connection.close();
});

test("set on a local connection replaces the value through the channel", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta("old-value-000000"));
  const connection = await openLocal(host);
  const channel = await openChannel({ reply: "new-value-111111" });
  expect(
    await connection.request("secret.beginEntry", {
      name: EXA,
      action: "set",
      channel: channel.path,
    }),
  ).toEqual({ started: true });
  expect(host.fake.secrets.records.get(EXA)?.value).toBe("new-value-111111");
  await connection.close();
});

test("a remote connection with a channel is refused with secret.localOnly and nothing is read", async () => {
  const host = createFakeHost();
  const connection = await openRemote(host);
  const channel = await openChannel({ reply: VALUE });
  const failure = await rejectionOf(
    connection.request("secret.beginEntry", { name: EXA, action: "add", channel: channel.path }),
  );
  expect(failure).toBeInstanceOf(WireError);
  if (!(failure instanceof WireError)) throw new Error("expected a wire error");
  expect(failure.code).toBe(3213);
  expect(failure.data.kind).toBe("secret.localOnly");
  expect(failure.data.details).toBeUndefined();
  expect(host.fake.secrets.received).toEqual([]);
  await connection.close();
});

test("a relative path, a folder that is not 0700, or a missing folder is refused as secret.localOnly", async () => {
  const host = createFakeHost();
  const connection = await openLocal(host);
  const loose = await openChannel({ reply: VALUE }, 0o755);
  const channels = ["c.sock", loose.path, join(tmpdir(), "no-such-folder-xyz", "c.sock")];
  const failures = await Promise.all(
    channels.map((channel) =>
      rejectionOf(connection.request("secret.beginEntry", { name: EXA, action: "add", channel })),
    ),
  );
  for (const failure of failures) {
    expect(failure).toBeInstanceOf(WireError);
    if (!(failure instanceof WireError)) throw new Error("expected a wire error");
    expect(failure.data.kind).toBe("secret.localOnly");
  }
  expect(host.fake.secrets.received).toEqual([]);
  await connection.close();
});

test("a channel the CLI closes without a value is a cancelled input: started false and nothing stored", async () => {
  const host = createFakeHost();
  const connection = await openLocal(host);
  const channel = await openChannel({ reply: null });
  expect(
    await connection.request("secret.beginEntry", {
      name: EXA,
      action: "add",
      channel: channel.path,
    }),
  ).toEqual({ started: false });
  expect(host.fake.secrets.records.has(EXA)).toBe(false);
  await connection.close();
});

test("an empty value over the channel is started false and the old value stays", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta("old-value-000000"));
  const connection = await openLocal(host);
  const channel = await openChannel({ reply: "" });
  expect(
    await connection.request("secret.beginEntry", {
      name: EXA,
      action: "set",
      channel: channel.path,
    }),
  ).toEqual({ started: false });
  expect(host.fake.secrets.records.get(EXA)?.value).toBe("old-value-000000");
  await connection.close();
});

test("reveal over the channel without tty-confirm is started false and the CLI gets nothing", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta(VALUE));
  const connection = await openLocal(host);
  const channel = await openChannel({ collect: true });
  expect(
    await connection.request("secret.beginReveal", { name: EXA, channel: channel.path }),
  ).toEqual({ started: false });
  expect(channel.received).toEqual([]);
  await connection.close();
});

test("reveal with tty-confirm writes the value to the channel and reports started", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta(VALUE));
  const connection = await openLocal(host);
  const channel = await openChannel({ collect: true });
  const started = await connection.request("secret.beginReveal", {
    name: EXA,
    channel: channel.path,
    reauth: "tty-confirm",
  });
  expect(started).toEqual({ started: true });
  await channel.done;
  expect(channel.received.join("")).toBe(VALUE);
  expect(JSON.stringify(started)).not.toContain(VALUE);
  await connection.close();
});

test("no wire frame carries the value on the channel paths", async () => {
  const frames: string[] = [];
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta(VALUE));
  const connection = await openLocal(host, frames);
  const entry = await openChannel({ reply: "fresh-value-222222" });
  expect(
    await connection.request("secret.beginEntry", {
      name: EXA,
      action: "set",
      channel: entry.path,
    }),
  ).toEqual({ started: true });
  const reveal = await openChannel({ collect: true });
  expect(
    await connection.request("secret.beginReveal", {
      name: EXA,
      channel: reveal.path,
      reauth: "tty-confirm",
    }),
  ).toEqual({ started: true });
  // 경로는 wire에 실린다. 값은 어느 프레임에도 없다
  expect(frames.some((frame) => frame.includes(entry.path))).toBe(true);
  for (const frame of frames) {
    expect(frame).not.toContain("fresh-value-222222");
    expect(frame).not.toContain(VALUE);
  }
  await connection.close();
});

test("reveal over the channel with the desktop's os-auth evidence writes the value and reports started", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta(VALUE));
  const connection = await openLocal(host);
  const channel = await openChannel({ collect: true });
  const verifiedAt = 1_762_900_000_000;
  const started = await connection.request("secret.beginReveal", {
    name: EXA,
    channel: channel.path,
    reauth: { method: "os-auth", verifiedAt },
  });
  expect(started).toEqual({ started: true });
  await channel.done;
  expect(channel.received.join("")).toBe(VALUE);
  // 호스트는 화면이 보낸 증거를 그대로 관리 서비스에 넘긴다(60초 검사는 관리 서비스가 한다)
  expect(host.fake.secrets.revealed).toEqual([{ method: "os-auth", verifiedAt }]);
  await connection.close();
});

test("reveal over the channel without any reauth evidence is started false and the channel gets nothing", async () => {
  const host = createFakeHost();
  host.fake.secrets.records.set(EXA, storedMeta(VALUE));
  const connection = await openLocal(host);
  const channel = await openChannel({ collect: true });
  expect(
    await connection.request("secret.beginReveal", { name: EXA, channel: channel.path }),
  ).toEqual({ started: false });
  expect(channel.received).toEqual([]);
  expect(host.fake.secrets.revealed).toEqual([]);
  await connection.close();
});

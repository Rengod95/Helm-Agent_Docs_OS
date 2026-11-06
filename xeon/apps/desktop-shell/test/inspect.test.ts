import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import pkg from "../package.json" with { type: "json" };
import { createRelay, type Sink } from "../src/main/engine/relay.ts";
import { LOG_FILE_NAME, type AppLog } from "../src/main/lib/applog.ts";
import { errnoCode, isRecord, ownField } from "../src/main/lib/narrow.ts";
import {
  bindSocket,
  checkSocketFolder,
  createAppProbe,
  createLineSplitter,
  FAILED,
  handleLine,
  INSPECT_ENV,
  INSPECT_SOCKET_ENV,
  INVALID_REQUEST,
  inspectModule,
  MAX_CONNECTIONS,
  MAX_LINE_BYTES,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  pngSize,
  SOCKET_FILE_NAME,
  socketPath,
  startInspectServer,
  takeViewportSnapshot,
  type CapturedImage,
  type FolderFacts,
  type InspectWindow,
  type Probe,
  type SnapshotFailure,
  type SnapshotMeta,
  type StateDump,
} from "../src/main/inspect.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

// Rust `inspect/`의 시험(mod.rs, server.rs, snapshot_macos.rs)을 옮긴 것이다. 시험마다 만든 폴더는 끝에 지운다.

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const DUMP: StateDump = {
  app: { name: "fresnel-desktop", version: "0.0.0", pid: 1, uptimeMs: 2, debug: true },
  engine: { kind: "stopped" },
  relay: { epoch: 0 },
  window: null,
  paths: { logDir: "/logs" },
};

const SNAPSHOT: SnapshotMeta = {
  path: "/logs/snapshots/viewport-1.png",
  bytes: 33,
  mime: "image/png",
  width: 3,
  height: 2,
};

/** 가짜 Probe. `state.dump` 호출 수를 센다 */
function fakeProbe(snapshot: Result<SnapshotMeta, SnapshotFailure>): {
  probe: Probe;
  dumps: () => number;
} {
  let dumps = 0;
  return {
    probe: {
      stateDump() {
        dumps += 1;
        return DUMP;
      },
      viewportSnapshot() {
        return Promise.resolve(snapshot);
      },
    },
    dumps: () => dumps,
  };
}

/** 응답 줄을 읽는다. 응답이 없으면(null) 시험이 틀린 것이다 */
function parseReply(text: string | null): unknown {
  if (typeof text !== "string") throw new Error("expected a reply line");
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error("reply is not JSON");
  return parsed.value;
}

function must<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf<E>(result: Result<unknown, E>): E {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

/** 줄 끝을 포함해 `size`바이트인 PNG 머리글. 픽셀 크기만 맞으면 된다 */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(enc("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function imageOf(bytes: Uint8Array): CapturedImage {
  return { toPNG: () => bytes };
}

/** 가짜 창. `capture`가 화면을 돌려준다 */
function fakeWindow(
  capture: () => Promise<CapturedImage>,
  destroyed: boolean = false,
): InspectWindow {
  return {
    isDestroyed: () => destroyed,
    isVisible: () => true,
    isFocused: () => false,
    isMinimized: () => false,
    getContentSize: () => [800, 600],
    webContents: { capturePage: capture },
  };
}

function fakeSink(): Sink {
  return { sendBytes: () => ok(undefined), sendState: () => ok(undefined) };
}

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더. 짧은 이름을 써서 소켓 경로 상한(100바이트)에 여유를 둔다 */
function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fi-"));
  cleanups.push(dir);
  return dir;
}

function closeRaw(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function connect(file: string): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(file);
    socket.once("connect", () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** 연결이 실패한 이유를 돌려준다(낡은 소켓이면 ECONNREFUSED) */
function connectError(file: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(file);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("connected to a socket that should be stale"));
    });
    socket.once("error", (cause: unknown) => {
      resolve(cause);
    });
  });
}

/** 응답 줄 `count`개를 받는다. 소켓은 열어 둔다 */
function readLines(socket: Socket, count: number): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    let text = "";
    const onData = (chunk: Buffer): void => {
      text += chunk.toString("utf8");
      const lines = text.split("\n");
      if (lines.length > count) {
        socket.off("data", onData);
        resolve(lines.slice(0, count));
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

/** 서버가 연결을 끊을 때까지 받은 글 전부 */
function readAll(socket: Socket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    socket.once("end", () => {
      resolve(text);
    });
    socket.once("close", () => {
      resolve(text);
    });
    socket.once("error", reject);
  });
}

/** 낡은 소켓 파일을 만든다. 듣는 서버를 닫으면 파일이 남지 않으므로, 파일을 잠깐 옮겨 두었다가 되돌린다 */
async function leaveStaleSocket(file: string): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(file, () => {
      resolve();
    });
  });
  const moved = `${file}.moved`;
  renameSync(file, moved);
  await closeRaw(server);
  renameSync(moved, file);
}

/** 폴더의 사실(`fs.Stats`가 하는 일만 흉내 낸다) */
function folderFacts(mode: number, uid: number, isDirectory: boolean = true): FolderFacts {
  return { isDirectory: () => isDirectory, uid, mode };
}

function quietLog(lines: string[]): AppLog {
  return {
    line(message) {
      lines.push(message);
    },
  };
}

describe("handleLine (mod.rs 시험)", () => {
  test("state.dump answers with the probe value and echoes the id", async () => {
    const { probe } = fakeProbe(ok(SNAPSHOT));
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":7,"method":"state.dump"}')),
    ).toEqual({ jsonrpc: "2.0", id: 7, result: DUMP });
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":"a","method":"state.dump"}')),
    ).toEqual({ jsonrpc: "2.0", id: "a", result: DUMP });
  });

  test("a null id still gets a response, unlike a missing id", async () => {
    const { probe } = fakeProbe(ok(SNAPSHOT));
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":null,"method":"state.dump"}')),
    ).toEqual({ jsonrpc: "2.0", id: null, result: DUMP });
  });

  test("viewport.snapshot returns the metadata, or a FAILED error with the probe message", async () => {
    const good = fakeProbe(ok(SNAPSHOT));
    expect(
      parseReply(
        await handleLine(good.probe, '{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}'),
      ),
    ).toEqual({ jsonrpc: "2.0", id: 1, result: SNAPSHOT });
    const failing = fakeProbe(
      err({ kind: "capture_failed", message: "unsupported on this platform" }),
    );
    expect(
      parseReply(
        await handleLine(failing.probe, '{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}'),
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: FAILED, message: "unsupported on this platform" },
    });
    expect(FAILED).toBe(-32000);
  });

  test("malformed and unknown requests get the standard errors", async () => {
    const { probe } = fakeProbe(ok(SNAPSHOT));
    expect(parseReply(await handleLine(probe, "not json"))).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: PARSE_ERROR, message: "parse error" },
    });
    expect(parseReply(await handleLine(probe, "[1]"))).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: INVALID_REQUEST, message: "invalid request" },
    });
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"1.0","id":2,"method":"state.dump"}')),
    ).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: INVALID_REQUEST, message: "invalid request" },
    });
    expect(parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":3}'))).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: INVALID_REQUEST, message: "invalid request" },
    });
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":4,"method":"engine.restart"}')),
    ).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: METHOD_NOT_FOUND, message: "method not found" },
    });
    // 읽기 전용이다: 엔진을 건드리는 메서드는 없다
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":5,"method":"engine_write"}')),
    ).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: METHOD_NOT_FOUND, message: "method not found" },
    });
  });

  test("a notification gets no response, but its method still runs", async () => {
    const { probe, dumps } = fakeProbe(ok(SNAPSHOT));
    expect(await handleLine(probe, '{"jsonrpc":"2.0","method":"state.dump"}')).toBeNull();
    expect(dumps()).toBe(1);
    expect(await handleLine(probe, '{"jsonrpc":"2.0","method":"engine.restart"}')).toBeNull();
  });

  test("an invalid notification gets an error with a null id", async () => {
    const { probe } = fakeProbe(ok(SNAPSHOT));
    expect(parseReply(await handleLine(probe, '{"jsonrpc":"1.0","method":"state.dump"}'))).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: INVALID_REQUEST, message: "invalid request" },
    });
  });

  test("the error codes are the JSON-RPC values", () => {
    expect(PARSE_ERROR).toBe(-32700);
    expect(INVALID_REQUEST).toBe(-32600);
    expect(METHOD_NOT_FOUND).toBe(-32601);
    expect(MAX_LINE_BYTES).toBe(16 * 1024);
    expect(MAX_CONNECTIONS).toBe(4);
  });
});

describe("line splitting (server.rs의 줄 상한)", () => {
  test("a line split across chunks is joined, and a character cut between chunks stays whole", () => {
    const splitter = createLineSplitter(64);
    const bytes = enc("가나\n다\n");
    expect(splitter.push(bytes.subarray(0, 2))).toEqual({ lines: [], tooLong: false });
    expect(splitter.push(bytes.subarray(2))).toEqual({ lines: ["가나", "다"], tooLong: false });
  });

  test("a line whose bytes with its newline reach the limit is refused, and the lines before it are kept", () => {
    // 줄 끝을 포함해 10바이트는 받고, 11바이트는 거절한다(Rust의 take(MAX + 1)과 같다)
    const fits = createLineSplitter(10);
    expect(fits.push(enc(`abc\n${"x".repeat(9)}\n`))).toEqual({
      lines: ["abc", "x".repeat(9)],
      tooLong: false,
    });
    const refused = createLineSplitter(10);
    expect(refused.push(enc(`abc\n${"y".repeat(10)}\n`))).toEqual({
      lines: ["abc"],
      tooLong: true,
    });
    expect(refused.push(enc("more\n"))).toEqual({ lines: [], tooLong: false });
  });

  test("an unterminated line longer than the limit is refused while it streams", () => {
    expect(createLineSplitter(10).push(enc("x".repeat(11)))).toEqual({ lines: [], tooLong: true });
    // 상한과 같은 길이의 줄 끝 없는 조각은 EOF에서 줄로 처리된다(Rust가 EOF에서 처리하는 것과 같다)
    const atLimit = createLineSplitter(10);
    expect(atLimit.push(enc("x".repeat(10)))).toEqual({ lines: [], tooLong: false });
    expect(atLimit.end()).toEqual({ lines: ["x".repeat(10)], tooLong: false });
  });

  test("end returns the last unterminated line once", () => {
    const splitter = createLineSplitter(64);
    expect(splitter.push(enc("a\nb"))).toEqual({ lines: ["a"], tooLong: false });
    expect(splitter.end()).toEqual({ lines: ["b"], tooLong: false });
    expect(splitter.end()).toEqual({ lines: [], tooLong: false });
  });
});

describe("socket folder and file permissions (server.rs 시험)", () => {
  test("socket_path defaults next to the log and honours the override", () => {
    const log = "/logs/dev.fresnel.desktop";
    expect(socketPath(log, undefined)).toBe("/logs/dev.fresnel.desktop/inspect.sock");
    expect(socketPath(log, "")).toBe("/logs/dev.fresnel.desktop/inspect.sock");
    expect(socketPath(log, "/run/x.sock")).toBe("/run/x.sock");
    expect(SOCKET_FILE_NAME).toBe("inspect.sock");
    expect(INSPECT_SOCKET_ENV).toBe("FRESNEL_DESKTOP_INSPECT_SOCKET");
    expect(INSPECT_ENV).toBe("FRESNEL_DESKTOP_INSPECT");
  });

  test("a folder the app creates is 0700 and the socket is 0600, and the folder above is left alone", async () => {
    const root = scratch();
    chmodSync(root, 0o755);
    const inner = path.join(root, "inner");
    const file = path.join(inner, "i.sock");
    const server = must(await bindSocket(file));
    expect(statSync(inner).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(root).mode & 0o777).toBe(0o755);
    await closeRaw(server);
  });

  test("an existing folder of this user that others cannot write is used as it is", async () => {
    await Promise.all(
      [0o755, 0o775].map(async (mode) => {
        const dir = scratch();
        chmodSync(dir, mode);
        const file = path.join(dir, "i.sock");
        const server = must(await bindSocket(file));
        expect(statSync(dir).mode & 0o777).toBe(mode);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        await closeRaw(server);
      }),
    );
  });

  test("an existing shared folder is refused and its permissions stay as they were", async () => {
    const dir = scratch();
    chmodSync(dir, 0o777);
    const file = path.join(dir, "i.sock");
    expect(errorOf(await bindSocket(file))).toEqual({ kind: "folder_refused", dir });
    expect(statSync(dir).mode & 0o777).toBe(0o777);
    expect(existsSync(file)).toBe(false);
  });

  test("the system temp folder is never taken over by an override path", async () => {
    const before = statSync("/tmp").mode;
    const file = path.join("/tmp", `fresnel-inspect-override-${process.pid}.sock`);
    expect(errorOf(await bindSocket(file))).toEqual({ kind: "folder_refused", dir: "/tmp" });
    expect(statSync("/tmp").mode).toBe(before);
    expect(existsSync(file)).toBe(false);
  });

  test("a file in place of the socket folder is refused", async () => {
    const dir = scratch();
    const folder = path.join(dir, "folder");
    writeFileSync(folder, "data");
    expect(errorOf(await bindSocket(path.join(folder, "i.sock")))).toEqual({
      kind: "not_a_directory",
      dir: folder,
    });
  });

  test("a path too long for a unix socket is refused before anything is created", async () => {
    const long = `/tmp/${"x".repeat(120)}`;
    expect(errorOf(await bindSocket(long))).toEqual({ kind: "path_too_long" });
    expect(existsSync(long)).toBe(false);
  });

  test("the folder check accepts only a directory of this user that others cannot write", () => {
    expect(checkSocketFolder("d", folderFacts(0o755, 501), 501)).toEqual(ok(undefined));
    expect(checkSocketFolder("d", folderFacts(0o775, 501), 501)).toEqual(ok(undefined));
    expect(checkSocketFolder("d", folderFacts(0o777, 501), 501)).toEqual(
      err({ kind: "folder_refused", dir: "d" }),
    );
    expect(checkSocketFolder("d", folderFacts(0o700, 0), 501)).toEqual(
      err({ kind: "folder_refused", dir: "d" }),
    );
    expect(checkSocketFolder("d", folderFacts(0o700, 501), undefined)).toEqual(
      err({ kind: "folder_refused", dir: "d" }),
    );
    expect(checkSocketFolder("d", folderFacts(0o700, 501, false), 501)).toEqual(
      err({ kind: "not_a_directory", dir: "d" }),
    );
  });
});

describe("stale socket and regular files (server.rs 시험)", () => {
  test("a stale socket file is replaced, but a regular file is never deleted", async () => {
    const dir = scratch();
    const file = path.join(dir, "i.sock");
    await leaveStaleSocket(file);
    expect(lstatSync(file).isSocket()).toBe(true);
    expect(errnoCode(await connectError(file))).toBe("ECONNREFUSED");

    const server = must(await bindSocket(file));
    expect(lstatSync(file).isSocket()).toBe(true);
    // allowHalfOpen 서버라 받은 쪽은 클라이언트가 끊어도 스스로 닫히지 않는다(Linux).
    // 운영 코드는 멈출 때 연결을 직접 닫으니(startInspectServer) 시험도 받은 쪽을 닫는다
    const accepted = new Promise<Socket>((resolve) => {
      server.once("connection", resolve);
    });
    const client = await connect(file);
    (await accepted).destroy();
    client.destroy();
    await closeRaw(server);

    const keep = path.join(dir, "keep.sock");
    writeFileSync(keep, "data");
    expect(errorOf(await bindSocket(keep))).toEqual({ kind: "socket_path_taken", path: keep });
    expect(readFileSync(keep, "utf8")).toBe("data");
  });

  test("a socket folder that is missing is created with its parents", async () => {
    const root = scratch();
    const deep = path.join(root, "a", "b");
    mkdirSync(path.join(root, "a"));
    const file = path.join(deep, "i.sock");
    const server = must(await bindSocket(file));
    expect(statSync(deep).mode & 0o777).toBe(0o700);
    await closeRaw(server);
  });
});

describe("protocol over a real socket (server.rs 시험)", () => {
  test("requests are answered line by line, and the socket is removed when the server stops", async () => {
    const dir = scratch();
    const file = path.join(dir, "i.sock");
    const logged: string[] = [];
    const { probe } = fakeProbe(ok(SNAPSHOT));
    const handle = must(await startInspectServer(file, probe, quietLog(logged)));
    expect(logged).toEqual([`debug inspect listening on ${file}`]);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const client = await connect(file);
    client.write(
      '{"jsonrpc":"2.0","id":1,"method":"state.dump"}\n{"jsonrpc":"2.0","id":2,"method":"nope"}\n',
    );
    const [first, second] = await readLines(client, 2);
    expect(parseReply(first ?? null)).toEqual({ jsonrpc: "2.0", id: 1, result: DUMP });
    expect(parseReply(second ?? null)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: METHOD_NOT_FOUND, message: "method not found" },
    });
    client.destroy();

    await handle.close();
    expect(existsSync(file)).toBe(false);
  });

  test("a request split across two writes is answered once its newline arrives", async () => {
    const dir = scratch();
    const file = path.join(dir, "i.sock");
    const { probe } = fakeProbe(ok(SNAPSHOT));
    const handle = must(await startInspectServer(file, probe, quietLog([])));
    const client = await connect(file);
    client.write('{"jsonrpc":"2.0","id":1,');
    client.write('"method":"state.dump"}\n');
    const [line] = await readLines(client, 1);
    expect(parseReply(line ?? null)).toEqual({ jsonrpc: "2.0", id: 1, result: DUMP });
    client.destroy();
    await handle.close();
  });

  test("a line over the limit gets INVALID_REQUEST and the connection closes", async () => {
    const dir = scratch();
    const file = path.join(dir, "i.sock");
    const { probe } = fakeProbe(ok(SNAPSHOT));
    const handle = must(await startInspectServer(file, probe, quietLog([])));
    const client = await connect(file);
    client.write(Buffer.alloc(MAX_LINE_BYTES + 1, 0x61));
    const text = await readAll(client);
    expect(parseReply(text.split("\n")[0] ?? null)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: INVALID_REQUEST, message: "line too long" },
    });
    client.destroy();
    await handle.close();
  });

  test("a connection past the cap is closed at once, and the first four keep working", async () => {
    const dir = scratch();
    const file = path.join(dir, "i.sock");
    const { probe } = fakeProbe(ok(SNAPSHOT));
    const handle = must(await startInspectServer(file, probe, quietLog([])));
    const held = await Promise.all(Array.from({ length: MAX_CONNECTIONS }, () => connect(file)));
    const extra = await connect(file);
    expect(await readAll(extra)).toBe("");

    const first = held[0];
    if (first === undefined) throw new Error("expected a held connection");
    first.write('{"jsonrpc":"2.0","id":9,"method":"state.dump"}\n');
    const [line] = await readLines(first, 1);
    expect(parseReply(line ?? null)).toEqual({ jsonrpc: "2.0", id: 9, result: DUMP });

    for (const client of held) client.destroy();
    await handle.close();
  });
});

describe("viewport snapshot (snapshot_macos.rs 시험)", () => {
  test("the PNG goes under snapshots/ with 0600 permissions, and the response carries metadata only", async () => {
    const dir = scratch();
    const png = pngBytes(3, 2);
    const win = fakeWindow(() => Promise.resolve(imageOf(png)));
    const meta = must(
      await takeViewportSnapshot(win, { logDir: dir, wallMs: () => 1234, waitMs: 1000 }),
    );
    const file = path.join(dir, "snapshots", "viewport-1234.png");
    expect(meta).toEqual({ path: file, bytes: 33, mime: "image/png", width: 3, height: 2 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file)).toEqual(Buffer.from(png));
  });

  test("over the protocol the result has exactly the metadata keys", async () => {
    const dir = scratch();
    const png = pngBytes(640, 480);
    const relay = createRelay({ kind: "stopped" });
    const probe = createAppProbe({
      relay,
      windows: () => [fakeWindow(() => Promise.resolve(imageOf(png)))],
      logDir: dir,
      version: pkg.version,
      monotonicMs: () => 0,
      startedAt: 0,
      wallMs: () => 7,
      waitMs: 1000,
    });
    const reply = parseReply(
      await handleLine(probe, '{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}'),
    );
    if (!isRecord(reply)) throw new Error("expected an object reply");
    const result = ownField(reply, "result");
    if (!isRecord(result)) throw new Error("expected a result object");
    expect(Object.keys(result).toSorted()).toEqual(["bytes", "height", "mime", "path", "width"]);
    expect(result).toEqual({
      path: path.join(dir, "snapshots", "viewport-7.png"),
      bytes: 33,
      mime: "image/png",
      width: 640,
      height: 480,
    });
  });

  test("without a window the snapshot fails with FAILED and a short message", async () => {
    const probe = createAppProbe({
      relay: createRelay({ kind: "stopped" }),
      windows: () => [],
      logDir: scratch(),
      version: pkg.version,
      monotonicMs: () => 0,
      startedAt: 0,
      wallMs: () => 1,
      waitMs: 1000,
    });
    expect(
      parseReply(await handleLine(probe, '{"jsonrpc":"2.0","id":1,"method":"viewport.snapshot"}')),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: FAILED, message: "the main window does not exist" },
    });
  });

  test("a capture that fails is reported without writing a file", async () => {
    const dir = scratch();
    const win = fakeWindow(() => Promise.reject(new Error("boom")));
    const failure = errorOf(
      await takeViewportSnapshot(win, { logDir: dir, wallMs: () => 1, waitMs: 1000 }),
    );
    expect(failure).toEqual({ kind: "capture_failed", message: "the snapshot failed" });
    expect(existsSync(path.join(dir, "snapshots"))).toBe(false);
  });

  test("an image that is not a PNG is refused and nothing is written", async () => {
    const dir = scratch();
    const win = fakeWindow(() => Promise.resolve(imageOf(enc("not a png at all, just text"))));
    expect(
      errorOf(await takeViewportSnapshot(win, { logDir: dir, wallMs: () => 1, waitMs: 1000 })),
    ).toEqual({
      kind: "encode_failed",
      message: "the snapshot could not be encoded as PNG",
    });
    expect(existsSync(path.join(dir, "snapshots"))).toBe(false);
  });

  test("a capture that never finishes times out", async () => {
    const dir = scratch();
    const win = fakeWindow(() => new Promise<CapturedImage>(() => undefined));
    expect(
      errorOf(await takeViewportSnapshot(win, { logDir: dir, wallMs: () => 1, waitMs: 5 })),
    ).toEqual({
      kind: "timeout",
      message: "the snapshot timed out",
    });
  });

  test("a destroyed window has no snapshot", async () => {
    const win = fakeWindow(() => Promise.resolve(imageOf(pngBytes(1, 1))), true);
    expect(
      errorOf(
        await takeViewportSnapshot(win, { logDir: scratch(), wallMs: () => 1, waitMs: 1000 }),
      ),
    ).toEqual({
      kind: "no_window",
      message: "the main window does not exist",
    });
  });

  test("the snapshot size comes from the PNG header only", () => {
    expect(pngSize(pngBytes(640, 480))).toEqual({ width: 640, height: 480 });
    expect(pngSize(enc("nope"))).toBeNull();
    expect(pngSize(new Uint8Array(33))).toBeNull();
  });
});

describe("state.dump (probe.rs 시험)", () => {
  test("state.dump has exactly the documented keys, with no conversation or secret values", () => {
    const relay = createRelay({ kind: "stopped" });
    const win = fakeWindow(() => Promise.resolve(imageOf(pngBytes(1, 1))));
    const probe = createAppProbe({
      relay,
      windows: () => [win],
      logDir: "/logs/dev",
      version: "9.9.9",
      monotonicMs: () => 350,
      startedAt: 100,
      wallMs: () => 0,
      waitMs: 1000,
    });
    const dump = probe.stateDump();
    expect(Object.keys(dump).toSorted()).toEqual(["app", "engine", "paths", "relay", "window"]);
    expect(Object.keys(dump.app).toSorted()).toEqual([
      "debug",
      "name",
      "pid",
      "uptimeMs",
      "version",
    ]);
    expect(Object.keys(dump.relay).toSorted()).toEqual(["epoch"]);
    expect(Object.keys(dump.paths).toSorted()).toEqual(["logDir"]);
    expect(dump.window).not.toBeNull();
    expect(Object.keys(dump.window ?? {}).toSorted()).toEqual([
      "focused",
      "innerSize",
      "label",
      "minimized",
      "visible",
    ]);
    expect(Object.keys(dump.window?.innerSize ?? {}).toSorted()).toEqual(["height", "width"]);

    expect(dump.app).toEqual({
      name: "fresnel-desktop",
      version: "9.9.9",
      pid: process.pid,
      uptimeMs: 250,
      debug: true,
    });
    expect(dump.engine).toEqual({ kind: "stopped" });
    expect(dump.relay).toEqual({ epoch: 0 });
    expect(dump.window).toEqual({
      label: "main",
      visible: true,
      focused: false,
      minimized: false,
      innerSize: { width: 800, height: 600 },
    });
    expect(dump.paths).toEqual({ logDir: "/logs/dev" });
  });

  test("the relay epoch follows the attached page", () => {
    const relay = createRelay({ kind: "stopped" });
    const probe = createAppProbe({
      relay,
      windows: () => [],
      logDir: "/logs",
      version: "0.0.0",
      monotonicMs: () => 0,
      startedAt: 0,
      wallMs: () => 0,
      waitMs: 1000,
    });
    expect(probe.stateDump().relay.epoch).toBe(0);
    relay.attach(fakeSink());
    expect(probe.stateDump().relay.epoch).toBe(1);
    expect(probe.stateDump().window).toBeNull();
  });

  test("uptime never goes negative, and a destroyed window is reported as null", () => {
    const probe = createAppProbe({
      relay: createRelay({ kind: "stopped" }),
      windows: () => [fakeWindow(() => Promise.resolve(imageOf(pngBytes(1, 1))), true)],
      logDir: "/logs",
      version: "0.0.0",
      monotonicMs: () => 50,
      startedAt: 100,
      wallMs: () => 0,
      waitMs: 1000,
    });
    const dump = probe.stateDump();
    expect(dump.app.uptimeMs).toBe(0);
    expect(dump.window).toBeNull();
  });
});

describe("module wiring", () => {
  test("without FRESNEL_DESKTOP_INSPECT=1 nothing is started or logged", async () => {
    const fake = fakeCtx({ env: {} });
    inspectModule.register(fake.ctx);
    await fake.quit();
    expect(existsSync(path.join(fake.ctx.paths.logs, SOCKET_FILE_NAME))).toBe(false);
    expect(existsSync(path.join(fake.ctx.paths.logs, LOG_FILE_NAME))).toBe(false);
  });

  test("with the variable the socket opens, is logged, and is removed on quit", async () => {
    const fake = fakeCtx();
    // 가짜 ctx의 env는 시험이 고치는 객체와 같다. 소켓은 시험 폴더 안(0700)에 둔다
    const file = path.join(fake.dir, "i.sock");
    fake.env[INSPECT_ENV] = "1";
    fake.env[INSPECT_SOCKET_ENV] = file;
    inspectModule.register(fake.ctx);
    await fake.quit();
    const logText = readFileSync(path.join(fake.ctx.paths.logs, LOG_FILE_NAME), "utf8");
    expect(logText).toContain(`debug inspect listening on ${file}`);
    expect(existsSync(file)).toBe(false);
  });

  test("on Windows nothing listens and the reason is logged", async () => {
    const fake = fakeCtx({ env: { [INSPECT_ENV]: "1" } });
    inspectModule.register({ ...fake.ctx, platform: "win32" });
    await fake.quit();
    const logText = readFileSync(path.join(fake.ctx.paths.logs, LOG_FILE_NAME), "utf8");
    expect(logText).toContain("debug inspect did not start: unix sockets only");
    expect(existsSync(path.join(fake.ctx.paths.logs, SOCKET_FILE_NAME))).toBe(false);
  });
});

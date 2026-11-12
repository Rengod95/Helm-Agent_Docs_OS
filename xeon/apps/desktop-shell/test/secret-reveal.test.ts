import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nodeScheduler } from "../src/main/lib/scheduler.ts";
import { createRevealChannels, secretRevealModule } from "../src/main/secret-reveal.ts";
import { createFakeContext } from "./fake-context.ts";

// 값 보기 로컬 채널(셸 쪽). 호스트 역할은 실제 유닉스 소켓에 가짜 바이트를 쓰는 클라이언트가 한다. 값은 가짜다.
// 확인하는 것: 폴더가 0700이고, 받은 바이트가 쓴 것과 같으며, 시한·상한·닫기 뒤 폴더가 남지 않는지.

const FAKE_VALUE = "fake-reveal-value-not-a-secret";
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function rootDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "rv-"));
  roots.push(root);
  return root;
}

/** 호스트 역할: 소켓에 바이트를 쓰고 닫는다. 쓰기가 끝났으면 true, 상대가 먼저 끊어 실패했으면 false */
function sendTo(socketPath: string, bytes: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    socket.on("error", () => {
      resolve(false);
    });
    socket.on("finish", () => {
      resolve(true);
    });
    socket.end(bytes);
  });
}

describe("the reveal channel opens a private one-shot socket", () => {
  test("the folder is 0700 under the root, the socket carries the bytes the host wrote, and the folder is gone after take", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 5_000,
      maxBytes: 1024,
    });
    const opened = await channels.open();
    const folder = path.dirname(opened.path);
    expect(path.dirname(folder)).toBe(root);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    const pending = channels.take(opened.id);
    expect(await sendTo(opened.path, ENCODER.encode(FAKE_VALUE))).toBe(true);
    const taken = await pending;
    expect(taken === null ? null : DECODER.decode(taken)).toBe(FAKE_VALUE);
    expect(existsSync(folder)).toBe(false);
  });

  test("a second open closes the first channel, so its take ends with null", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 5_000,
      maxBytes: 1024,
    });
    const first = await channels.open();
    const firstTake = channels.take(first.id);
    const second = await channels.open();
    expect(await firstTake).toBeNull();
    expect(existsSync(path.dirname(first.path))).toBe(false);
    expect(existsSync(path.dirname(second.path))).toBe(true);
    await channels.close(second.id);
    expect(existsSync(path.dirname(second.path))).toBe(false);
  });

  test("a value over the limit is refused: take ends with null and the folder is gone", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 5_000,
      maxBytes: 8,
    });
    const opened = await channels.open();
    const pending = channels.take(opened.id);
    await sendTo(opened.path, ENCODER.encode("this value is longer than eight bytes"));
    expect(await pending).toBeNull();
    expect(existsSync(path.dirname(opened.path))).toBe(false);
  });

  test("a host that never writes is cut off by the wait: take ends with null and the folder is gone", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 30,
      maxBytes: 1024,
    });
    const opened = await channels.open();
    expect(await channels.take(opened.id)).toBeNull();
    expect(existsSync(path.dirname(opened.path))).toBe(false);
  });

  test("an empty write is not a value: take ends with null", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 5_000,
      maxBytes: 1024,
    });
    const opened = await channels.open();
    const pending = channels.take(opened.id);
    await sendTo(opened.path, new Uint8Array());
    expect(await pending).toBeNull();
  });

  test("close ends a waiting take with null, and an id that is not open does nothing", async () => {
    const root = await rootDir();
    const channels = createRevealChannels({
      root,
      scheduler: nodeScheduler(),
      waitMs: 5_000,
      maxBytes: 1024,
    });
    const opened = await channels.open();
    const pending = channels.take(opened.id);
    await channels.close(randomUUID());
    expect(existsSync(path.dirname(opened.path))).toBe(true);
    await channels.close(opened.id);
    expect(await pending).toBeNull();
    expect(await channels.take(randomUUID())).toBeNull();
    expect(existsSync(path.dirname(opened.path))).toBe(false);
  });
});

describe("the reveal commands", () => {
  test("open, take and close are commands; a malformed id is a bad request, and the value comes back as bytes", async () => {
    const fake = createFakeContext();
    secretRevealModule.register(fake.ctx);
    const opened = await fake.dispatch("secret_reveal_open", {});
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const reply: unknown = opened.value;
    const id = typeof reply === "object" && reply !== null && "id" in reply ? reply.id : null;
    const socketPath =
      typeof reply === "object" && reply !== null && "path" in reply ? reply.path : null;
    if (typeof id !== "string" || typeof socketPath !== "string") {
      throw new Error("open must answer with an id and a path");
    }
    expect(path.basename(socketPath)).toBe("reveal.sock");
    expect(await fake.dispatch("secret_reveal_take", { id: "not-an-id" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    const pending = fake.dispatch("secret_reveal_take", { id });
    expect(await sendTo(socketPath, ENCODER.encode(FAKE_VALUE))).toBe(true);
    const taken = await pending;
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.value instanceof Uint8Array ? DECODER.decode(taken.value) : null).toBe(FAKE_VALUE);
    expect(await fake.dispatch("secret_reveal_close", { id })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

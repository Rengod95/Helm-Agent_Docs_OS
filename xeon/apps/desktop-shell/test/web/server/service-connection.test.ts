import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { connectServiceSocket } from "../../../src/web/server/service-connection.ts";
import type { ServiceCloseCause } from "../../../src/web/server/ports.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { receivedBytes, settle, startFakeService } from "./support.ts";

afterEach(cleanupTempDirs);

function closeOf(connection: ReturnType<typeof connectServiceSocket>): Promise<ServiceCloseCause> {
  return new Promise((resolve) => {
    connection.onClose(resolve);
  });
}

describe("connectServiceSocket", () => {
  test("a write issued before the connection opens is delivered in order after it opens", async () => {
    const service = await startFakeService(tempDir());
    const connection = connectServiceSocket(service.path);
    const first = connection.write(new Uint8Array([1, 2, 3]));
    const second = connection.write(new Uint8Array([4, 5]));
    expect(await first).toEqual({ ok: true, value: null });
    expect(await second).toEqual({ ok: true, value: null });
    await settle();
    expect(receivedBytes(service.sides[0] ?? missing()).equals(Buffer.from([1, 2, 3, 4, 5]))).toBe(
      true,
    );
    connection.close();
    await service.close();
  });

  test("bytes from the service reach the listener, including chunks that arrived before it was set", async () => {
    const service = await startFakeService(tempDir());
    const connection = connectServiceSocket(service.path);
    const chunks: Buffer[] = [];
    connection.onData((bytes) => {
      chunks.push(Buffer.from(bytes));
    });
    await settle();
    const side = service.sides[0] ?? missing();
    side.socket.write(Buffer.from("hello\n"));
    await settle();
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello\n");
    connection.close();
    await service.close();
  });

  test("a missing socket path reports a failed close with the errno code and refuses writes", async () => {
    const connection = connectServiceSocket(path.join(tempDir(), "missing.sock"));
    const cause = await closeOf(connection);
    expect(cause).toEqual({ kind: "failed", code: "ENOENT" });
    expect(await connection.write(new Uint8Array([1]))).toEqual({
      ok: false,
      error: { kind: "closed" },
    });
  });

  test("when the service closes the socket, the close is reported as ended", async () => {
    const service = await startFakeService(tempDir());
    const connection = connectServiceSocket(service.path);
    const closed = closeOf(connection);
    await settle();
    const side = service.sides[0] ?? missing();
    side.socket.destroy();
    expect(await closed).toEqual({ kind: "ended" });
    await service.close();
  });

  test("a listener registered after the close is still told, once", async () => {
    const service = await startFakeService(tempDir());
    const connection = connectServiceSocket(service.path);
    await settle();
    connection.close();
    await settle();
    expect(await closeOf(connection)).toEqual({ kind: "ended" });
    await service.close();
  });
});

function missing(): never {
  throw new Error("the fake service saw no connection");
}

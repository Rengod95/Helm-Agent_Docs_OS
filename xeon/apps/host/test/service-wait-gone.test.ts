import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import {
  listenSocket,
  type RegistrationStore,
  type ServiceRegistration,
  type SocketListener,
} from "@xeon/platform-process";
import { waitServiceGone } from "../src/service/ensure.ts";
import { systemTime } from "../src/service/time.ts";
import { scratchRuntimeDir } from "./fixtures/service-harness.ts";

// B1-SVC 이월(승계 경쟁): 교체 중에 새 서비스가 같은 경로에 붙으면, 기다리던 옛 서비스는 내려간 것으로 본다.

const listeners: SocketListener[] = [];
const dirs: { dispose(): void }[] = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  for (const dir of dirs.splice(0)) dir.dispose();
});

const OLD = { pid: 4101, startedAt: 1_700_000_000_000 };
const NEW = { pid: 4202, startedAt: 1_700_000_005_000 };

function registration(socket: string, identity: { pid: number; startedAt: number }) {
  const value: ServiceRegistration = {
    schemaVersion: 1,
    version: "0.0.0",
    protocolVersion: "0.1.0",
    socket,
    pid: identity.pid,
    startedAt: identity.startedAt,
    token: "t".repeat(43),
    storeId: "s",
  };
  return value;
}

function storeReading(read: () => ServiceRegistration): RegistrationStore {
  return {
    path: "/unused",
    read: () => ok(read()),
    write: () => ok(undefined),
    removeIfOwned: () => ok(true),
  };
}

async function liveSocket(): Promise<string> {
  const runtime = scratchRuntimeDir();
  dirs.push(runtime);
  const path = join(runtime.dir, "xeon.sock");
  const listened = await listenSocket({ kind: "unix", path });
  if (!listened.ok) throw new Error("cannot listen");
  listeners.push(listened.value);
  listened.value.onConnection(() => undefined);
  return path;
}

describe("waitServiceGone", () => {
  test("a registration that now names another service counts as gone even though its socket answers", async () => {
    const socket = await liveSocket();
    const reads = { count: 0 };
    const store = storeReading(() => {
      reads.count += 1;
      return registration(socket, reads.count === 1 ? OLD : NEW);
    });
    expect(await waitServiceGone(store, systemTime(), 5000, OLD)).toBe(true);
    expect(reads.count).toBe(2);
  });

  test("the same service still answering is not gone once the wait runs out", async () => {
    const socket = await liveSocket();
    const store = storeReading(() => registration(socket, OLD));
    expect(await waitServiceGone(store, systemTime(), 150, OLD)).toBe(false);
  });

  test("an unreachable socket counts as gone", async () => {
    const runtime = scratchRuntimeDir();
    dirs.push(runtime);
    const store = storeReading(() => registration(join(runtime.dir, "none.sock"), OLD));
    expect(await waitServiceGone(store, systemTime(), 5000, OLD)).toBe(true);
  });
});

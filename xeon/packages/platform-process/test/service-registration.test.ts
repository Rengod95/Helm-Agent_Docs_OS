import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistrationStore,
  newServiceToken,
  type ServiceRegistration,
} from "../src/index.ts";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-reg-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TOKEN = newServiceToken((bytes) => new Uint8Array(bytes).fill(7));

function registration(overrides: Partial<ServiceRegistration> = {}): ServiceRegistration {
  return {
    schemaVersion: 1,
    version: "0.1.0",
    protocolVersion: "1.0.0",
    socket: "/run/xeon/xeon.sock",
    pid: 4242,
    startedAt: 1_700_000_000_000,
    token: TOKEN,
    storeId: "store-1",
    ...overrides,
  };
}

describe("service registration file", () => {
  test("writes with mode 0600 and reads back the same value", () => {
    const store = createRegistrationStore({ path: join(scratch(), "service.json") });
    expect(store.write(registration()).ok).toBe(true);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(store.read()).toEqual({ ok: true, value: registration() });
  });

  test("keeps fields it does not know across read and rewrite", () => {
    const path = join(scratch(), "service.json");
    const store = createRegistrationStore({ path });
    writeFileSync(path, JSON.stringify({ ...registration(), future: 1 }), { mode: 0o600 });
    const read = store.read();
    if (!read.ok) throw new Error("read failed");
    expect(read.value).toMatchObject({ future: 1 });
    expect(store.write({ ...read.value, pid: 5 }).ok).toBe(true);
    const text: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(text).toMatchObject({ future: 1, pid: 5 });
  });

  test("refuses to read a file whose mode is wider than 0600", () => {
    const path = join(scratch(), "service.json");
    const store = createRegistrationStore({ path });
    writeFileSync(path, JSON.stringify(registration()));
    chmodSync(path, 0o644);
    expect(store.read()).toEqual({ ok: false, error: { kind: "insecure_mode", mode: 0o644 } });
  });

  test("reports absent and malformed files as values", () => {
    const path = join(scratch(), "service.json");
    const store = createRegistrationStore({ path });
    expect(store.read()).toEqual({ ok: false, error: { kind: "absent" } });
    writeFileSync(path, "{not json", { mode: 0o600 });
    const bad = store.read();
    expect(!bad.ok && bad.error.kind).toBe("malformed");
    writeFileSync(path, JSON.stringify({ ...registration(), token: "short" }), { mode: 0o600 });
    const shortToken = store.read();
    expect(!shortToken.ok && shortToken.error.kind).toBe("malformed");
  });

  test("a rewrite replaces a widened file with a 0600 one", () => {
    const path = join(scratch(), "service.json");
    const store = createRegistrationStore({ path });
    writeFileSync(path, "{}", { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(store.write(registration()).ok).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("removeIfOwned deletes only the file with the same pid and startedAt", () => {
    const store = createRegistrationStore({ path: join(scratch(), "service.json") });
    store.write(registration());
    expect(store.removeIfOwned(9, 1_700_000_000_000)).toEqual({ ok: true, value: false });
    expect(store.removeIfOwned(4242, 1)).toEqual({ ok: true, value: false });
    expect(store.read().ok).toBe(true);
    expect(store.removeIfOwned(4242, 1_700_000_000_000)).toEqual({ ok: true, value: true });
    expect(store.read()).toEqual({ ok: false, error: { kind: "absent" } });
  });
});

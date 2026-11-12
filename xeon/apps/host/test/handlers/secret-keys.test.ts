import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// L0.secrets.spec §4.7 (b)·(e), F wire §3.3.1 secret.keyStatus·keyMove. 처리기는 실제 코드이고 열쇠 관리(`keys`)만 대역이다.
// 설정 쓰기는 `settings.write`를 기록 대역으로 바꿔 끼워 본다. identity는 없다.

const SOURCE = "l0.secrets.ageKey.source";

async function openRemote(host: ReturnType<typeof createFakeHost>) {
  const { connection } = host.connect();
  await connection.request("host.hello", {
    ...HELLO_PARAMS,
    client: { ...HELLO_PARAMS.client, origin: "remote", deviceId: "dev_0123456789abcdef" },
  });
  return connection;
}

async function openLocal(host: ReturnType<typeof createFakeHost>) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

/** 설정 쓰기를 기록한다. `failure`가 있으면 그 오류로 실패한다 */
function recordingSettings(failure?: {
  readonly kind: "file_unwritable";
  readonly path: string;
  readonly code: string;
}) {
  const writes: { scope: string; key: string; value: unknown }[] = [];
  return {
    writes,
    settings: {
      write(scope: string, key: string, value: unknown) {
        writes.push({ scope, key, value });
        if (failure !== undefined) return Promise.resolve(err(failure));
        return Promise.resolve(ok(undefined));
      },
    },
  };
}

test("secret.keyStatus reports where the key is and what the setting says, and reads nothing else", async () => {
  const host = createFakeHost();
  host.fake.secrets.keys.set({
    source: "auto",
    in: "file",
    filePath: "/cfg/secrets/age/keys.txt",
    keychainUsable: false,
    fallbackUnconfirmed: true,
    fileMissing: false,
  });
  const connection = await openLocal(host);
  expect(await connection.request("secret.keyStatus", {})).toEqual({
    source: "auto",
    in: "file",
    filePath: "/cfg/secrets/age/keys.txt",
    keychainUsable: false,
    fallbackUnconfirmed: true,
    fileMissing: false,
  });
  // 읽기 전용이다: 설정도 열쇠도 건드리지 않는다
  expect(host.fake.secrets.keys.moves).toEqual([]);
  await connection.close();
});

test("secret.keyStatus is answered on a remote connection too", async () => {
  const host = createFakeHost();
  const connection = await openRemote(host);
  const status = await connection.request("secret.keyStatus", {});
  expect(status.in).toBe("none");
  await connection.close();
});

test("secret.keyMove from this computer moves the key and writes the setting to the target", async () => {
  const writes = recordingSettings();
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  host.fake.secrets.keys.set({ source: "auto", in: "keychain" });
  const connection = await openLocal(host);
  expect(await connection.request("secret.keyMove", { to: "file" })).toEqual({
    moved: true,
    created: true,
    oldRemoved: true,
    source: "file",
  });
  expect(host.fake.secrets.keys.current()).toMatchObject({ in: "file", source: "file" });
  expect(writes.writes).toEqual([{ scope: "user", key: SOURCE, value: "file" }]);
  await connection.close();
});

test("secret.keyMove with no key to move writes the setting only, so the next add creates the key that way", async () => {
  const writes = recordingSettings();
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  const connection = await openLocal(host);
  expect(await connection.request("secret.keyMove", { to: "keychain" })).toEqual({
    moved: false,
    created: false,
    oldRemoved: false,
    source: "keychain",
  });
  expect(writes.writes).toEqual([{ scope: "user", key: SOURCE, value: "keychain" }]);
  expect(host.fake.secrets.keys.current().in).toBe("none");
  await connection.close();
});

test("secret.keyMove to the place the key already is writes the setting and moves nothing", async () => {
  const writes = recordingSettings();
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  host.fake.secrets.keys.set({ source: "auto", in: "file" });
  const connection = await openLocal(host);
  expect(await connection.request("secret.keyMove", { to: "file" })).toEqual({
    moved: false,
    created: false,
    oldRemoved: false,
    source: "file",
  });
  expect(writes.writes).toEqual([{ scope: "user", key: SOURCE, value: "file" }]);
  await connection.close();
});

test("a remote connection is refused with secret.localOnly and nothing moves or is written", async () => {
  const writes = recordingSettings();
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  host.fake.secrets.keys.set({ in: "keychain" });
  const connection = await openRemote(host);
  const failure = await rejectionOf(connection.request("secret.keyMove", { to: "file" }));
  expect(failure).toBeInstanceOf(WireError);
  if (!(failure instanceof WireError)) throw new Error("expected a wire error");
  expect(failure.code).toBe(3213);
  expect(failure.data.kind).toBe("secret.localOnly");
  expect(host.fake.secrets.keys.moves).toEqual([]);
  expect(writes.writes).toEqual([]);
  await connection.close();
});

test("a settings write that fails makes the move fail with secret.writeFailed (target settings) and the key stays put", async () => {
  const writes = recordingSettings({
    kind: "file_unwritable",
    path: "/cfg/settings.json",
    code: "EACCES",
  });
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  host.fake.secrets.keys.set({ in: "keychain" });
  const connection = await openLocal(host);
  const failure = await rejectionOf(connection.request("secret.keyMove", { to: "file" }));
  expect(failure).toBeInstanceOf(WireError);
  if (!(failure instanceof WireError)) throw new Error("expected a wire error");
  expect(failure.code).toBe(3212);
  expect(failure.data.kind).toBe("secret.writeFailed");
  expect(failure.data.details).toEqual({ target: "settings", code: "EACCES" });
  // 설정 전환이 실패해 열쇠는 옛 쪽에 그대로 있다
  expect(host.fake.secrets.keys.current().in).toBe("keychain");
  await connection.close();
});

test("a settings write that fails with no key to move is reported the same way", async () => {
  const writes = recordingSettings({
    kind: "file_unwritable",
    path: "/cfg/settings.json",
    code: "ENOSPC",
  });
  const host = createFakeHost({ overrides: { settings: writes.settings } });
  const connection = await openLocal(host);
  const failure = await rejectionOf(connection.request("secret.keyMove", { to: "file" }));
  expect(failure).toBeInstanceOf(WireError);
  if (!(failure instanceof WireError)) throw new Error("expected a wire error");
  expect(failure.data.kind).toBe("secret.writeFailed");
  expect(failure.data.details).toEqual({ target: "settings", code: "ENOSPC" });
  await connection.close();
});

import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  createFakeRemoteAdapter,
  FAKE_FINGERPRINT,
  FAKE_NOW,
  FAKE_OFF_STATUS,
  FAKE_PAIRING_TTL_MS,
} from "../../../src/app/remote/fake-remote-adapter.ts";
import type { RemoteDevice, RemoteStatus } from "../../../src/app/remote/remote-types.ts";

// 시험용 원격 접속 어댑터의 의미를 본다: 꺼짐과 켜짐 전이, 페어링 시각과 코드 주입, 해제 세 가지, 실패 주입, 호출 기록.
// 값은 `toEqual`로 비교한다.

const DEVICE_A: RemoteDevice = {
  id: "d1",
  name: "Phone",
  kind: "web",
  createdAt: 1_800_000_000_000,
  lastSeenAt: 1_800_000_100_000,
  address: "192.168.0.21",
};
const DEVICE_B: RemoteDevice = {
  id: "d2",
  name: "Studio",
  kind: "desktop",
  createdAt: 1_800_000_050_000,
  lastSeenAt: null,
  address: null,
};

const RUNNING: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: FAKE_FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

describe("fake remote adapter: start and stop", () => {
  test("it starts off and pairing is refused while off", async () => {
    const fake = createFakeRemoteAdapter();
    expect(await fake.status()).toEqual(ok(FAKE_OFF_STATUS));
    expect(await fake.pair()).toEqual(err({ kind: "remote-off" }));
  });

  test("enabling goes to starting, and only advance() moves it to running with its ports", async () => {
    const fake = createFakeRemoteAdapter();
    const starting: RemoteStatus = { ...FAKE_OFF_STATUS, enabled: true, state: "starting" };
    expect(await fake.setEnabled(true)).toEqual(ok(starting));

    // 시작 중에는 아직 코드를 내지 않는다
    expect(await fake.pair()).toEqual(err({ kind: "remote-off" }));

    fake.advance();
    expect(await fake.status()).toEqual(ok(RUNNING));
  });

  test("advance() does nothing outside starting", async () => {
    const fake = createFakeRemoteAdapter();
    fake.advance();
    expect(await fake.status()).toEqual(ok(FAKE_OFF_STATUS));
  });

  test("disabling returns to the off status", async () => {
    const fake = createFakeRemoteAdapter({ status: RUNNING });
    expect(await fake.setEnabled(false)).toEqual(ok(FAKE_OFF_STATUS));
    expect(await fake.pair()).toEqual(err({ kind: "remote-off" }));
  });
});

describe("fake remote adapter: pairing", () => {
  test("a running gateway issues the injected code, expiring after the TTL from the injected clock", async () => {
    const fake = createFakeRemoteAdapter({
      status: RUNNING,
      now: () => 5_000,
      pairingCode: () => "481920",
    });
    expect(await fake.pair()).toEqual(
      ok({ code: "481920", expiresAt: 5_000 + FAKE_PAIRING_TTL_MS }),
    );
  });

  test("without an injected clock the expiry is FAKE_NOW plus the TTL", async () => {
    const fake = createFakeRemoteAdapter({ status: RUNNING });
    const issued = await fake.pair();
    expect(issued).toEqual(ok({ code: "100001", expiresAt: FAKE_NOW + FAKE_PAIRING_TTL_MS }));
  });
});

describe("fake remote adapter: revoke", () => {
  test("revoking one id removes that device and reports one", async () => {
    const fake = createFakeRemoteAdapter({ devices: [DEVICE_A, DEVICE_B] });
    expect(await fake.revoke({ id: "d1" })).toEqual(ok({ revoked: 1 }));
    expect(await fake.devices()).toEqual(ok([DEVICE_B]));
  });

  test("an unknown id revokes nothing and changes no device", async () => {
    const fake = createFakeRemoteAdapter({ devices: [DEVICE_A, DEVICE_B] });
    expect(await fake.revoke({ id: "nope" })).toEqual(ok({ revoked: 0 }));
    expect(await fake.devices()).toEqual(ok([DEVICE_A, DEVICE_B]));
  });

  test("revoking all removes every device and reports the count", async () => {
    const fake = createFakeRemoteAdapter({ devices: [DEVICE_A, DEVICE_B] });
    expect(await fake.revoke({ all: true })).toEqual(ok({ revoked: 2 }));
    expect(await fake.devices()).toEqual(ok([]));
  });
});

describe("fake remote adapter: injected failure and recording", () => {
  test("failNext answers the next call only and leaves the state alone", async () => {
    const fake = createFakeRemoteAdapter();
    fake.failNext({ kind: "failed", message: "디스크가 가득 찼다" });
    expect(await fake.setEnabled(true)).toEqual(
      err({ kind: "failed", message: "디스크가 가득 찼다" }),
    );
    expect(await fake.status()).toEqual(ok(FAKE_OFF_STATUS));
    expect(await fake.setEnabled(true)).toEqual(
      ok({ ...FAKE_OFF_STATUS, enabled: true, state: "starting" }),
    );
  });

  test("setStatus and setDevices replace the state directly", async () => {
    const fake = createFakeRemoteAdapter();
    const failed: RemoteStatus = {
      ...FAKE_OFF_STATUS,
      enabled: true,
      state: "failed",
      error: { kind: "bind", message: "포트 사용 중" },
    };
    fake.setStatus(failed);
    fake.setDevices([DEVICE_B]);
    expect(await fake.status()).toEqual(ok(failed));
    expect(await fake.devices()).toEqual(ok([DEVICE_B]));
  });

  test("every call is recorded in order, including the one that failed", async () => {
    const fake = createFakeRemoteAdapter({ devices: [DEVICE_A] });
    fake.failNext({ kind: "bad-reply" });
    await fake.pair();
    await fake.setEnabled(true);
    await fake.revoke({ id: "d1" });
    await fake.devices();
    expect(fake.calls).toEqual([
      { method: "pair" },
      { method: "setEnabled", enabled: true },
      { method: "revoke", target: { id: "d1" } },
      { method: "devices" },
    ]);
  });
});

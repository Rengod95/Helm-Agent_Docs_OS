import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  isFingerprintHex,
  parseDevices,
  parsePairing,
  parseRevoked,
  parseStatus,
  type RemoteDevice,
  type RemoteError,
  type RemoteStatus,
} from "../../../src/app/remote/remote-types.ts";

// 원격 접속 응답의 검사. 좋은 값은 그대로 옮기고, 필드 하나의 모양이 틀리면 값 전체를 `bad-reply`로 거절한다.
// 틀린 값은 좋은 값 하나에서 필드 하나만 바꿔 만든다(표로 돌린다). 값은 `toEqual`로 비교한다.

const BAD_REPLY: RemoteError = { kind: "bad-reply" };
const BAD: Result<never, RemoteError> = err(BAD_REPLY);
const FINGERPRINT = "ab12".repeat(16);

const GOOD_STATUS: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10", "fe80::1"],
  fingerprint: FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

const GOOD_DEVICES: { readonly devices: readonly RemoteDevice[] } = {
  devices: [
    {
      id: "d1",
      name: "Chrome on Mac",
      kind: "web",
      createdAt: 1_800_000_000_000,
      lastSeenAt: 1_800_000_100_000,
      address: "192.168.0.21",
    },
    {
      id: "d2",
      name: "Studio",
      kind: "desktop",
      createdAt: 1_800_000_050_000,
      lastSeenAt: null,
      address: null,
    },
  ],
};

describe("parseStatus", () => {
  test("a good reply becomes the typed status with every field kept", () => {
    expect(parseStatus(GOOD_STATUS)).toEqual(ok(GOOD_STATUS));
  });

  test("the off reply with every nullable field empty is accepted", () => {
    const off: RemoteStatus = {
      enabled: false,
      state: "off",
      loopbackPort: null,
      tlsPort: null,
      hosts: [],
      fingerprint: null,
      certSource: null,
      pushAvailable: false,
      error: null,
    };
    expect(parseStatus(off)).toEqual(ok(off));
  });

  test("a failed status keeps the engine's error kind and message", () => {
    const failed: RemoteStatus = {
      ...GOOD_STATUS,
      state: "failed",
      error: { kind: "bind", message: "포트 사용 중" },
    };
    expect(parseStatus(failed)).toEqual(ok(failed));
  });

  const wrongFields: readonly (readonly [string, unknown])[] = [
    ["enabled", "yes"],
    ["enabled", undefined],
    ["state", "on"],
    ["state", "RUNNING"],
    ["loopbackPort", "47100"],
    ["loopbackPort", 0],
    ["loopbackPort", 1.5],
    ["tlsPort", 70000],
    ["tlsPort", -1],
    ["hosts", "192.168.0.10"],
    ["hosts", [1]],
    ["hosts", [""]],
    ["fingerprint", FINGERPRINT.toUpperCase()],
    ["fingerprint", FINGERPRINT.slice(1)],
    ["fingerprint", `${FINGERPRINT.slice(1)}g`],
    ["fingerprint", 5],
    ["certSource", "letsencrypt"],
    ["certSource", 3],
    ["pushAvailable", "yes"],
    ["error", { kind: "bind" }],
    ["error", "bind"],
    ["error", undefined],
  ];

  for (const [field, value] of wrongFields) {
    test(`rejects a reply whose ${field} is ${String(value)}`, () => {
      expect(parseStatus({ ...GOOD_STATUS, [field]: value })).toEqual(BAD);
    });
  }

  test("a reply that is not an object is rejected", () => {
    expect(parseStatus(null)).toEqual(BAD);
    expect(parseStatus("running")).toEqual(BAD);
    expect(parseStatus([])).toEqual(BAD);
  });
});

describe("parsePairing", () => {
  test("a code with its expiry is accepted as given", () => {
    expect(parsePairing({ code: "123456", expiresAt: 1_800_000_300_000 })).toEqual(
      ok({ code: "123456", expiresAt: 1_800_000_300_000 }),
    );
  });

  const wrongFields: readonly (readonly [string, unknown])[] = [
    ["code", 123456],
    ["code", ""],
    ["expiresAt", "1800000300000"],
    ["expiresAt", 1.5],
    ["expiresAt", -1],
  ];

  for (const [field, value] of wrongFields) {
    test(`rejects a pairing whose ${field} is ${String(value)}`, () => {
      expect(
        parsePairing({ code: "123456", expiresAt: 1_800_000_300_000, [field]: value }),
      ).toEqual(BAD);
    });
  }

  test("a missing field is rejected", () => {
    expect(parsePairing({ code: "123456" })).toEqual(BAD);
  });
});

describe("parseDevices", () => {
  test("a list keeps its order and the nullable fields as they are", () => {
    expect(parseDevices(GOOD_DEVICES)).toEqual(ok(GOOD_DEVICES.devices));
  });

  test("an empty list is a good reply", () => {
    expect(parseDevices({ devices: [] })).toEqual(ok([]));
  });

  const wrongItemFields: readonly (readonly [string, unknown])[] = [
    ["id", ""],
    ["id", 1],
    ["name", 1],
    ["kind", "mobile"],
    ["createdAt", "1800000000000"],
    ["createdAt", -1],
    ["lastSeenAt", "1800000100000"],
    ["lastSeenAt", 1.5],
    ["address", 5],
  ];

  for (const [field, value] of wrongItemFields) {
    test(`rejects the whole list when one device's ${field} is ${String(value)}`, () => {
      const [first, second] = GOOD_DEVICES.devices;
      const broken = { ...second, [field]: value };
      expect(parseDevices({ devices: [first, broken] })).toEqual(BAD);
    });
  }

  test("a list that is not an array, or a reply without it, is rejected", () => {
    expect(parseDevices({ devices: "d1" })).toEqual(BAD);
    expect(parseDevices({ devices: { 0: GOOD_DEVICES.devices[0] } })).toEqual(BAD);
    expect(parseDevices({})).toEqual(BAD);
    expect(parseDevices(null)).toEqual(BAD);
  });
});

describe("parseRevoked", () => {
  test("a count is accepted, zero included", () => {
    expect(parseRevoked({ revoked: 2 })).toEqual(ok({ revoked: 2 }));
    expect(parseRevoked({ revoked: 0 })).toEqual(ok({ revoked: 0 }));
  });

  const wrongValues: readonly unknown[] = ["2", -1, 1.5, null, undefined];

  for (const value of wrongValues) {
    test(`rejects a revoked count of ${String(value)}`, () => {
      expect(parseRevoked({ revoked: value })).toEqual(BAD);
    });
  }

  test("a reply without the field is rejected", () => {
    expect(parseRevoked({})).toEqual(BAD);
  });
});

describe("isFingerprintHex", () => {
  test("exactly 64 lowercase hex characters pass", () => {
    expect(isFingerprintHex(FINGERPRINT)).toBe(true);
  });

  test("uppercase, a wrong length, or a non-hex character fail", () => {
    expect(isFingerprintHex(FINGERPRINT.toUpperCase())).toBe(false);
    expect(isFingerprintHex(FINGERPRINT.slice(1))).toBe(false);
    expect(isFingerprintHex(`${FINGERPRINT}0`)).toBe(false);
    expect(isFingerprintHex(`${FINGERPRINT.slice(1)}g`)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  accessUrls,
  deviceRowOf,
  fingerprintDisplay,
  isPairingExpired,
  pairingRemainingLabel,
  pairingRemainingMs,
  serverModeOf,
  sortDevices,
  type ServerMode,
} from "../../../src/app/remote/remote-model.ts";
import type { RemoteDevice, RemoteStatus } from "../../../src/app/remote/remote-types.ts";

// 원격 접속 화면의 순수 함수를 본다. 지문 표시, 페어링 남은 시간과 라벨, 접속 주소, 서버 모드 표, 기기 줄과 정렬.
// 시각은 시험이 정한 값을 넘긴다. 값은 `toEqual`과 `toBe`로 비교한다.

const HEX = "ab12".repeat(16);
const NOW = 1_800_000_000_000;

const OFF: RemoteStatus = {
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

const RUNNING: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: HEX,
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

function deviceOf(id: string, createdAt: number, lastSeenAt: number | null): RemoteDevice {
  return { id, name: id, kind: "web", createdAt, lastSeenAt, address: null };
}

describe("fingerprintDisplay", () => {
  test("a 64-character lowercase hex string becomes uppercase pairs joined with colons", () => {
    expect(fingerprintDisplay("0123456789abcdef".repeat(4))).toBe(
      "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF",
    );
  });

  test("a value of 63 characters is not a fingerprint", () => {
    expect(fingerprintDisplay(HEX.slice(1))).toBe(null);
  });

  test("uppercase input is not a fingerprint, since the engine sends lowercase", () => {
    expect(fingerprintDisplay(HEX.toUpperCase())).toBe(null);
  });

  test("a non-hex character is not a fingerprint", () => {
    expect(fingerprintDisplay(`${HEX.slice(1)}z`)).toBe(null);
  });
});

describe("pairing countdown", () => {
  const code = { code: "481920", expiresAt: NOW + 65_000 };

  test("the remaining time counts down and never goes negative", () => {
    expect(pairingRemainingMs(code, NOW)).toBe(65_000);
    expect(pairingRemainingMs(code, NOW + 65_000)).toBe(0);
    expect(pairingRemainingMs(code, NOW + 90_000)).toBe(0);
  });

  test("the code is expired from its expiry instant on", () => {
    expect(isPairingExpired(code, NOW + 64_999)).toBe(false);
    expect(isPairingExpired(code, NOW + 65_000)).toBe(true);
  });

  test("the label is M:SS, with seconds rounded up so a live code never shows 0:00", () => {
    expect(pairingRemainingLabel(0)).toBe("0:00");
    expect(pairingRemainingLabel(65_000)).toBe("1:05");
    expect(pairingRemainingLabel(60_000)).toBe("1:00");
    expect(pairingRemainingLabel(1)).toBe("0:01");
    expect(pairingRemainingLabel(-5_000)).toBe("0:00");
  });
});

describe("accessUrls", () => {
  test("an IPv4 host gets an https URL on the TLS port, then the loopback URL", () => {
    expect(accessUrls(RUNNING)).toEqual(["https://192.168.0.10:47443", "http://127.0.0.1:47100"]);
  });

  test("an IPv6 host is bracketed, and a host already bracketed is left alone", () => {
    const status: RemoteStatus = {
      ...RUNNING,
      hosts: ["fe80::1", "[fd00::2]"],
      loopbackPort: null,
    };
    expect(accessUrls(status)).toEqual(["https://[fe80::1]:47443", "https://[fd00::2]:47443"]);
  });

  test("null ports drop their kind of URL", () => {
    expect(accessUrls({ ...RUNNING, tlsPort: null })).toEqual(["http://127.0.0.1:47100"]);
    expect(accessUrls({ ...RUNNING, loopbackPort: null })).toEqual(["https://192.168.0.10:47443"]);
  });

  test("with the gateway off there are no URLs", () => {
    expect(accessUrls(OFF)).toEqual([]);
  });
});

describe("serverModeOf", () => {
  const cases: readonly (readonly [string, RemoteStatus | null, boolean, ServerMode])[] = [
    ["no status and no service", null, false, "off"],
    ["no status, service running", null, true, "service"],
    ["gateway running, service on", RUNNING, true, "service+remote"],
    ["gateway running, service off", RUNNING, false, "service+remote"],
    ["gateway starting", { ...RUNNING, state: "starting" }, false, "service+remote"],
    ["gateway failed but enabled", { ...RUNNING, state: "failed" }, true, "service+remote"],
    ["gateway enabled flag but state off", { ...RUNNING, state: "off" }, true, "service"],
    ["gateway disabled, service on", OFF, true, "service"],
    ["gateway disabled, service off", OFF, false, "off"],
  ];

  for (const [name, status, running, mode] of cases) {
    test(name, () => {
      expect(serverModeOf(status, running)).toBe(mode);
    });
  }
});

describe("device rows", () => {
  test("a device never seen has the never kind and no time", () => {
    expect(deviceRowOf(deviceOf("a", NOW, null), NOW)).toEqual({
      id: "a",
      name: "a",
      kind: "web",
      createdAt: NOW,
      lastSeenAt: null,
      address: null,
      lastSeenKind: "never",
    });
  });

  test("seen within 60 seconds is now, and older is ago", () => {
    expect(deviceRowOf(deviceOf("a", NOW, NOW), NOW).lastSeenKind).toBe("now");
    expect(deviceRowOf(deviceOf("a", NOW, NOW - 60_000), NOW).lastSeenKind).toBe("now");
    expect(deviceRowOf(deviceOf("a", NOW, NOW - 60_001), NOW).lastSeenKind).toBe("ago");
  });
});

describe("sortDevices", () => {
  test("most recently seen first, never seen last, ties by creation newest first", () => {
    const old = deviceOf("old", NOW, NOW - 500_000);
    const recent = deviceOf("recent", NOW, NOW - 1_000);
    const neverNew = deviceOf("never-new", NOW + 2_000, null);
    const neverOld = deviceOf("never-old", NOW + 1_000, null);
    const tieOld = deviceOf("tie-old", NOW - 9_000, NOW - 1_000);
    const tieNew = deviceOf("tie-new", NOW - 3_000, NOW - 1_000);
    const sorted = sortDevices([neverOld, old, tieOld, neverNew, recent, tieNew]);
    expect(sorted.map((device) => device.id)).toEqual([
      "recent",
      "tie-new",
      "tie-old",
      "old",
      "never-new",
      "never-old",
    ]);
  });

  test("the input list is not reordered", () => {
    const input = [deviceOf("a", NOW, null), deviceOf("b", NOW, NOW)];
    sortDevices(input);
    expect(input.map((device) => device.id)).toEqual(["a", "b"]);
  });
});

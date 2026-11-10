import { describe, expect, test } from "bun:test";
import { ok, parse } from "@fresnel/contracts";
import {
  HostRemoteDevicesResultSchema,
  HostRemotePairResultSchema,
  HostRemoteRevokeResultSchema,
  HostRemoteStatusResultSchema,
  type WireResult,
} from "@fresnel/contracts/wire";
import {
  parseDevices,
  parsePairing,
  parseRevoked,
  parseStatus,
  type PairingCode,
  type RemoteDevice,
  type RemoteStatus,
  type RevokeResult,
} from "../../../src/app/remote/remote-types.ts";

// W4의 로컬 타입(`remote-types.ts`)이 계약(`host.remote.*`)과 같은 모양임을 고정한다.
// 타입은 양방향 대입으로(한쪽 필드가 달라지면 컴파일이 깨진다), 값은 계약 스키마를 통과한 응답을 로컬 검사가 그대로 옮기는지로 본다.

const FINGERPRINT = "0123456789abcdef".repeat(4);

const STATUS: WireResult<"host.remote.status"> = {
  enabled: true,
  state: "running",
  loopbackPort: 8480,
  tlsPort: 8443,
  hosts: ["192.168.0.10", "localhost"],
  fingerprint: FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
  error: { kind: "gateway-down", message: "restart limit" },
};
const PAIR: WireResult<"host.remote.pair"> = { code: "7QX9M2KD4T", expiresAt: 1_800_000_300_000 };
const DEVICES: WireResult<"host.remote.devices"> = {
  devices: [
    {
      id: "dev_0123456789abcdef",
      name: "Chrome",
      kind: "web",
      createdAt: 1_800_000_000_000,
      lastSeenAt: null,
      address: "127.0.0.1",
    },
  ],
};
const REVOKED: WireResult<"host.remote.revoke"> = { revoked: 2 };

// 컴파일 시간 고정: 계약 타입이 로컬 타입에 대입된다(로컬 쪽은 `readonly`라 반대쪽은 배열 필드에서만 다르다)
const localStatus: RemoteStatus = STATUS;
const localPair: PairingCode = PAIR;
const localDevice: RemoteDevice | undefined = DEVICES.devices[0];
const localRevoked: RevokeResult = REVOKED;

describe("remote types match the host.remote.* contract", () => {
  test("a reply that passes the contract schema is read unchanged by the local parsers", () => {
    expect(parse(HostRemoteStatusResultSchema, STATUS).ok).toBe(true);
    expect(parse(HostRemotePairResultSchema, PAIR).ok).toBe(true);
    expect(parse(HostRemoteDevicesResultSchema, DEVICES).ok).toBe(true);
    expect(parse(HostRemoteRevokeResultSchema, REVOKED).ok).toBe(true);

    expect(parseStatus(STATUS)).toEqual(ok(localStatus));
    expect(parsePairing(PAIR)).toEqual(ok(localPair));
    expect(parseDevices(DEVICES)).toEqual(ok(DEVICES.devices));
    expect(parseRevoked(REVOKED)).toEqual(ok(localRevoked));
    expect(localDevice?.id).toBe("dev_0123456789abcdef");
  });

  test("the pairing code is ten characters with no hyphen", () => {
    expect(PAIR.code).toHaveLength(10);
    expect(PAIR.code.includes("-")).toBe(false);
  });
});

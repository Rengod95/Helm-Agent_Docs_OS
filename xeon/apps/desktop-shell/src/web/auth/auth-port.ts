// `AuthPort`: 게이트웨이(W2)가 인증에 대해 아는 전부(spec §8.3, §8.4). 코드 만들기, 코드 쓰기, 토큰 검증, 기기 목록, 폐기.
// 모든 메서드는 동기이고 예상 가능한 실패는 `kind`가 있는 `Result`로 돌려준다. 토큰 원문은 `redeemPairingCode`의 응답에만 한 번 나온다.
// 로그: 실패, 잠금, 페어링, 폐기를 `logger`로 남긴다(운영 진단, 감사 기록이 아니다). 토큰과 코드 값은 싣지 않는다.
import { assertNever, err, ok, type Clock, type Logger, type Result } from "@fresnel/contracts";
import type { FileError } from "./atomic-file.ts";
import {
  cleanDeviceName,
  openDeviceStore,
  type DeviceInfo,
  type DeviceKind,
  type DeviceNameError,
  type DeviceStore,
  type DeviceStoreError,
  type VerifyError,
} from "./devices.ts";
import {
  createPairingCodes,
  type IssuedCode,
  type PairingError,
  type PairingStatus,
} from "./pairing.ts";
import { isTokenShape } from "./cookies.ts";

export interface PairedDevice {
  readonly device: DeviceInfo;
  /** 토큰 원문. 응답으로 한 번 내보내고(쿠키 또는 데스크톱 응답 본문) 버린다 */
  readonly token: string;
}

export type RedeemError = PairingError | DeviceNameError | FileError;
export type AuthVerifyError = VerifyError;
export type RevokeError = { readonly kind: "not_found" } | FileError;

export interface AuthPort {
  /** 새 페어링 코드. 쓰지 않은 이전 코드는 폐기된다 */
  createPairingCode(): IssuedCode;
  pairingStatus(): PairingStatus;
  /** 코드와 기기 이름으로 기기 토큰을 만든다(`POST /pair`). 실패 횟수와 잠금은 주소별과 전체로 센다 */
  redeemPairingCode(input: {
    readonly code: string;
    readonly deviceName: string;
    readonly kind: DeviceKind;
    readonly address: string;
  }): Result<PairedDevice, RedeemError>;
  /** 업그레이드와 요청에서 토큰을 검증한다. 성공하면 마지막 접속이 갱신된다. 토큰이 없으면 `null`을 준다 */
  verifyToken(token: string | null, address: string): Result<DeviceInfo, AuthVerifyError>;
  listDevices(): readonly DeviceInfo[];
  /** 기기 하나를 폐기한다. 열려 있는 그 기기의 연결은 `onRevoked` 구독자(게이트웨이)가 즉시 닫는다 */
  revokeDevice(id: string): Result<DeviceInfo, RevokeError>;
  revokeAllDevices(): Result<readonly DeviceInfo[], FileError>;
  /** 폐기가 끝난 뒤 불린다(기기 연결 닫기, 푸시 구독 지우기). 구독자는 던지지 않는다. 해제 함수를 돌려준다 */
  onRevoked(listener: (devices: readonly DeviceInfo[]) => void): () => void;
}

export interface AuthPortOptions {
  /** `devices.json`을 둘 폴더(예: `<origin 상태 폴더>/remote`) */
  readonly dir: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly sessionSlidingMs?: number;
  readonly sessionAbsoluteMs?: number;
  readonly pairingTtlMs?: number;
}

/** 폴더의 기기 표를 열어 `AuthPort`를 만든다. 표 파일이 손상이면 열지 않는다(조용히 비우지 않는다) */
export function createAuthPort(options: AuthPortOptions): Result<AuthPort, DeviceStoreError> {
  const log = options.logger;
  const devices: Result<DeviceStore, DeviceStoreError> = openDeviceStore({
    dir: options.dir,
    clock: options.clock,
    onBackgroundError: (error) => {
      log.warn("auth.store_write_failed", { op: error.op, path: error.path });
    },
    ...(options.randomBytes === undefined ? {} : { randomBytes: options.randomBytes }),
    ...(options.sessionSlidingMs === undefined
      ? {}
      : { sessionSlidingMs: options.sessionSlidingMs }),
    ...(options.sessionAbsoluteMs === undefined
      ? {}
      : { sessionAbsoluteMs: options.sessionAbsoluteMs }),
  });
  if (!devices.ok) return devices;
  const store = devices.value;

  const pairing = createPairingCodes({
    clock: options.clock,
    ...(options.randomBytes === undefined ? {} : { randomBytes: options.randomBytes }),
    ...(options.pairingTtlMs === undefined ? {} : { ttlMs: options.pairingTtlMs }),
  });
  pairing.onEvent((event) => {
    switch (event.kind) {
      case "failed":
        log.warn("auth.pair_failed", { address: event.address });
        return;
      case "locked":
        log.warn("auth.pair_locked", {
          address: event.address,
          scope: event.scope,
          until: event.until,
        });
        return;
      case "redeemed":
        return;
      default:
        assertNever(event, "auth-port pairing event");
    }
  });

  const listeners = new Set<(devices: readonly DeviceInfo[]) => void>();
  function notifyRevoked(revoked: readonly DeviceInfo[]): void {
    if (revoked.length === 0) return;
    for (const listener of listeners) listener(revoked);
  }

  return ok({
    createPairingCode() {
      return pairing.issue();
    },

    pairingStatus() {
      return pairing.status();
    },

    redeemPairingCode(input) {
      // 이름이 틀린 요청은 코드를 쓰지도 실패로 세지도 않는다
      const name = cleanDeviceName(input.deviceName);
      if (!name.ok) return name;
      const redeemed = pairing.redeem(input.code, input.address);
      if (!redeemed.ok) return redeemed;
      const added = store.add({ name: name.value, kind: input.kind, address: input.address });
      if (!added.ok) {
        log.error("auth.device_store_failed", { address: input.address });
        return added;
      }
      log.info("auth.device_paired", {
        deviceId: added.value.device.id,
        name: added.value.device.name,
        kind: added.value.device.kind,
        address: input.address,
      });
      return added;
    },

    verifyToken(token, address) {
      if (token === null || !isTokenShape(token)) {
        log.warn("auth.token_rejected", { address, reason: "missing_or_malformed" });
        return err({ kind: "unknown_token" });
      }
      const verified = store.verify(token, address);
      if (!verified.ok) {
        log.warn("auth.token_rejected", { address, reason: verified.error.kind });
      }
      return verified;
    },

    listDevices() {
      return store.list();
    },

    revokeDevice(id) {
      const revoked = store.revoke(id);
      if (!revoked.ok) return revoked;
      if (revoked.value === null) return err({ kind: "not_found" });
      log.info("auth.device_revoked", { deviceId: revoked.value.id, name: revoked.value.name });
      notifyRevoked([revoked.value]);
      return ok(revoked.value);
    },

    revokeAllDevices() {
      const revoked = store.revokeAll();
      if (!revoked.ok) return revoked;
      log.info("auth.devices_revoked_all", { count: revoked.value.length });
      notifyRevoked(revoked.value);
      return revoked;
    },

    onRevoked(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

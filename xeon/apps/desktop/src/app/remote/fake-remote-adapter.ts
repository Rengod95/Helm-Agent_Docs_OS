import { err, ok } from "@fresnel/contracts";
import type { RemoteAdapter } from "./remote-adapter.ts";
import type { RemoteDevice, RemoteError, RemoteStatus, RevokeTarget } from "./remote-types.ts";

// 시험용 원격 접속 어댑터. 상태와 기기 목록은 메모리에 두고, 호출은 받은 순서대로 `calls`에 쌓는다. 시각과 페어링 코드는 주입한다.
// 시작은 두 단계다. `setEnabled(true)`는 `starting`으로 두고, `advance()`가 `running`으로 넘기면서 포트와 주소를 채운다.
// `failNext`는 다음 호출 하나를 정해 둔 오류로 끝낸다.

/** 시험의 기준 시각(epoch 밀리초). 다른 시험 파일의 기준 시각과 같은 값이다 */
export const FAKE_NOW = 1_800_000_000_000;
/** 시험 페어링 코드의 유효 시간 */
export const FAKE_PAIRING_TTL_MS: number = 5 * 60_000;
/** 시험 지문. 소문자 16진수 64자다 */
export const FAKE_FINGERPRINT: string = "ab12".repeat(16);

/** 기록된 호출 한 번 */
export type RemoteCall =
  | { readonly method: "status" }
  | { readonly method: "setEnabled"; readonly enabled: boolean }
  | { readonly method: "pair" }
  | { readonly method: "devices" }
  | { readonly method: "revoke"; readonly target: RevokeTarget };

export interface FakeRemoteOptions {
  /** 현재 시각(epoch 밀리초). 페어링 만료 시각을 이것으로 정한다. 기본은 `FAKE_NOW`다 */
  readonly now?: () => number;
  /** 페어링 코드를 만드는 자리. 기본은 1부터 세는 여섯 자리 숫자다 */
  readonly pairingCode?: () => string;
  /** 처음 상태. 기본은 꺼진 상태다 */
  readonly status?: RemoteStatus;
  /** 처음 기기 목록. 기본은 빈 목록이다 */
  readonly devices?: readonly RemoteDevice[];
}

export interface FakeRemoteAdapter extends RemoteAdapter {
  /** 지금까지의 호출(받은 순서대로) */
  readonly calls: readonly RemoteCall[];
  /** 상태를 그대로 바꾼다(시험 준비용) */
  setStatus(status: RemoteStatus): void;
  /** 기기 목록을 그대로 바꾼다(시험 준비용) */
  setDevices(devices: readonly RemoteDevice[]): void;
  /** `starting`이면 `running`으로 넘긴다(포트와 주소를 채운다). 다른 상태면 아무 일도 없다 */
  advance(): void;
  /** 다음 호출 하나를 이 오류로 끝낸다. 상태와 기기 목록은 바꾸지 않는다 */
  failNext(error: RemoteError): void;
}

/** 꺼진 상태 */
export const FAKE_OFF_STATUS: RemoteStatus = {
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

/** `starting`에서 `running`으로 넘길 때 채우는 값 */
const RUNNING_FIELDS: Pick<
  RemoteStatus,
  "loopbackPort" | "tlsPort" | "hosts" | "fingerprint" | "certSource" | "pushAvailable"
> = {
  loopbackPort: 47100,
  tlsPort: 47443,
  hosts: ["192.168.0.10"],
  fingerprint: FAKE_FINGERPRINT,
  certSource: "self-signed",
  pushAvailable: true,
};

const REMOTE_OFF: RemoteError = { kind: "remote-off" };

/** 1부터 세는 여섯 자리 코드 생성기. 호출할 때마다 다음 값을 낸다 */
function sequentialPairingCodes(): () => string {
  let issued = 0;
  return () => {
    issued += 1;
    return String(100_000 + issued);
  };
}

export function createFakeRemoteAdapter(options: FakeRemoteOptions = {}): FakeRemoteAdapter {
  const now = options.now ?? (() => FAKE_NOW);
  const nextCode = options.pairingCode ?? sequentialPairingCodes();
  const log: RemoteCall[] = [];
  let current: RemoteStatus = options.status ?? FAKE_OFF_STATUS;
  let devices: readonly RemoteDevice[] = options.devices ?? [];
  let failure: RemoteError | null = null;

  /** 호출을 기록하고, 정해 둔 실패가 있으면 한 번만 꺼내 돌려준다 */
  function enter(call: RemoteCall): RemoteError | null {
    log.push(call);
    const pending = failure;
    failure = null;
    return pending;
  }

  return {
    get calls() {
      return [...log];
    },
    setStatus(next) {
      current = next;
    },
    setDevices(next) {
      devices = next;
    },
    advance() {
      if (current.state !== "starting") return;
      current = { ...current, state: "running", ...RUNNING_FIELDS };
    },
    failNext(error) {
      failure = error;
    },
    status() {
      const failed = enter({ method: "status" });
      return Promise.resolve(failed === null ? ok(current) : err(failed));
    },
    setEnabled(enabled) {
      const failed = enter({ method: "setEnabled", enabled });
      if (failed !== null) return Promise.resolve(err(failed));
      current = enabled
        ? { ...current, enabled: true, state: current.state === "running" ? "running" : "starting" }
        : FAKE_OFF_STATUS;
      return Promise.resolve(ok(current));
    },
    pair() {
      const failed = enter({ method: "pair" });
      if (failed !== null) return Promise.resolve(err(failed));
      // 원격 접속이 켜져 있고 실행 중일 때만 코드를 낸다
      if (!current.enabled || current.state !== "running") return Promise.resolve(err(REMOTE_OFF));
      return Promise.resolve(ok({ code: nextCode(), expiresAt: now() + FAKE_PAIRING_TTL_MS }));
    },
    devices() {
      const failed = enter({ method: "devices" });
      return Promise.resolve(failed === null ? ok(devices) : err(failed));
    },
    revoke(target) {
      const failed = enter({ method: "revoke", target });
      if (failed !== null) return Promise.resolve(err(failed));
      if ("all" in target) {
        const revoked = devices.length;
        devices = [];
        return Promise.resolve(ok({ revoked }));
      }
      const kept = devices.filter((device) => device.id !== target.id);
      const revoked = devices.length - kept.length;
      devices = kept;
      return Promise.resolve(ok({ revoked }));
    },
  };
}

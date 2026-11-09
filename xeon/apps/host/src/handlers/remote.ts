import { assertNever, Bug, type Result } from "@fresnel/contracts";
import {
  wireError,
  type WireError,
  type WireHandlers,
  type WireResult,
} from "@fresnel/contracts/wire";
import type { RemoteDevice, RemoteFailure, RemoteStatusView } from "../service/gateway.ts";
import { notImplemented } from "./not-implemented.ts";

// L4.remote.spec §8.3(페어링·기기 목록·폐기), §10(설정 켜기·끄기), §11(실패 대응). `host.remote.*` 다섯 메서드의 처리기다.
// 포트는 서비스가 게이트웨이 감독자와 설정 쓰기로 채운다. 서비스가 아닌 호스트(in-process, stdio)에는 포트가 없어 다섯 메서드 모두 notImplemented다.
// 원격 접속이 꺼져 있을 때 pair·devices·revoke는 `remote.off`다(F wire 5008).

/** 처리기가 쓰는 포트. 실패는 값이다(`RemoteFailure`). 처리기가 wire 오류로 옮긴다 */
export interface RemotePort {
  /** 지금 상태. 꺼져 있으면 state "off" */
  status(): RemoteStatusView;
  /** `l4.remote.web.enabled`를 쓰고 감독자를 켜거나 끈다. 켠 뒤 상태(시작 결과까지 기다린다)를 돌려준다. 설정 쓰기 실패는 store-failed다 */
  setEnabled(enabled: boolean): Promise<Result<RemoteStatusView, RemoteFailure>>;
  pair(): Promise<Result<{ readonly code: string; readonly expiresAt: number }, RemoteFailure>>;
  devices(): Promise<Result<readonly RemoteDevice[], RemoteFailure>>;
  revoke(
    target: { readonly id: string } | { readonly all: true },
  ): Promise<Result<{ readonly revoked: number }, RemoteFailure>>;
}

type RemoteMethod =
  | "host.remote.status"
  | "host.remote.setEnabled"
  | "host.remote.pair"
  | "host.remote.devices"
  | "host.remote.revoke";

export function createRemoteHandlers(
  port: RemotePort | undefined,
): Pick<WireHandlers, RemoteMethod> {
  if (port === undefined) {
    return {
      "host.remote.status": notImplemented("host.remote.status"),
      "host.remote.setEnabled": notImplemented("host.remote.setEnabled"),
      "host.remote.pair": notImplemented("host.remote.pair"),
      "host.remote.devices": notImplemented("host.remote.devices"),
      "host.remote.revoke": notImplemented("host.remote.revoke"),
    };
  }
  return {
    // 동기 던짐(포트가 아직 없을 때의 Bug)도 호출자의 async 흐름에서 거부가 된다
    "host.remote.status": () => Promise.resolve(statusOf(port.status())),
    "host.remote.setEnabled": async (params) =>
      statusOf(unwrap(await port.setEnabled(params.enabled))),
    "host.remote.pair": async () => {
      const pairing = unwrap(await port.pair());
      return { code: pairing.code, expiresAt: pairing.expiresAt };
    },
    "host.remote.devices": async () => {
      const devices = unwrap(await port.devices());
      return { devices: devices.map(deviceOf) };
    },
    "host.remote.revoke": async (params) => {
      const revoked = unwrap(
        await port.revoke("all" in params ? { all: true } : { id: params.id }),
      );
      return { revoked: revoked.revoked };
    },
  };
}

/**
 * 호출할 때마다 포트를 읽는 포트. 서비스는 엔진을 만든 뒤에 포트를 채우고, 연결은 채워진 뒤에만 열리므로
 * 읽기가 빈 값이면 호출 순서가 깨진 것이다(Bug). `read`가 없으면 포트도 없다(in-process, stdio).
 */
export function remotePortOf(
  read: (() => RemotePort | undefined) | undefined,
): RemotePort | undefined {
  if (read === undefined) return undefined;
  const current = (): RemotePort => {
    const port = read();
    if (port === undefined) throw new Bug("the remote port is used before the service wires it");
    return port;
  };
  return {
    status: () => current().status(),
    setEnabled: (enabled) => current().setEnabled(enabled),
    pair: () => current().pair(),
    devices: () => current().devices(),
    revoke: (target) => current().revoke(target),
  };
}

function statusOf(view: RemoteStatusView): WireResult<"host.remote.status"> {
  return {
    enabled: view.enabled,
    state: view.state,
    loopbackPort: view.loopbackPort,
    tlsPort: view.tlsPort,
    hosts: [...view.hosts],
    fingerprint: view.fingerprint,
    certSource: view.certSource,
    pushAvailable: view.pushAvailable,
    error: view.error === null ? null : { kind: view.error.kind, message: view.error.message },
  };
}

/** 기기 한 대. 토큰 값과 해시는 감독자의 값에 없으므로 여기서도 싣지 않는다 */
function deviceOf(device: RemoteDevice): WireResult<"host.remote.devices">["devices"][number] {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    address: device.address,
  };
}

function unwrap<T>(result: Result<T, RemoteFailure>): T {
  if (result.ok) return result.value;
  throw wireErrorOf(result.error);
}

/**
 * 감독자의 실패 값을 와이어 오류로 옮긴다(§11). 내부 실패(시한, 프로토콜, 저장)는 `internal`로 두고 값은 싣지 않는다(kind만).
 * 없는 기기는 `jsonrpc.invalidParams`의 issues로 알린다.
 */
function wireErrorOf(failure: RemoteFailure): WireError {
  switch (failure.kind) {
    case "remote-off":
      return wireError("remote.off");
    case "gateway-timeout":
      return wireError("internal", { message: "remote gateway-timeout" });
    case "gateway-protocol":
      return wireError("internal", { message: "remote gateway-protocol" });
    case "store-failed":
      return wireError("internal", { message: "remote store-failed" });
    case "not-found":
      return wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "/id", message: "not_found" }] },
      });
    default:
      return assertNever(failure, "RemoteFailure");
  }
}

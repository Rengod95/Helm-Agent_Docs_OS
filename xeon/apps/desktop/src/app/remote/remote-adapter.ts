import { err, type Result } from "@fresnel/contracts";
import type { CommandError } from "../../views/commands.ts";
import {
  parseDevices,
  parsePairing,
  parseRevoked,
  parseStatus,
  type PairingCode,
  type RemoteDevice,
  type RemoteError,
  type RemoteStatus,
  type RevokeResult,
  type RevokeTarget,
} from "./remote-types.ts";

// 원격 접속 명령의 어댑터. 요청을 보내는 자리(`RemoteRequester`)는 밖에서 받는다. 이 파일은 메서드 이름과 인자, 응답 검사,
// 오류 바꾸기만 맡는다. 계약에 `host.remote.*`가 생기면 `request`가 타입 있는 호출이 되고, 이 파일의 이름과 흐름은 그대로 남는다.

/**
 * 원격 명령을 보내는 자리. 값은 `unknown`이고 오류는 연결 명령과 같은 `CommandError`다.
 * `HostConnection.request`는 아직 닫힌 메서드 표(`WireMethodName`)만 받으므로, 이 포트를 실제 연결에 잇는 함수는
 * 계약 병합 때 넣는다(그 전에는 `as`로 잇지 않는다).
 */
export interface RemoteRequester {
  request(method: string, params: unknown): Promise<Result<unknown, CommandError>>;
}

/** 원격 접속 화면이 기대하는 동작. 화면은 이 인터페이스에만 기댄다. 실제 구현과 시험용 가짜가 둘 다 이것을 만족한다 */
export interface RemoteAdapter {
  status(): Promise<Result<RemoteStatus, RemoteError>>;
  setEnabled(enabled: boolean): Promise<Result<RemoteStatus, RemoteError>>;
  pair(): Promise<Result<PairingCode, RemoteError>>;
  devices(): Promise<Result<readonly RemoteDevice[], RemoteError>>;
  revoke(target: RevokeTarget): Promise<Result<RevokeResult, RemoteError>>;
}

/** 꺼짐을 알리는 `rejected.issue` 값. 계약이 `remote-off` wire 오류를 `errorOf`에서 이 자리로 실을 때까지의 임시 자리다 */
const REMOTE_OFF_ISSUE = "remote-off";

/** 연결 명령의 오류를 원격 접속의 오류로 바꾼다. 꺼짐만 따로 알리고 나머지는 `failed`로 모은다 */
function remoteErrorOf(error: CommandError): RemoteError {
  if (error.kind === "rejected") {
    if (error.issue === REMOTE_OFF_ISSUE) return { kind: "remote-off" };
    return { kind: "failed", message: error.detail ?? error.issue ?? null };
  }
  return { kind: "failed", message: null };
}

/** 응답을 기다려 읽는다. 요청이 실패하면 그 오류를 옮기고, 응답 모양이 틀리면 `bad-reply`다 */
async function replyOf<T>(
  request: Promise<Result<unknown, CommandError>>,
  parse: (reply: unknown) => Result<T, RemoteError>,
): Promise<Result<T, RemoteError>> {
  const reply = await request;
  if (!reply.ok) return err(remoteErrorOf(reply.error));
  return parse(reply.value);
}

/** 해제 인자. 기기 하나는 `{ id }`, 전부는 `{ all: true }`로 보낸다 */
function revokeParamsOf(target: RevokeTarget): { readonly all: true } | { readonly id: string } {
  return "all" in target ? { all: true } : { id: target.id };
}

export function createRemoteAdapter(requester: RemoteRequester): RemoteAdapter {
  return {
    status: () => replyOf(requester.request("host.remote.status", {}), parseStatus),
    setEnabled: (enabled) =>
      replyOf(requester.request("host.remote.setEnabled", { enabled }), parseStatus),
    pair: () => replyOf(requester.request("host.remote.pair", {}), parsePairing),
    devices: () => replyOf(requester.request("host.remote.devices", {}), parseDevices),
    revoke: (target) =>
      replyOf(requester.request("host.remote.revoke", revokeParamsOf(target)), parseRevoked),
  };
}

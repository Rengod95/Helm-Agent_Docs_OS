import { err, type Result } from "@fresnel/contracts";
import type { WireParams } from "@fresnel/contracts/wire";
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

/** 원격 접속 wire 메서드. 계약(`host.remote.*`)의 닫힌 표에서 이 다섯 개만 쓴다 */
type RemoteMethod =
  | "host.remote.status"
  | "host.remote.setEnabled"
  | "host.remote.pair"
  | "host.remote.devices"
  | "host.remote.revoke";

/**
 * 원격 명령을 보내는 자리. 인자는 계약 타입(`WireParams`)이고 값은 `unknown`으로 받아 어댑터가 다시 검사한다.
 * 오류는 연결 명령과 같은 `CommandError`다.
 */
export interface RemoteRequester {
  request<M extends RemoteMethod>(
    method: M,
    params: WireParams<M>,
  ): Promise<Result<unknown, CommandError>>;
}

/** 원격 접속 화면이 기대하는 동작. 화면은 이 인터페이스에만 기댄다. 실제 구현과 시험용 가짜가 둘 다 이것을 만족한다 */
export interface RemoteAdapter {
  status(): Promise<Result<RemoteStatus, RemoteError>>;
  setEnabled(enabled: boolean): Promise<Result<RemoteStatus, RemoteError>>;
  pair(): Promise<Result<PairingCode, RemoteError>>;
  devices(): Promise<Result<readonly RemoteDevice[], RemoteError>>;
  revoke(target: RevokeTarget): Promise<Result<RevokeResult, RemoteError>>;
}

/** 꺼짐을 알리는 `rejected.issue` 값. wire 오류 `remote.off`(5008)를 `errorOf`(`app/command-error.ts`)가 이 글자로 싣는다 */
const REMOTE_OFF_ISSUE = "remote-off";

/** 연결 명령의 오류를 원격 접속의 오류로 바꾼다. 꺼짐과 지원 안 함만 따로 알리고 나머지(오프라인, 시간 초과 포함)는 `failed`로 모은다 */
function remoteErrorOf(error: CommandError): RemoteError {
  if (error.kind === "unsupported") return { kind: "unsupported" };
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

import { err } from "@fresnel/contracts";
import type { CommandError } from "../../views/commands.ts";
import { createRemoteAdapter, type RemoteAdapter, type RemoteRequester } from "./remote-adapter.ts";

// ──────────────────────────────────────────────────────────────────────────────
// 계약 타입(host.remote.*)이 contracts에 들어오면 오케스트레이터가 이 파일만 typed 요청으로 바꾼다. 그 전에는 이 어댑터가 항상 지원 안 함으로 답한다
// ──────────────────────────────────────────────────────────────────────────────

/** 엔진이 모르는 메서드(-32601)와 같은 오류. 아직 연결되지 않은 원격 명령은 모두 이것으로 끝난다 */
const UNSUPPORTED: CommandError = { kind: "unsupported" };

/** 연결되지 않은 요청자. 어떤 `host.remote.*` 요청이든 `unsupported`로 답한다 */
const unavailableRequester: RemoteRequester = {
  request: () => Promise.resolve(err(UNSUPPORTED)),
};

/** 원격 접속 어댑터의 자리. 계약 병합 전까지 모든 호출이 `unsupported`로 끝난다 */
export function unavailableRemoteAdapter(): RemoteAdapter {
  return createRemoteAdapter(unavailableRequester);
}

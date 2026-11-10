import type { Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError } from "../../views/commands.ts";
import { createRemoteAdapter, type RemoteRequester } from "./remote-adapter.ts";
import type { RemoteAdapter } from "./remote-types.ts";

// 원격 접속 어댑터를 실제 연결(`HostConnection`)에 잇는다. 메서드 이름과 인자는 계약의 닫힌 표가 검사하므로 `as`가 없다.
// 오류는 `withConnection`이 `errorOf`로 바꾼다(`remote.off` 5008은 `rejected.issue: "remote-off"`, -32601은 `unsupported`).

/** 연결을 빌려 쓰는 함수. `app/commands.ts`의 `withConnection`이 이 모양이다 */
export type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** 실제 연결로 `host.remote.*`를 보내는 요청자 */
function createRemoteRequester(withConnection: WithConnection): RemoteRequester {
  return {
    request: (method, params) => withConnection((connection) => connection.request(method, params)),
  };
}

/** 원격 접속 어댑터. 연결이 없으면 `failed`, 엔진이 옛 버전이면 `unsupported`로 끝난다 */
export function remoteAdapterOf(withConnection: WithConnection): RemoteAdapter {
  return createRemoteAdapter(createRemoteRequester(withConnection));
}

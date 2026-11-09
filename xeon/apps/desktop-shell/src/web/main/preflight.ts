// 시작 전 환경 검사(종료코드 2의 원인): 서비스 소켓이 있고 붙는지, UI 폴더에 index.html이 있는지, 상태 폴더를 쓸 수 있는지.
// 여기서 실패한 것은 코드가 아니라 환경의 문제다. 경로는 싣되 토큰이나 시크릿 값은 싣지 않는다.
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";
import { errnoCode } from "../../main/lib/narrow.ts";

/** 서비스 소켓에 붙는 시험의 시간 상한 */
const SOCKET_PROBE_TIMEOUT_MS = 2_000;
/** 상태 폴더 아래에 게이트웨이 파일을 두는 하위 폴더 이름 */
const REMOTE_DIR_NAME = "remote";

export type PreflightError =
  | { readonly kind: "socket_missing"; readonly path: string }
  | { readonly kind: "socket_unreachable"; readonly path: string; readonly code: string }
  | { readonly kind: "state_dir_unusable"; readonly path: string; readonly code: string }
  | { readonly kind: "ui_missing"; readonly path: string };

/** 서비스 소켓이 있고 연결이 되는지 본다. 연결은 바로 닫는다(서비스는 아무 메시지도 받지 않는다) */
export function probeServiceSocket(socketPath: string): Promise<Result<null, PreflightError>> {
  const stat = attempt(() => statSync(socketPath));
  if (!stat.ok || !stat.value.isSocket()) {
    return Promise.resolve(err({ kind: "socket_missing", path: socketPath }));
  }
  return new Promise((resolve) => {
    const made = attempt(() => createConnection({ path: socketPath }));
    if (!made.ok) {
      resolve(
        err({
          kind: "socket_unreachable",
          path: socketPath,
          code: errnoCode(made.error.cause) ?? "UNKNOWN",
        }),
      );
      return;
    }
    const socket = made.value;
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(err({ kind: "socket_unreachable", path: socketPath, code: "ETIMEDOUT" }));
    }, SOCKET_PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok(null));
    });
    socket.once("error", (caught: Error) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(
        err({ kind: "socket_unreachable", path: socketPath, code: errnoCode(caught) ?? "UNKNOWN" }),
      );
    });
  });
}

/** UI 폴더에 `index.html`이 있는지 본다 */
export function checkUiDir(uiDir: string): Result<null, PreflightError> {
  const index = path.join(uiDir, "index.html");
  const stat = attempt(() => statSync(index));
  if (!stat.ok || !stat.value.isFile()) return err({ kind: "ui_missing", path: index });
  return ok(null);
}

/** 상태 폴더 아래 `remote`를 만들고(0700) 쓸 수 있는지 본다. 돌려주는 값은 그 폴더다 */
export function prepareStateDir(stateDir: string): Result<string, PreflightError> {
  const remote = path.join(stateDir, REMOTE_DIR_NAME);
  const made = attempt(() => {
    mkdirSync(remote, { recursive: true, mode: 0o700 });
    accessSync(remote, constants.W_OK);
  });
  if (!made.ok) {
    return err({
      kind: "state_dir_unusable",
      path: remote,
      code: errnoCode(made.error.cause) ?? "UNKNOWN",
    });
  }
  return ok(remote);
}

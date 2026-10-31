// 새 대화의 작업 폴더 입력(G2-02, L4.desktop.spec §4.16). 사이드카의 작업 디렉터리는 홈이라 폴더를 정하지 않으면
// 프로젝트 자원(`.mcp.json`, `.xeon/skills`)과 신뢰 판정이 홈 기준이 된다. 그래서 대화를 만들 때 폴더를 `thread.create`의 `workspace`로 보낸다.
// 호스트가 절대 경로이고 있는 폴더인지 확인해 정규 경로로 저장한다(L4.host-service.spec HS-76). 여기서는 보내기 전에 알 수 있는 것만 본다.

import { t } from "@xeon/client/i18n";
import { WIRE_ERRORS } from "@xeon/contracts/wire";
import type { CommandError } from "./commands.ts";

const INVALID_PARAMS = WIRE_ERRORS["jsonrpc.invalidParams"].code;

export type WorkspaceInput =
  /** 비어 있다. `workspace`를 보내지 않으면 작업 폴더가 없는 대화다 */
  | { readonly kind: "none" }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "invalid"; readonly reason: "relative" | "too_long" };

/** F `thread.create`의 workspace 상한(wire-settings `ThreadCreateParamsSchema`) */
const MAX_PATH = 4096;

/** POSIX(`/…`), Windows 드라이브(`C:\…`, `C:/…`), UNC(`\\서버\…`) 절대 경로 */
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** 입력란 글자를 보낼 값으로 읽는다. 앞뒤 공백은 지우고, 빈 글자는 "폴더 없음"이다 */
export function checkWorkspaceInput(text: string): WorkspaceInput {
  const path = text.trim();
  if (path === "") return { kind: "none" };
  if (path.length > MAX_PATH) return { kind: "invalid", reason: "too_long" };
  if (!ABSOLUTE.test(path)) return { kind: "invalid", reason: "relative" };
  return { kind: "path", path };
}

/** 입력 글자에 대해 보내기 전에 보일 안내. 문제가 없으면 null */
export function workspaceHint(input: WorkspaceInput): string | null {
  if (input.kind !== "invalid") return null;
  return input.reason === "relative"
    ? t("desktop.workspace.hint.relative")
    : t("desktop.workspace.hint.tooLong");
}

/** 새 대화를 만들지 못했을 때의 문구. 호스트가 폴더를 받아들이지 않으면(-32602) 그 이유를 말한다 */
export function createFailureText(error: CommandError, sentWorkspace: boolean): string {
  if (sentWorkspace && error.kind === "rejected" && error.code === INVALID_PARAMS) {
    return t("desktop.workspace.folderRefused");
  }
  return t("desktop.workspace.createFailed");
}

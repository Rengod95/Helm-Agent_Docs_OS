import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assertNever, attemptAsync, err, ok, type Result } from "@xeon/contracts";
import { wireError, type WireError } from "@xeon/contracts/wire";

// G2-02. 대화의 작업 폴더(`thread.started.workspace`) 규칙. 작업 폴더는 그 대화가 읽는 프로젝트 자원(`.xeon/settings.json`, `.mcp.json`,
// `.xeon/skills`, `.xeon/commands`)의 기준 폴더이고 프로젝트 신뢰 판정이 보는 폴더다(L4.host-service.spec HS-66, HS-76). 신뢰 저장소가
// 심볼릭 링크를 푼 경로를 키로 쓰므로 작업 폴더도 같은 형태로 저장해야 `trust.get`이 알려 준 폴더와 대화의 폴더가 같은 문자열이다.

/** 작업 폴더를 받아들이지 못한 이유 */
export type WorkspaceFailure =
  | { readonly kind: "not_absolute" }
  /** 폴더가 없다 */
  | { readonly kind: "not_found" }
  | { readonly kind: "not_directory" }
  /** 그 밖에 폴더를 읽을 수 없다(권한 등). `code`는 OS 오류 코드다 */
  | { readonly kind: "unreadable"; readonly code: string };

function errnoCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/**
 * `thread.create`의 `workspace`를 저장할 형태로 바꾼다: 절대 경로여야 하고, 있는 폴더여야 하며, 심볼릭 링크를 푼 정규 경로로 저장한다.
 * 상대 경로를 호스트의 작업 디렉터리 기준으로 풀지 않는다(데스크톱 사이드카의 작업 디렉터리는 홈이라 클라이언트가 보낸 뜻과 다르다)
 */
export async function canonicalWorkspace(
  workspace: string,
): Promise<Result<string, WorkspaceFailure>> {
  if (!isAbsolute(workspace)) return err({ kind: "not_absolute" });
  const real = await attemptAsync(() => realpath(workspace));
  if (!real.ok) {
    const code = errnoCode(real.error.cause);
    return code === "ENOENT" || code === "ENOTDIR"
      ? err({ kind: "not_found" })
      : err({ kind: "unreadable", code });
  }
  const info = await attemptAsync(() => stat(real.value));
  if (!info.ok) return err({ kind: "unreadable", code: errnoCode(info.error.cause) });
  return info.value.isDirectory() ? ok(real.value) : err({ kind: "not_directory" });
}

/**
 * `thread.list`의 `workspace` 필터를 저장된 값과 견줄 형태로 바꾼다. 저장된 값과 같은 규칙(정규 경로)이되, 폴더가 지금은 없어도
 * 목록은 볼 수 있어야 하므로(옮기거나 지운 프로젝트의 대화) 풀 수 없으면 `.`·`..`만 정리한 절대 경로를 쓴다
 */
export async function workspaceFilterOf(
  workspace: string,
): Promise<Result<string, { readonly kind: "not_absolute" }>> {
  if (!isAbsolute(workspace)) return err({ kind: "not_absolute" });
  const real = await attemptAsync(() => realpath(workspace));
  return ok(real.ok ? real.value : resolve(workspace));
}

/** 작업 폴더 실패를 wire 오류로 옮긴다. 폴더 경로는 `details`에 싣지 않는다(HS-56) */
export function wireErrorOfWorkspace(failure: WorkspaceFailure): WireError {
  const message = ((): string => {
    switch (failure.kind) {
      case "not_absolute":
        return "workspace must be an absolute path";
      case "not_found":
        return "workspace must be an existing directory";
      case "not_directory":
        return "workspace must be a directory";
      case "unreadable":
        return `workspace cannot be read (${failure.code.slice(0, 32)})`;
      default:
        return assertNever(failure, "WorkspaceFailure");
    }
  })();
  return wireError("jsonrpc.invalidParams", {
    details: { issues: [{ path: "workspace", message }] },
  });
}

import { attemptAsync, err, ok, type Result, type Thrown } from "@fresnel/contracts";

// 새 대화의 작업 폴더를 OS 폴더 선택 창으로 고른다(L4.desktop.spec §4.16). 창은 셸의 `pick_folder`가 띄운다.
// WebView에는 dialog 권한을 주지 않으므로 이 명령 하나만 부른다. 셸 `invoke`는 구조로만 받는다(app-roots.ts와 같은 방식).
// 운영은 main.tsx가 셸 다리의 `invoke`를 넘기고, 시험은 가짜를 넣는다.

/** `pick_folder`와 `pick_file`의 invoke 모양. 인자는 없다 */
export type FolderPickInvoke = (command: "pick_folder" | "pick_file") => Promise<unknown>;

/**
 * 폴더 선택 창을 띄운다. 고르면 절대 경로, 취소하면 `undefined`다. 명령이 던지면(창을 열지 못했다) `err`로 돌려준다.
 * 답이 글이 아니거나 빈 글이면 취소와 같다. 호출하는 쪽은 `undefined`와 `err`일 때 입력란을 그대로 둔다.
 */
export async function pickWorkspaceFolder(
  invoke: FolderPickInvoke,
): Promise<Result<string | undefined, Thrown>> {
  const reply = await attemptAsync(() => invoke("pick_folder"));
  if (!reply.ok) return err(reply.error);
  return ok(folderPathOf(reply.value));
}

function folderPathOf(reply: unknown): string | undefined {
  return typeof reply === "string" && reply !== "" ? reply : undefined;
}

/**
 * 첨부할 파일 하나를 OS 파일 선택 창으로 고른다(U-03, `pick_file`). 고르면 절대 경로, 취소하면 `undefined`다.
 * 창을 열지 못하면 `err`다. 답이 빈 글이면 취소와 같다.
 */
export async function pickAttachmentFile(
  invoke: FolderPickInvoke,
): Promise<Result<string | undefined, Thrown>> {
  const reply = await attemptAsync(() => invoke("pick_file"));
  if (!reply.ok) return err(reply.error);
  return ok(folderPathOf(reply.value));
}

import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { webFrameRoot } from "@fresnel/client/views/app";

// 웹 문서의 프레임 주소 뿌리(L4.remote.spec §6.3). 게이트웨이의 셸 명령 `view_root`가 탭 연결에 묶인 권한 토큰 경로를 준다.
// 데스크톱(`fresnel-view://`)은 이 파일을 거치지 않는다. 답은 `unknown`이라 `as` 없이 좁힌다.

export type FrameRootError = { readonly kind: "view_root_unavailable" };

/** 앱 문서가 웹 출처(http, https)에서 열렸는가. Electron은 자기 스킴으로 연다 */
export function isWebDocument(location: { readonly protocol: string }): boolean {
  return location.protocol === "http:" || location.protocol === "https:";
}

/** `view_root` 답의 `path`. 모양이 틀리면 undefined다 */
function pathOf(reply: unknown): string | undefined {
  if (typeof reply !== "object" || reply === null) return undefined;
  const value: unknown = Object.getOwnPropertyDescriptor(reply, "path")?.value;
  return typeof value === "string" ? value : undefined;
}

/** 새 권한 토큰을 받아 `<출처>/view/<토큰>/`을 만든다. 셸이 거절하거나 모양이 틀리면 `view_root_unavailable`이다 */
export async function resolveWebFrameRoot(
  invoke: (command: string) => Promise<unknown>,
  origin: string,
): Promise<Result<string, FrameRootError>> {
  const asked = await attemptAsync(() => invoke("view_root"));
  if (!asked.ok) return err({ kind: "view_root_unavailable" });
  const viewPath = pathOf(asked.value);
  const root = viewPath === undefined ? undefined : webFrameRoot(origin, viewPath);
  return root === undefined ? err({ kind: "view_root_unavailable" }) : ok(root);
}

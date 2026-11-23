import { attemptAsync } from "@fresnel/contracts";
import type { DesktopShell } from "../desktop-shell-context.ts";

/** "전체 출력" 파일을 파일 관리자에서 고른 결과. `missing`은 이 컴퓨터에 파일이 없다는 뜻이다(호스트가 다른 컴퓨터일 수 있다) */
export type RevealResult = "revealed" | "missing" | "failed";

function codeOf(reason: unknown): string | null {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return null;
}

/** 셸 명령 `reveal_path`로 전체 출력 파일을 보여 준다. 파일을 열거나 실행하지 않는다 */
export async function revealFullOutput(
  shell: Pick<DesktopShell, "invoke">,
  path: string,
): Promise<RevealResult> {
  const done = await attemptAsync(() => shell.invoke("reveal_path", { path }));
  if (done.ok) return "revealed";
  return codeOf(done.error.cause) === "not_found" ? "missing" : "failed";
}

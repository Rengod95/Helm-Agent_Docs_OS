import { attempt, attemptAsync, err, ok, type Result, type Thrown } from "@fresnel/contracts";

// 내보낸 글을 파일로 저장한다(L4.desktop.spec §3.3, L4.desktop-ux §6.31 O-13). 데스크톱은 Rust `save_file`이 운영체제 저장 창을 띄우고
// 내용을 써서 고른 절대 경로를 돌려준다. 웹(invoke가 없음)은 브라우저 내려받기로 보낸다. 시험은 가짜 invoke와 가짜 내려받기를 넣는다.

/**
 * `save_file`의 invoke 모양. 인자는 제안 이름과 내용이다. Tauri는 JS의 camelCase 키를 Rust의 snake_case 인자로 옮긴다
 * (`suggestedName` → `suggested_name`).
 */
export type FileSaveInvoke = (
  command: "save_file",
  args: { readonly suggestedName: string; readonly content: string },
) => Promise<unknown>;

/** `saved`는 파일을 썼거나(데스크톱) 내려받기를 시작했다(웹)는 뜻이다. `cancelled`는 저장 창에서 취소했다는 뜻이다 */
export type SaveOutcome = "saved" | "cancelled";

/** 브라우저 내려받기 부품. 운영은 `browserDownload`이고 시험은 가짜를 넣는다 */
export interface WebDownload {
  readonly createUrl: (blob: Blob) => string;
  readonly click: (url: string, fileName: string) => void;
  readonly release: (url: string) => void;
}

/** 내려받기가 주소를 쓰기 전에 지우면 일부 브라우저가 빈 파일을 받는다. 그래서 잠깐 뒤에 지운다 */
const RELEASE_DELAY_MS = 1_000;

const browserDownload: WebDownload = {
  createUrl: (blob) => URL.createObjectURL(blob),
  click: (url, fileName) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  },
  release: (url) => {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, RELEASE_DELAY_MS);
  },
};

/**
 * 내용을 파일로 저장한다. `invoke`가 있으면 `save_file`을 불러 저장 창의 답을 받는다: 절대 경로(저장함), `null`(취소),
 * 명령이 던지면 `err`다. `invoke`가 `null`이면(웹) 브라우저 내려받기로 보내고 `saved`를 돌려준다.
 */
export async function saveExport(
  invoke: FileSaveInvoke | null,
  name: string,
  content: string,
  download: WebDownload = browserDownload,
): Promise<Result<SaveOutcome, Thrown>> {
  if (invoke === null) return downloadExport(name, content, download);
  const reply = await attemptAsync(() => invoke("save_file", { suggestedName: name, content }));
  if (!reply.ok) return err(reply.error);
  return savedOf(reply.value);
}

/** 답이 글이면 저장함, `null`이면 취소다. 그 밖의 답은 명령 계약과 다르므로 오류로 돌려준다 */
function savedOf(reply: unknown): Result<SaveOutcome, Thrown> {
  if (reply === null) return ok("cancelled");
  if (typeof reply === "string" && reply !== "") return ok("saved");
  return err({ kind: "threw", cause: reply });
}

function downloadExport(
  name: string,
  content: string,
  download: WebDownload,
): Result<SaveOutcome, Thrown> {
  const url = attempt(() => download.createUrl(new Blob([content], { type: mimeOf(name) })));
  if (!url.ok) return err(url.error);
  const started = attempt(() => {
    download.click(url.value, name);
  });
  // 내려받기가 시작됐든 실패했든 주소는 되돌린다(실패해도 주소가 남지 않게)
  download.release(url.value);
  return started.ok ? ok("saved") : err(started.error);
}

/** 파일 이름의 확장자로 내용 종류를 고른다. 내보내기는 Markdown과 JSON뿐이고 나머지는 평문이다 */
export function mimeOf(name: string): string {
  if (name.endsWith(".json")) return "application/json;charset=utf-8";
  if (name.endsWith(".md")) return "text/markdown;charset=utf-8";
  return "text/plain;charset=utf-8";
}

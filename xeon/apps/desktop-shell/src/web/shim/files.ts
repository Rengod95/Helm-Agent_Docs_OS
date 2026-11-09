// 파일 고르기(`pick_file_read`)와 저장(`save_file`)의 브라우저 대응.
// 데스크톱의 `dialogs.ts`와 같은 답 모양을 낸다. 브라우저는 절대 경로를 알 수 없으므로 `path`는 파일 이름이다.
import type { ShimPage } from "./env.ts";
import { base64Of, bareFileName, mimeOf } from "./text.ts";
import { attempt, attemptAsync, ownField, refuse } from "./util.ts";

/** 읽는 파일의 상한(바이트, 64 MiB). 데스크톱 `PICK_READ_MAX_BYTES`와 같다 */
const PICK_READ_MAX_BYTES = 67_108_864;

/** `pick_file_read`의 답. 데스크톱 `ReadFileReply`와 같은 모양이다(`plugin-ui/backend.ts`의 `FileReadShape`) */
export interface PickedFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly encoding: "utf8" | "base64";
  readonly content: string;
}

/**
 * 파일 하나를 고르게 하고 읽는다. 고르는 창은 이 함수가 호출되는 동안(사용자 제스처 안에서) 열어야 하므로
 * `pickFile()`을 첫 `await` 전에 부른다. 취소면 `null`이다.
 */
export async function pickFileRead(page: ShimPage): Promise<PickedFile | null> {
  const picked = await attemptAsync(() => page.pickFile());
  if (!picked.ok) return refuse("dialog_unavailable");
  const file = picked.value;
  if (file === null) return null;
  if (file.size > PICK_READ_MAX_BYTES) return refuse("too-large");
  const read = await attemptAsync(() => file.arrayBuffer());
  if (!read.ok) return refuse("read_failed");
  const bytes = new Uint8Array(read.value);
  // 글(UTF-8)이면 글로, 아니면 base64 바이트로 준다. BOM은 그대로 둔다(데스크톱과 같다)
  const text = attempt(() =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
  if (text.ok) {
    return {
      name: file.name,
      path: file.name,
      size: bytes.byteLength,
      encoding: "utf8",
      content: text.value,
    };
  }
  return {
    name: file.name,
    path: file.name,
    size: bytes.byteLength,
    encoding: "base64",
    content: base64Of(bytes),
  };
}

/**
 * 내용을 파일로 내려받는다. 답은 저장한 파일 이름(글)이다. 데스크톱은 절대 경로를 준다.
 * 브라우저는 저장 위치를 모르고 취소도 알 수 없으므로 내려받기를 시작하면 저장한 것으로 본다.
 */
export function saveFile(page: ShimPage, args: unknown): Promise<string> {
  const suggested = ownField(args, "suggestedName");
  const content = ownField(args, "content");
  if (typeof suggested !== "string" || typeof content !== "string") {
    return refuse("bad-request");
  }
  const name = bareFileName(suggested);
  const saved = attempt(() => {
    page.download(name, content, mimeOf(name));
  });
  return saved.ok ? Promise.resolve(name) : refuse("write_failed");
}

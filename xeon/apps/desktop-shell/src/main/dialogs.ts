// 폴더와 파일을 고르는 창, 내보내기 저장 창(folder_pick.rs, file_save.rs). 창은 메인 프로세스가 띄우고
// 렌더러는 고른 절대 경로(취소면 null)만 받는다. 저장 창은 이름을 파일 이름 하나로 줄이고 200자로 자른다.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { attempt, attemptAsync } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";
import { ownField } from "./lib/narrow.ts";

/** 제안 이름의 글자 상한. 넘는 글자는 버린다 */
const NAME_LIMIT = 200;
/** 쓸 수 있는 이름이 남지 않을 때의 이름 */
const FALLBACK_NAME = "export.txt";
const CONTROL_CHAR = /\p{Cc}/u;

/** 고른 경로가 절대 경로면 그대로 준다. 상대 경로와 빈 문자열은 null이다(Rust `folder_path_text`) */
export function absolutePathText(picked: string): string | null {
  return path.isAbsolute(picked) ? picked : null;
}

/**
 * 제안 이름을 파일 이름 하나로 줄인다. 경로 구분자(`/`, `\`) 앞부분은 버리고(`../x`는 `x`), 제어 문자를 뺀 뒤
 * 200자로 자른다. 남는 것이 없거나 `.`, `..`이면 `export.txt`다.
 */
export function bareFileName(suggested: string): string {
  const last = suggested.split(/[\\/]/u).at(-1) ?? "";
  const kept = Array.from(last)
    .filter((char) => !CONTROL_CHAR.test(char))
    .slice(0, NAME_LIMIT)
    .join("");
  const name = kept.trim();
  return name === "" || name === "." || name === ".." ? FALLBACK_NAME : name;
}

/** 대화 상자 답을 돌려준다. 취소는 null이고, 창을 열지 못했으면 `dialog_unavailable`이다 */
async function askPath(ask: () => Promise<string | null>): Promise<string | null> {
  const answer = await attemptAsync(ask);
  if (!answer.ok) throw new ShellError("dialog_unavailable");
  return answer.value === null ? null : absolutePathText(answer.value);
}

interface SaveRequest {
  readonly suggestedName: string;
  readonly content: string;
}

function saveRequestOf(args: unknown): SaveRequest {
  const suggestedName = ownField(args, "suggestedName");
  const content = ownField(args, "content");
  if (typeof suggestedName !== "string" || typeof content !== "string") {
    throw new ShellError("bad-request");
  }
  return { suggestedName, content };
}

export const dialogsModule: ShellModule = {
  name: "dialogs",
  register(ctx) {
    ctx.handle("pick_folder", () => askPath(() => ctx.dialogs.openFolder()));
    ctx.handle("pick_file", () => askPath(() => ctx.dialogs.openFile()));
    ctx.handle("save_file", async (_caller, args) => {
      const request = saveRequestOf(args);
      const answer = await attemptAsync(() =>
        ctx.dialogs.saveFile(bareFileName(request.suggestedName)),
      );
      if (!answer.ok) throw new ShellError("dialog_unavailable");
      if (answer.value === null) return null;
      // 절대 경로가 아니면 답으로 돌려줄 수 없으니 쓰지 않는다
      const target = absolutePathText(answer.value);
      if (target === null) throw new ShellError("write_failed");
      // 같은 이름의 파일이 있으면 덮어쓴다(저장 창이 덮어쓰기를 이미 물었다)
      const written = attempt(() => {
        writeFileSync(target, request.content, "utf8");
      });
      if (!written.ok) throw new ShellError("write_failed");
      return target;
    });
  },
};

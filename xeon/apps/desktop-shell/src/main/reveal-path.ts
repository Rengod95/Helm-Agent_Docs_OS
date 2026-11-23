// 긴 출력의 "전체 출력" 파일을 OS 파일 관리자에서 보여 준다(`reveal_path`). 파일을 열거나 실행하지 않고 그 자리를 고르기만 한다
// (electron `shell.showItemInFolder`). 렌더러가 임의 경로를 보내므로 절대 경로이고, 제어 문자가 없고, 이 컴퓨터에 있는 일반 파일일 때만 한다.
// 호스트가 다른 컴퓨터면 경로가 이 컴퓨터에 없어 `not_found`로 거절한다(렌더러가 알려 준다).
import { lstatSync } from "node:fs";
import path from "node:path";
import { attempt } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";
import { ownField } from "./lib/narrow.ts";

/** 경로 길이 상한(바이트) */
export const MAX_PATH_BYTES = 4096;

/** 파일을 파일 관리자에서 고른다. 열지 않는다 */
type RevealPath = (target: string) => void;

function isRevealablePath(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  if (new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES) return false;
  if (/\p{Cc}/u.test(value)) return false;
  return path.isAbsolute(value);
}

export function createRevealPathModule(reveal: RevealPath): ShellModule {
  return {
    name: "reveal-path",
    register(ctx) {
      ctx.handle("reveal_path", (_caller, args) => {
        const target = ownField(args, "path");
        if (!isRevealablePath(target)) throw new ShellError("path_not_allowed");
        const stat = attempt(() => lstatSync(target));
        if (!stat.ok || !stat.value.isFile()) throw new ShellError("not_found");
        const shown = attempt(() => {
          reveal(target);
        });
        if (!shown.ok) throw new ShellError("open_failed");
        return Promise.resolve(null);
      });
    },
  };
}

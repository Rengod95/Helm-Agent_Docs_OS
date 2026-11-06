// 확인 줄을 거친 외부 링크를 OS 기본 브라우저로 연다(open_external.rs, ADR-0021 §3.4, §3.6.1).
// 명령은 스스로 주소를 좁힌다: http(s)만, 계정 정보 없이, 제어 문자와 공백 없이, 길이 상한(2048바이트) 안에서만 연다.
// 확인 줄은 렌더러가 띄우고 이 명령은 그 뒤에 부른다. Rust 셸과 허용 목록이 같다(mailto는 허용하지 않는다).
import { attemptAsync } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellModule } from "./context.ts";
import { ownField } from "./lib/narrow.ts";

/** 주소 길이 상한(바이트). TS `NavigateArgs`와 같다 */
export const MAX_HREF_BYTES = 2048;

/** 열어도 되는 주소인가. `http://`나 `https://`로 시작하고, 호스트가 있고, 계정 정보(`@`)가 없어야 한다 */
export function isAllowedHref(href: string): boolean {
  if (href === "" || new TextEncoder().encode(href).byteLength > MAX_HREF_BYTES) return false;
  if (/[\p{Cc}\p{White_Space}]/u.test(href)) return false;
  const rest = restAfterScheme(href);
  if (rest === null) return false;
  const [authority = ""] = rest.split(/[/?#]/u);
  return authority !== "" && !authority.includes("@");
}

function restAfterScheme(href: string): string | null {
  if (href.startsWith("https://")) return href.slice("https://".length);
  if (href.startsWith("http://")) return href.slice("http://".length);
  return null;
}

export const openExternalModule: ShellModule = {
  name: "open-external",
  register(ctx) {
    ctx.handle("open_external", async (_caller, args) => {
      const href = ownField(args, "href");
      if (typeof href !== "string" || !isAllowedHref(href)) {
        throw new ShellError("href_not_allowed");
      }
      const opened = await attemptAsync(() => ctx.openExternal(href));
      if (!opened.ok) throw new ShellError("open_failed");
      return null;
    });
  },
};

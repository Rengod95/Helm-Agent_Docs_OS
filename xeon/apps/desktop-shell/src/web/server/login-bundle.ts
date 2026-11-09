// 로그인 화면 스크립트(`src/web/static/login.ts`)를 브라우저용 IIFE 글자로 묶는다. 게이트웨이가 시작 때 한 번 묶어 `/login.js`로 낸다.
// `.js` 파일을 static 폴더에 두지 않는다. 타입 검사 밖의 `.js`는 type-aware lint를 벗어나기 때문이다(조정자 결정).
import path from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";

export type LoginBuildError =
  | { readonly kind: "build_failed"; readonly messages: readonly string[] }
  | { readonly kind: "build_threw"; readonly cause: unknown }
  | { readonly kind: "no_output" };

const ENTRY: string = path.join(import.meta.dir, "..", "static", "login.ts");

/** `login.ts`를 묶는다. 실패는 `Result` 오류다(던지지 않는다) */
export async function buildLoginSource(): Promise<Result<string, LoginBuildError>> {
  const built = await attemptAsync(() =>
    Bun.build({ entrypoints: [ENTRY], target: "browser", format: "iife", minify: true }),
  );
  if (!built.ok) return err({ kind: "build_threw", cause: built.error.cause });
  if (!built.value.success) {
    return err({
      kind: "build_failed",
      messages: built.value.logs.map((log) => log.message),
    });
  }
  const [artifact] = built.value.outputs;
  if (artifact === undefined) return err({ kind: "no_output" });
  const text = await attemptAsync(() => artifact.text());
  if (!text.ok) return err({ kind: "build_threw", cause: text.error.cause });
  return ok(text.value);
}

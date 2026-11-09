// shim 번들을 만든다(서버가 `/shell/shim.js`로 내준다). 시작할 때 한 번 만들고 메모리에 둔다.
// 이 파일은 Bun 쪽에서만 돈다. 번들 자체(`shim.ts`)는 브라우저에서 돌고 node 모듈을 가져오지 않는다.
import path from "node:path";
import { Bug } from "@fresnel/contracts";
import type { ShimSource } from "../server/ports.ts";

const ENTRY = path.join(import.meta.dir, "shim.ts");

async function bundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
  });
  // 소스가 번들되지 않는 것은 저장소 안의 불변 조건이 깨진 것이므로 버그다
  if (!built.success) {
    throw new Bug("shim bundle did not build; the browser entry is broken", {
      cause: built.logs,
    });
  }
  const [output] = built.outputs;
  if (output === undefined) {
    throw new Bug("shim bundle produced no output artifact");
  }
  return output.text();
}

let cached: Promise<string> | null = null;

/** 서버가 `ShimSource`로 받는 함수. 처음 부를 때 번들하고 같은 Promise를 돌려준다 */
export const buildShimSource: ShimSource = () => {
  cached ??= bundle();
  return cached;
};

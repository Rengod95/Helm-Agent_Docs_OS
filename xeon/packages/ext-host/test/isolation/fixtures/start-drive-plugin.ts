// 격리 주도 시작 시험의 플러그인 픽스처. 설치 때(setup) `startDrive()`를 한 번 부르고 그 값을 명령 `early`가 돌려준다.
// 명령 `start`는 입력 `{topic: "t"}`로, `bare`는 입력 없이 `startDrive`를 부른다. 결과는 한 줄 글이다.
import type { Result } from "@fresnel/contracts";
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

/** 결과 한 줄: 시작 요청이 들어갔으면 `started`, 거부면 `refused <kind>` */
function textOf(result: Result<void, { readonly kind: string }>): string {
  return result.ok ? "started" : `refused ${result.error.kind}`;
}

export const extension: ExtensionEntry = ({ register }) => {
  register("sd", {}, async (g) => {
    const host = hostOf(g);
    const early = await host.startDrive();
    host.registerCommand("early", { handler: async () => textOf(early) });
    host.registerCommand("start", {
      handler: async () => textOf(await host.startDrive({ topic: "t" })),
    });
    host.registerCommand("bare", { handler: async () => textOf(await host.startDrive()) });
  });
};

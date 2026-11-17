// 격리 사용자 대기 시험의 플러그인 픽스처. 도구 호출 전 훅이 `answer`에서는 바로 끝나는 `awaitUser`를,
// `hang`에서는 끝나지 않는 `awaitUser`를 한다(프로세스를 죽여 대기가 풀리는지 본다).
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

export const extension: ExtensionEntry = ({ register }) => {
  register("aw", {}, (g) => {
    g.on("tool.call.before", async (payload) => {
      if (payload.toolName === "answer") {
        await hostOf(g).awaitUser(() => Promise.resolve("yes"));
      }
      if (payload.toolName === "hang") {
        await hostOf(g).awaitUser(() => new Promise<void>(() => undefined));
      }
      return undefined;
    });
  });
};

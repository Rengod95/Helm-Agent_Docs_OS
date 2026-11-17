// 확장 메서드 시험의 픽스처. `ping`은 받은 인자를 그대로 돌려준다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf } from "../../../src/index.ts";

export const extension: ExtensionEntry = ({ register }) => {
  register("mt", {}, (g) => {
    hostOf(g).registerMethod("ping", { handler: async (params) => params });
  });
};

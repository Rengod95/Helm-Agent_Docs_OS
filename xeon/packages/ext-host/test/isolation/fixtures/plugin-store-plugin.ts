// 플러그인 전용 저장소 격리 시험의 픽스처. 자식 안에서 `g.pluginStore`를 부르는 메서드 셋이다.
// save는 쓰기 메서드로, load는 읽기 메서드로 값을 쓰고 읽는다. roWrite는 읽기 메서드에서 쓰기를 시도해 거부된 코드를 돌려준다.
import { toJsonValue } from "@fresnel/contracts/conversation";
import type { ExtensionEntry } from "@fresnel/contracts/extensions";
import { hostOf, PrimitiveError } from "../../../src/index.ts";

export const extension: ExtensionEntry = ({ register }) => {
  register("ps-iso", {}, (g) => {
    const api = hostOf(g);
    api.registerMethod("save", {
      handler: async (params) => {
        const value = toJsonValue(params);
        if (value === undefined) return "not_json";
        const result = await g.pluginStore.put("note.one", value);
        return result.ok ? "ok" : result.error.kind;
      },
    });
    api.registerMethod("load", {
      handler: async () => {
        const result = await g.pluginStore.get("note.one");
        return result.ok ? result.value : result.error.kind;
      },
    });
    api.registerMethod("roWrite", {
      handler: async () => {
        try {
          await g.pluginStore.put("note.two", 1);
          return "ok";
        } catch (error) {
          return error instanceof PrimitiveError ? error.code : "other";
        }
      },
    });
  });
};

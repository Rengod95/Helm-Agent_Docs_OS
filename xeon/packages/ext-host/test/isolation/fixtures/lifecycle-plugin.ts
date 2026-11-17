// 수명 시험의 픽스처. tap 훅 하나와 정리 동작 하나를 둔다. 정리 동작은 자식에서 돈다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";

export const extension: ExtensionEntry = ({ register }) => {
  register("lc", {}, (g) => {
    g.on("tool.execution.before", () => undefined);
    g.onDispose(() => undefined);
  });
};

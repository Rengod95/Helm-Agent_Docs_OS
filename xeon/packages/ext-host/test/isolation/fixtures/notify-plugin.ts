// 관찰 알림 시험의 픽스처. `request.stream` 처리기는 응답하지 않는다. 알림은 기다리지 않으므로 디스패치는 그대로 돌아와야 한다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";

export const extension: ExtensionEntry = ({ register }) => {
  register("nt", {}, (g) => {
    g.on("request.stream", () => new Promise(() => {}));
  });
};

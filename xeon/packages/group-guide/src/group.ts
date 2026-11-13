import { defineGroup, type GroupModule } from "@fresnel/group-sdk";
import { guideManifest } from "./manifest.ts";

// 스킬만 내는 그룹. 등록할 도구가 없고, 스킬 루트는 호스트가 켜짐 여부를 보고 `cap-knowledge`에 싣는다.
// 훅 하나는 그룹 선언이 비어 있지 않게 하는 자리이고 아무 일도 하지 않는다.

export function createGuideGroup(): GroupModule {
  return defineGroup({
    manifest: guideManifest,
    setup(g) {
      g.on("thread.shutdown", () => undefined);
    },
  });
}

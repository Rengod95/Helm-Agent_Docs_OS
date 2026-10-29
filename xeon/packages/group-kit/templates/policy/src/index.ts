import { defineGroup, groupManifest, type GroupModule } from "@xeon/group-kit";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };
import { settings } from "./settings.ts";

// 상태가 없는 정책 그룹이다. state를 두지 않는다.
const group: GroupModule = defineGroup({
  manifest: groupManifest(manifestJson),
  settings,
  setup(g) {
    // first 지점: 차단 결정을 낸다. 핸들러가 던지면 이 도구 호출은 거부된다(fail-closed)
    g.on("tool.call.before", (p) => {
      return g.settings().blockedTools.includes(p.toolName)
        ? { block: true, reason: "__TITLE__ 정책이 이 도구를 막았다" }
        : undefined;
    });
  },
});

export default group;

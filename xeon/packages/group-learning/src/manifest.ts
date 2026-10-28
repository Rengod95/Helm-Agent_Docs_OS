import { defineManifest } from "@xeon/contracts/extensions";
import { groupManifest, type GroupManifest } from "@xeon/group-kit";
import { learningManifestRecordKinds } from "./records.ts";

// L3.learning.spec §3.1 매니페스트. 내장 그룹, 기본 켬 [결정: D-M3-02]. drive와 post를 쓰지 않는다.

export const manifest: GroupManifest = groupManifest(
  defineManifest({
    schemaVersion: 1,
    name: "learning",
    version: "0.1.0",
    displayName: "학습",
    description: "세션에서 스킬·메모리·작업 방식 피드백 후보를 찾아 승인 대기열에 올린다",
    layer: "L3",
    kind: "group",
    entry: "./src/index.ts",
    defaultEnabled: true,
    usesDrive: false,
    usesPost: false,
    // lifecycle.agent.settled는 코어 내구 이벤트 agent.settled를 받는 지점이다(위임 주체 scope만 받는다)
    points: [
      "boundary.turn.before",
      "boundary.step.after",
      "boundary.settle.after",
      "lifecycle.agent.settled",
    ],
    requires: [
      { id: "knowledge.skills", range: "^1.0.0" },
      { id: "knowledge.memory", range: "^1.0.0" },
      { id: "knowledge.search", range: "^1.0.0" },
      { id: "knowledge.ledger", range: "^1.0.0" },
    ],
    optional: [],
    recordKinds: learningManifestRecordKinds,
    readsRecordKinds: [],
    components: { agents: ["./agents/learning-review.md"] },
    trust: { level: "builtin" },
  }),
);

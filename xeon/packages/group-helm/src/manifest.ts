import { defineManifest } from "@fresnel/contracts/extensions";
import type { GroupManifest } from "@fresnel/group-sdk";
import { helmComposition } from "./composition.ts";
import { jsonSchemaOf } from "./json-schema.ts";
import { helmMethodDecls } from "./methods.ts";
import { HELM_RECORD_KINDS } from "./records.ts";
import { helmUi } from "./ui-decl.ts";

/** 플러그인 산출물(`.fresnel-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 엔트리 경로는 번들(dist)을 가리킨다 */
export const helmManifest: GroupManifest = defineManifest({
  schemaVersion: 2,
  name: "helm",
  version: "0.1.1",
  displayName: "Helm",
  description: "탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용하는 플러그인 그룹",
  entry: "./dist/index.js",
  defaultEnabled: true,
  components: { agents: ["./agents/explorer.md"] },
  trust: { level: "user" },
  plugins: [
    {
      layer: "L3",
      drives: true,
      usesPost: true,
      hooks: [
        "input.agent.before",
        "tool.call.before",
        "tool.execution.after",
        "boundary.settle.after",
        "thread.start",
        "lifecycle.lease.rejected",
      ],
      optional: [
        { id: "web.search", range: "^1.0.0" },
        { id: "web.fetch", range: "^1.0.0" },
        { id: "knowledge.search", range: "^1.0.0" },
        { id: "knowledge.skills", range: "^1.0.0" },
        { id: "knowledge.memory", range: "^1.0.0" },
        { id: "work.tasks", range: "^1.0.0" },
      ],
      recordKinds: HELM_RECORD_KINDS.map((decl) => ({
        kind: decl.kind,
        version: decl.version,
        description: decl.description,
        payload: jsonSchemaOf(decl.payload),
      })),
      readsRecordKinds: [],
    },
  ],
  // 구성 선언은 defineGroup이 채우는 사본과 같은 객체다(index.ts). plugin.json에도 실리도록 여기에도 둔다
  group: { composition: helmComposition },
  ui: helmUi,
  methods: helmMethodDecls,
});

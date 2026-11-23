import { defineManifest } from "@fresnel/contracts/extensions";
import type { OrchestrationManifest } from "@fresnel/orchestration-sdk";
import { helmComposition } from "./composition.ts";
import { jsonSchemaOf } from "./json-schema.ts";
import { helmMethodDecls } from "./methods.ts";
import { HELM_RECORD_KINDS } from "./records.ts";
import { helmUi } from "./ui-decl.ts";

/** 플러그인 산출물(`.fresnel-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 엔트리 경로는 번들(dist)을 가리킨다 */
export const helmManifest: OrchestrationManifest = defineManifest({
  schemaVersion: 2,
  name: "helm",
  version: "0.1.3",
  displayName: "Helm",
  description: "막힌 문제를 새 관점으로 탐구하고, 모르는 분야의 지식을 지금 작업에 적용해요.",
  // 목적 한 문장(카드 `purpose`). 설명이 이미 한 문장이라 그 문장을 그대로 쓴다(plugWire, AGE-76)
  purpose: "막힌 문제를 새 관점으로 탐구하고, 모르는 분야의 지식을 지금 작업에 적용해요.",
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
  orchestration: { composition: helmComposition },
  ui: helmUi,
  methods: helmMethodDecls,
});

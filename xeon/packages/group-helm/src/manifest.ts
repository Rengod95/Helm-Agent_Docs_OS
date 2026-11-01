import type { TSchema } from "typebox";
import { defineManifest } from "@fresnel/contracts/extensions";
import type { GroupManifest } from "@fresnel/group-sdk";
import { HELM_RECORD_KINDS } from "./records.ts";

function jsonSchemaOf(schema: TSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = value;
  return out;
}

/** 플러그인 산출물(`.fresnel-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 엔트리 경로는 번들(dist)을 가리킨다 */
export const helmManifest: GroupManifest = defineManifest({
  schemaVersion: 2,
  name: "helm",
  version: "0.1.0",
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
  group: {},
});

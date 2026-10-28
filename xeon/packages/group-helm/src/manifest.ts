import type { TSchema } from "typebox";
import { defineManifest } from "@xeon/contracts/extensions";
import type { GroupManifest } from "@xeon/group-kit";
import { HELM_RECORD_KINDS } from "./records.ts";

function jsonSchemaOf(schema: TSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = value;
  return out;
}

/** 플러그인 산출물(`.xeon-plugin/plugin.json`)이 옮겨 쓰는 매니페스트 상수. 엔트리 경로는 번들(dist)을 가리킨다 */
export const helmManifest: GroupManifest = defineManifest({
  schemaVersion: 1,
  name: "helm",
  version: "0.1.0",
  displayName: "Helm",
  description: "탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용하는 의도 그룹",
  layer: "L3",
  kind: "group",
  entry: "./dist/index.js",
  defaultEnabled: true,
  usesDrive: true,
  usesPost: true,
  points: [
    "input.agent.before",
    "tool.call.before",
    "tool.execution.after",
    "boundary.settle.after",
    "session.start",
    "lifecycle.lease.rejected",
  ],
  requires: [],
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
  components: { agents: ["./agents/explorer.md"] },
  trust: { level: "user" },
});

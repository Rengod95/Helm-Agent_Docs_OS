// 이벤트 kind 접두와 테이블 접두의 소유표 코드 상수. 표의 정본은 eng.context-map.design §5.1·§5.2이고
// 표와 같은 커밋에서 고친다. 커밋 때 저장소는 생산자 id와 초안 kind 접두를 이 표로 대조한다(eng.events.design 4.1절).

export type LayerId = "F" | "X" | "L0" | "L1" | "L2" | "L3" | "L4";

export interface ContextDef {
  readonly id: string;
  readonly layer: LayerId;
  /** routes.yaml layout.<층>.domains 값. 모든 도메인은 정확히 한 컨텍스트에 */
  readonly domains: readonly string[];
  readonly producers: readonly string[];
  readonly typePrefixes: readonly string[];
  readonly tablePrefixes: readonly string[];
  readonly services: readonly string[];
}

/** eng.context-map.design §4.1 표를 코드로 옮긴 것 */
export const CONTEXTS: readonly ContextDef[] = [
  {
    id: "contracts",
    layer: "F",
    domains: ["conversation", "records", "capabilities", "extensions", "wire-settings"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: [],
  },
  {
    id: "extension-host",
    layer: "X",
    domains: ["loading-trust", "primitives", "operations"],
    producers: ["xh"],
    typePrefixes: ["scope.", "lease."],
    tablePrefixes: ["xh_"],
    services: ["xeon.ext"],
  },
  {
    id: "platform-execution",
    layer: "L0",
    domains: ["exec", "sandbox", "process"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: ["xeon.exec", "xeon.sandbox", "xeon.process"],
  },
  {
    id: "platform-secrets",
    layer: "L0",
    domains: ["secrets"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: ["xeon.secrets", "xeon.secretAdmin"],
  },
  {
    id: "platform-store",
    layer: "L0",
    domains: ["store"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: ["sys_"],
    services: ["xeon.store"],
  },
  {
    id: "platform-os",
    layer: "L0",
    domains: ["os"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: ["xeon.os"],
  },
  {
    id: "session-core",
    layer: "L1",
    domains: ["persistence"],
    producers: ["core.persistence"],
    typePrefixes: ["thread.", "checkpoint.", "settings."],
    tablePrefixes: [
      "events",
      "event_seq",
      "thread_delete_guard",
      "requests",
      "step_checkpoints",
      "consumer_cursors",
      "projector_state",
      "p_",
    ],
    services: ["xeon.session"],
  },
  {
    id: "run-engine",
    layer: "L1",
    domains: ["tasks", "loop", "context", "agents"],
    producers: ["core.tasks", "core.loop", "core.context", "core.agents"],
    typePrefixes: ["input.", "turn.", "step.", "item.", "part.", "post.", "agent."],
    tablePrefixes: [],
    services: ["xeon.tasks", "xeon.loop", "xeon.context", "xeon.agents"],
  },
  {
    id: "model-gateway",
    layer: "L1",
    domains: ["models"],
    producers: ["core.models"],
    typePrefixes: ["model."],
    tablePrefixes: ["core_models_"],
    services: ["xeon.models"],
  },
  {
    id: "tool-runtime",
    layer: "L1",
    domains: ["tools"],
    producers: ["core.tools"],
    typePrefixes: ["effect.", "approval.", "secret."],
    tablePrefixes: ["core_tools_"],
    services: ["xeon.tools", "xeon.approvals"],
  },
  {
    id: "workspace",
    layer: "L2",
    domains: ["workspace"],
    producers: ["cap.workspace"],
    typePrefixes: ["workspace."],
    tablePrefixes: ["cap_workspace_"],
    services: ["xeon.workspace"],
  },
  {
    id: "mcp",
    layer: "L2",
    domains: ["mcp"],
    producers: ["cap.mcp"],
    typePrefixes: ["mcp."],
    tablePrefixes: ["cap_mcp_"],
    services: ["xeon.mcp"],
  },
  {
    id: "web",
    layer: "L2",
    domains: ["web"],
    producers: ["cap.web"],
    typePrefixes: ["web."],
    tablePrefixes: ["cap_web_"],
    services: ["xeon.web"],
  },
  {
    id: "knowledge",
    layer: "L2",
    domains: ["knowledge"],
    producers: ["cap.knowledge"],
    typePrefixes: ["knowledge."],
    tablePrefixes: ["cap_knowledge_"],
    services: ["xeon.knowledge"],
  },
  {
    id: "work",
    layer: "L2",
    domains: ["work"],
    producers: ["cap.work"],
    typePrefixes: ["work."],
    tablePrefixes: ["cap_work_"],
    services: ["xeon.work"],
  },
  {
    id: "dialog",
    layer: "L2",
    domains: ["dialog"],
    producers: ["cap.dialog"],
    typePrefixes: ["dialog."],
    tablePrefixes: ["cap_dialog_"],
    services: ["xeon.dialog"],
  },
  {
    id: "artifacts",
    layer: "L2",
    domains: ["artifacts"],
    producers: ["cap.artifacts"],
    typePrefixes: ["artifact."],
    tablePrefixes: ["cap_artifacts_"],
    services: ["xeon.artifacts"],
  },
  {
    id: "schedule",
    layer: "L2",
    domains: ["schedule"],
    producers: ["cap.schedule"],
    typePrefixes: ["schedule."],
    tablePrefixes: ["cap_schedule_"],
    services: ["xeon.schedule"],
  },
  {
    id: "group-kit",
    layer: "L3",
    domains: ["group-kit", "slots"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: ["xeon.groups"],
  },
  {
    id: "helm",
    layer: "L3",
    domains: ["helm"],
    producers: ["ext.helm"],
    typePrefixes: ["grp.helm."],
    tablePrefixes: ["x_helm_"],
    services: [],
  },
  {
    id: "learning",
    layer: "L3",
    domains: ["learning"],
    producers: ["ext.learning"],
    typePrefixes: ["grp.learning."],
    tablePrefixes: ["x_learning_"],
    services: [],
  },
  {
    id: "clients",
    layer: "L4",
    domains: ["cli", "desktop", "settings-ui"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: [],
  },
  {
    id: "host",
    layer: "L4",
    domains: ["host-service"],
    producers: [],
    typePrefixes: [],
    tablePrefixes: [],
    services: [],
  },
];

/**
 * kind 접두(또는 kind 단위 예외) → 생산자 id. 확장 접두(`x.<extId>.`, `grp.<groupId>.`)는 이름이 열려 있어
 * 표에 두지 않고 ownerOfKind가 계산한다.
 */
export const TYPE_PREFIX_OWNERS: Readonly<Record<string, string>> = {
  "thread.": "core.persistence",
  "checkpoint.": "core.persistence",
  "settings.": "core.persistence",
  "input.": "core.tasks",
  "post.": "core.tasks",
  "turn.": "core.loop",
  "step.": "core.loop",
  "item.": "core.loop",
  "part.": "core.loop",
  "agent.": "core.agents",
  "effect.": "core.tools",
  "approval.": "core.tools",
  "secret.": "core.tools",
  "scope.": "xh",
  "lease.": "xh",
  "model.": "core.models",
  "workspace.": "cap.workspace",
  "mcp.": "cap.mcp",
  "web.": "cap.web",
  "knowledge.": "cap.knowledge",
  "work.": "cap.work",
  "dialog.": "cap.dialog",
  "artifact.": "cap.artifacts",
  "schedule.": "cap.schedule",
  // kind 단위 예외. 접두 소유보다 먼저 본다.
  /** 컴팩션을 하는 core.context가 낸다 */
  "thread.compacted": "core.context",
};

/** 접두 소유와 별개로, 복구 `recover`만 추가로 쓸 수 있는 합성 결과 kind. 조건은 L1.persistence.spec §3.9 */
export const RECOVERY_SYNTHESIS_KINDS: readonly string[] = ["effect.result", "item.recorded"];

/**
 * 테이블 접두사 또는 정확한 이름 → 컨텍스트 id (eng.context-map.design §5.2).
 * `x_<extKey>_`는 확장마다 달라 표에 두지 않고 extTablePrefix로 계산한다.
 */
export const TABLE_PREFIX_OWNERS: Readonly<Record<string, string>> = {
  sys_: "platform-store",
  events: "session-core",
  event_seq: "session-core",
  thread_delete_guard: "session-core",
  thread_creation_keys: "session-core",
  requests: "session-core",
  step_checkpoints: "session-core",
  projector_state: "session-core",
  consumer_cursors: "session-core",
  p_: "session-core",
  xh_: "extension-host",
  core_models_: "model-gateway",
  core_tools_: "tool-runtime",
  cap_workspace_: "workspace",
  cap_mcp_: "mcp",
  cap_web_: "web",
  cap_knowledge_: "knowledge",
  cap_work_: "work",
  cap_dialog_: "dialog",
  cap_artifacts_: "artifacts",
  cap_schedule_: "schedule",
};

/** 확장 id 형식. 형식 정본은 F.extensions.spec의 ExtensionName이고 이 값과 같다(review.decisions-2 U-18) */
export const EXT_ID_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";
/** 확장 id로 쓸 수 없는 예약어 */
export const RESERVED_EXT_IDS: readonly string[] = ["core", "cap", "xh", "sys", "ext"];

/** 확장 테이블 접두: x_<id의 '-'를 '_'로>_ */
export function extTablePrefix(extId: string): string {
  return `x_${extId.replaceAll("-", "_")}_`;
}

/**
 * kind의 생산자 id. 확장 접두 kind는 `ext.<id>`, 코어·도메인 kind는 kind 단위 예외 → 접두 소유 순으로 찾는다.
 * 소유자가 없으면 undefined. 순수 함수.
 */
export function ownerOfKind(kind: string): string | undefined {
  const exact = TYPE_PREFIX_OWNERS[kind];
  if (exact !== undefined) return exact;
  const parts = kind.split(".");
  if ((parts[0] === "x" || parts[0] === "grp") && parts[1] !== undefined) {
    return `ext.${parts[1]}`;
  }
  return TYPE_PREFIX_OWNERS[`${parts[0] ?? ""}.`];
}

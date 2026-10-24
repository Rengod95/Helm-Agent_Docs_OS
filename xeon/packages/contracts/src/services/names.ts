/** 서비스 이름 상수 모음. 각 파일의 <X>ServiceName과 같은 값이다(F.capabilities.spec §3.12, eng.context-map.design §5.3) */
export const SERVICE_NAMES: {
  readonly tasks: "xeon.tasks";
  readonly loop: "xeon.loop";
  readonly models: "xeon.models";
  readonly tools: "xeon.tools";
  readonly approvals: "xeon.approvals";
  readonly agents: "xeon.agents";
  readonly context: "xeon.context";
  readonly exec: "xeon.exec";
  readonly sandbox: "xeon.sandbox";
  readonly process: "xeon.process";
  readonly os: "xeon.os";
  readonly secrets: "xeon.secrets";
  readonly secretAdmin: "xeon.secretAdmin";
  readonly mcp: "xeon.mcp";
  readonly groups: "xeon.groups";
} = {
  tasks: "xeon.tasks",
  loop: "xeon.loop",
  models: "xeon.models",
  tools: "xeon.tools",
  approvals: "xeon.approvals",
  agents: "xeon.agents",
  context: "xeon.context",
  exec: "xeon.exec",
  sandbox: "xeon.sandbox",
  process: "xeon.process",
  os: "xeon.os",
  secrets: "xeon.secrets",
  secretAdmin: "xeon.secretAdmin",
  mcp: "xeon.mcp",
  groups: "xeon.groups",
};

export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];

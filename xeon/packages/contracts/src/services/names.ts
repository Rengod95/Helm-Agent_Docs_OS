/** 서비스 이름 상수 모음. 각 파일의 <X>ServiceName과 같은 값이다(F.capabilities.spec §3.12, eng.context-map.design §5.3) */
export const SERVICE_NAMES: {
  readonly tasks: "fresnel.tasks";
  readonly loop: "fresnel.loop";
  readonly models: "fresnel.models";
  readonly tools: "fresnel.tools";
  readonly approvals: "fresnel.approvals";
  readonly agents: "fresnel.agents";
  readonly context: "fresnel.context";
  readonly exec: "fresnel.exec";
  readonly sandbox: "fresnel.sandbox";
  readonly process: "fresnel.process";
  readonly os: "fresnel.os";
  readonly secrets: "fresnel.secrets";
  readonly secretAdmin: "fresnel.secretAdmin";
  readonly mcp: "fresnel.mcp";
  readonly groups: "fresnel.groups";
  readonly devkit: "fresnel.devkit";
} = {
  tasks: "fresnel.tasks",
  loop: "fresnel.loop",
  models: "fresnel.models",
  tools: "fresnel.tools",
  approvals: "fresnel.approvals",
  agents: "fresnel.agents",
  context: "fresnel.context",
  exec: "fresnel.exec",
  sandbox: "fresnel.sandbox",
  process: "fresnel.process",
  os: "fresnel.os",
  secrets: "fresnel.secrets",
  secretAdmin: "fresnel.secretAdmin",
  mcp: "fresnel.mcp",
  groups: "fresnel.groups",
  devkit: "fresnel.devkit",
};

export type ServiceName = (typeof SERVICE_NAMES)[keyof typeof SERVICE_NAMES];

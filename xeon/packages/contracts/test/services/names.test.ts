import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentServiceName,
  AgentServicePortKey,
  ApprovalServiceName,
  ApprovalServicePortKey,
  ContextPortKey,
  ContextServiceName,
  ExecPortKey,
  ExecServiceName,
  GroupServiceName,
  LoopServiceName,
  LoopServicePortKey,
  McpServiceName,
  ModelServiceName,
  ModelServicePortKey,
  OsPortKey,
  OsServiceName,
  ProcessServiceName,
  SERVICE_NAMES,
  SandboxServiceName,
  SecretAdminServiceName,
  SecretServiceName,
  SecretServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  TaskServiceName,
  TaskServicePortKey,
  ToolServiceName,
  ToolServicePortKey,
} from "../../src/services/index.ts";
import {
  LoopPortKey,
  InputQueuePortKey,
  LeaseArbiterPortKey,
  McpPortKey,
  ModelsPortKey,
  ProcessPortKey,
  ToolsPortKey,
} from "../../src/extensions/index.ts";
import { SessionServiceName, StoreServiceName } from "../../src/records/index.ts";
import { WorkspaceServiceName } from "../../src/capabilities/index.ts";

const SPEC = join(import.meta.dir, "../../../../../docs/xeon/F/capabilities/spec.md");

// 각 파일의 <X>ServiceName 리터럴 타입이 SERVICE_NAMES의 값과 같아야 컴파일된다
const CONSTANTS: typeof SERVICE_NAMES = {
  tasks: TaskServiceName,
  loop: LoopServiceName,
  models: ModelServiceName,
  tools: ToolServiceName,
  approvals: ApprovalServiceName,
  agents: AgentServiceName,
  context: ContextServiceName,
  exec: ExecServiceName,
  sandbox: SandboxServiceName,
  process: ProcessServiceName,
  os: OsServiceName,
  secrets: SecretServiceName,
  secretAdmin: SecretAdminServiceName,
  mcp: McpServiceName,
  groups: GroupServiceName,
};

describe("SERVICE_NAMES", () => {
  test("service names match", () => {
    expect(Object.keys(SERVICE_NAMES)).toHaveLength(15);
    expect({ ...SERVICE_NAMES }).toEqual(CONSTANTS);
  });

  test("every name is xeon.<name> and unique", () => {
    const values: string[] = Object.values(SERVICE_NAMES);
    for (const value of values) expect(value).toMatch(/^xeon\.[A-Za-z]+$/);
    expect(new Set(values).size).toBe(values.length);
  });

  test("names do not collide with capability services (cap:<id>)", () => {
    for (const value of Object.values(SERVICE_NAMES)) expect(value.startsWith("cap:")).toBe(false);
  });

  test("port keys use the service name of their F interface", () => {
    expect(LoopPortKey.name).toBe(SERVICE_NAMES.loop);
    expect(InputQueuePortKey.name).toBe(SERVICE_NAMES.tasks);
    expect(ToolsPortKey.name).toBe(SERVICE_NAMES.tools);
    expect(ModelsPortKey.name).toBe(SERVICE_NAMES.models);
    expect(McpPortKey.name).toBe(SERVICE_NAMES.mcp);
    expect(ProcessPortKey.name).toBe(SERVICE_NAMES.process);
    expect(LeaseArbiterPortKey.name).toBe(SERVICE_NAMES.groups);
  });

  test("full-shape service port keys carry their service name and no member", () => {
    expect(ExecPortKey).toEqual({ name: SERVICE_NAMES.exec });
    expect(OsPortKey).toEqual({ name: SERVICE_NAMES.os });
    expect(ContextPortKey).toEqual({ name: SERVICE_NAMES.context });
    expect(ModelServicePortKey).toEqual({ name: SERVICE_NAMES.models });
    expect(ModelServicePortKey.name).toBe(ModelsPortKey.name);
    // SessionService는 records가 소유해 services/session.ts가 이름을 리터럴로 적는다. 두 값이 어긋나면 여기서 잡는다
    expect(SessionPortKey).toEqual({ name: SessionServiceName });
    expect(StoreServicePortKey).toEqual({ name: StoreServiceName });
    expect(TaskServicePortKey).toEqual({ name: SERVICE_NAMES.tasks });
    expect(TaskServicePortKey.name).toBe(InputQueuePortKey.name);
    expect(ToolServicePortKey).toEqual({ name: SERVICE_NAMES.tools });
    expect(ToolServicePortKey.name).toBe(ToolsPortKey.name);
    expect(AgentServicePortKey).toEqual({ name: SERVICE_NAMES.agents });
    expect(LoopServicePortKey).toEqual({ name: SERVICE_NAMES.loop });
    expect(LoopServicePortKey.name).toBe(LoopPortKey.name);
    expect(ApprovalServicePortKey).toEqual({ name: SERVICE_NAMES.approvals });
    expect(SecretServicePortKey).toEqual({ name: SERVICE_NAMES.secrets });
  });

  test("services that records and capabilities own keep their own names", () => {
    expect(SessionServiceName).toBe("xeon.session");
    expect(StoreServiceName).toBe("xeon.store");
    expect(WorkspaceServiceName).toBe("xeon.workspace");
    const all: string[] = Object.values(SERVICE_NAMES);
    for (const other of [SessionServiceName, StoreServiceName, WorkspaceServiceName]) {
      expect(all.includes(other)).toBe(false);
    }
  });

  test.skipIf(!existsSync(SPEC))("the spec table lists the same fifteen names", () => {
    const text = readFileSync(SPEC, "utf8");
    const start = text.indexOf("| 인터페이스 | 서비스 이름 상수 |");
    const end = text.indexOf("파일별 이름.", start);
    const names = text
      .slice(start, end)
      .split("\n")
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .map((cells) => /^`(xeon\.[A-Za-z]+)`$/.exec(cells[3] ?? "")?.[1])
      .filter((name) => name !== undefined);
    expect(names).toHaveLength(15);
    expect(names.toSorted()).toEqual(Object.values(SERVICE_NAMES).toSorted());
  });
});

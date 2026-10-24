// ext-host 내장 플러그인: xeon.agents 제공, 내장 도구 agent와 차단 규칙 등록(L1.agents.plan AG-10).
// Cordis는 import하지 않는다. 서비스 등록은 hostOf(g).providePort로 한다.
import type { Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import type { LeaseHolder, LeaseToken } from "@xeon/contracts/records";
import {
  SessionPortKey,
  StoreServicePortKey,
  TaskServicePortKey,
  ToolServicePortKey,
  type AgentDefinition,
} from "@xeon/contracts/services";
import { hostOf, type ExtensionUnit } from "@xeon/ext-host";
import type { AgentsSettingsSource } from "./deps.ts";
import { AgentServicePortKey, LoopServicePortKey } from "./ports.ts";
import { createAgentService } from "./service.ts";
import { agentToolRegistration } from "./tool.ts";

export const AGENTS_EXTENSION_NAME = "core-agents";

export interface AgentsPluginOptions {
  readonly ids: IdFactory;
  readonly settings: AgentsSettingsSource;
  readonly log: Logger;
  /** 이 엔진 인스턴스의 임대 홀더. 자식 thread의 쓰기 소유를 부모와 같은 홀더로 얻는다 */
  readonly holder: LeaseHolder;
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰(조립 루트가 안다) */
  readonly parentToken: (threadId: ThreadId) => LeaseToken | undefined;
  /** 내장 정의(출처 builtin) */
  readonly builtinDefinitions?: readonly AgentDefinition[];
  readonly loadIndex?: number;
}

export function agentsManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: AGENTS_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Subagents",
    description: "Child conversations, permission ceilings and result guarding (xeon.agents).",
    defaultEnabled: true,
    layer: "L1",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다. xeon.session·tasks·tools·store 포트를 먼저 등록해 두어야 한다 */
export function agentsPlugin(options: AgentsPluginOptions): ExtensionUnit {
  const manifest = agentsManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const tasks = host.port(TaskServicePortKey);
      const tools = host.port(ToolServicePortKey);
      const store = host.port(StoreServicePortKey);
      const service = createAgentService({
        session,
        // xeon.loop는 core-loop 플러그인이 올린다. 적재 순서에 묶이지 않게 자식 turn을 돌릴 때 얻는다
        loop: () => host.port(LoopServicePortKey),
        tasks,
        tools,
        producer: session.producer("core.agents"),
        ids: options.ids,
        settings: options.settings,
        ownership: {
          parentToken: options.parentToken,
          holder: options.holder,
          leases: store.leases,
        },
        log: options.log,
      });
      for (const definition of options.builtinDefinitions ?? []) service.define(definition);
      service.syncRules();
      const registered = tools.register(agentToolRegistration(service, tasks));
      if (!registered.ok) {
        options.log.warn("agents.tool_not_registered", { reason: registered.error.kind });
      }
      host.providePort(AgentServicePortKey, service);
      g.onDispose(() => {
        if (registered.ok) registered.value();
        service.dispose();
      });
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

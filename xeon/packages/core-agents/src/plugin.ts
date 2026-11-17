// ext-host 내장 플러그인: fresnel.agents 제공, 내장 도구 agent와 차단 규칙 등록(L1.agents.plan AG-10).
// Cordis는 import하지 않는다. 서비스 등록은 hostOf(g).providePort로 한다.
import { attempt, type Logger } from "@fresnel/contracts";
import { AgentsJudge, AgentsJudgeKey } from "@fresnel/contracts/capabilities";
import type { IdFactory, ThreadId } from "@fresnel/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { LeaseHolder, LeaseToken } from "@fresnel/contracts/records";
import {
  ApprovalServicePortKey,
  ModelServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  TaskServicePortKey,
  ToolServicePortKey,
  type AgentDefinition,
} from "@fresnel/contracts/services";
import { ExtHostPortKey, hostOf, type ExtensionUnit } from "@fresnel/ext-host";
import type { AgentsLoop, AgentsSettingsSource } from "./deps.ts";
import { AgentServicePortKey, LoopServicePortKey } from "./ports.ts";
import { createAgentService } from "./service.ts";
import { coreAgentDefinitions } from "./definitions/builtin.ts";
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
  /**
   * 자식 turn을 돌리는 루프를 얻는 방법. 생략하면 `fresnel.loop` 포트를 호출 때마다 얻는다. 조립 루트가 자식 thread를 `ExtHost.openThread`로
   * 연 뒤 `runChildTurn`을 부르는 감싸개를 넣을 때 쓴다(L1.loop.spec §4.6: 경계 지점이 열린 thread를 요구한다)
   */
  readonly loop?: (resolve: () => AgentsLoop) => AgentsLoop;
  /** 내장 정의(출처 builtin) */
  readonly builtinDefinitions?: readonly AgentDefinition[];
  /** 모델에게 광고하지 않는 내부용 정의 이름(예: 학습 검토). 위임은 이름으로 계속 부를 수 있다 */
  readonly unlistedDefinitions?: readonly string[];
  readonly loadIndex?: number;
}

export function agentsManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 2,
    name: AGENTS_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Subagents",
    description: "Child conversations, permission ceilings and result guarding (fresnel.agents).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L1",
        hooks: [],
        provides: [{ id: AgentsJudge.id, version: AgentsJudge.version }],
      },
    ],
    trust: { level: "builtin" },
  });
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다. fresnel.session·tasks·tools·store 포트를 먼저 등록해 두어야 한다 */
export function agentsPlugin(options: AgentsPluginOptions): ExtensionUnit {
  const manifest = agentsManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const resolveLoop = (): AgentsLoop => host.port(LoopServicePortKey);
      const session = host.port(SessionPortKey);
      const tasks = host.port(TaskServicePortKey);
      const tools = host.port(ToolServicePortKey);
      const store = host.port(StoreServicePortKey);
      const ext = host.port(ExtHostPortKey);
      const service = createAgentService({
        session,
        // fresnel.loop는 core-loop 플러그인이 올린다. 적재 순서에 묶이지 않게 자식 turn을 돌릴 때 얻는다
        loop: () => (options.loop === undefined ? resolveLoop() : options.loop(resolveLoop)),
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
        // 서브에이전트 앞뒤 훅은 ext-host 디스패처로 발화한다. 결정 합치기(block > replace > ask)는 디스패처가 한다
        hooks: {
          spawnBefore: async (input) => {
            const outcome = await ext.dispatch("agent.spawn.before", input.payload, {
              threadId: input.payload.threadId,
              dispatchKey: input.dispatchKey,
              signal: input.signal,
            });
            return { decision: outcome.decision, extension: outcome.decidedBy?.extension ?? null };
          },
          spawnAfter: async (input) => {
            const outcome = await ext.dispatch("agent.spawn.after", input.payload, {
              threadId: input.payload.threadId,
              dispatchKey: input.dispatchKey,
              initial: input.initial,
            });
            return outcome.value;
          },
        },
        // 묻기 카드는 승인 서비스(core-tools가 올린다)의 request로 연다. 없으면 훅의 묻기는 확인 불가로 거부한다
        approvals: () => {
          const found = attempt(() => host.port(ApprovalServicePortKey));
          return found.ok ? found.value : undefined;
        },
        // fresnel.models는 core-models가 올린다. 판정 때마다 얻고, 아직 없으면 판정은 failed다(적재 순서에 묶이지 않는다)
        models: () => {
          const found = attempt(() => host.port(ModelServicePortKey));
          return found.ok ? found.value : undefined;
        },
      });
      // 코어 기본 정의를 먼저 둔다. 같은 출처끼리는 나중 등록이 이기므로 호스트가 넣은 같은 이름 정의가 덮는다
      for (const definition of coreAgentDefinitions()) service.define(definition);
      for (const definition of options.builtinDefinitions ?? []) service.define(definition);
      service.syncRules();
      const unlisted = options.unlistedDefinitions ?? [];
      let unregisterTool: (() => void) | undefined;
      const registerTool = (): void => {
        const registered = tools.register(agentToolRegistration(service, tasks, tools, unlisted));
        if (!registered.ok) {
          options.log.warn("agents.tool_not_registered", { reason: registered.error.kind });
          return;
        }
        unregisterTool = registered.value;
      };
      registerTool();
      // 정의가 바뀌면 도구 설명의 이름 목록도 바꾼다(다음 턴 광고에 반영)
      const stopWatching = service.onDefinitionsChange(() => {
        unregisterTool?.();
        unregisterTool = undefined;
        registerTool();
      });
      host.providePort(AgentServicePortKey, service);
      // 공개 기능 `agents.judge`(hooks-core-boundary §6.2). 서비스 메서드를 그대로 넘긴다. 실패는 값(`capped`, `failed`)으로 온다
      host.provide(AgentsJudgeKey, { judge: (input) => service.judge(input) });
      g.onDispose(() => {
        stopWatching();
        unregisterTool?.();
        service.dispose();
      });
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}

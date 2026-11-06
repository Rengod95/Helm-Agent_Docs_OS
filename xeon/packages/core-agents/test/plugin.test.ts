import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { PortKey } from "@fresnel/contracts/extensions";
import type { StoreService } from "@fresnel/contracts/records";
import { createTestHost } from "@fresnel/ext-host/testing";
import {
  AGENTS_RULE_SOURCE,
  AgentServicePortKey,
  agentsPlugin,
  createStaticAgentsSettings,
  type AgentsLoop,
  type AgentsSession,
  type AgentsTasks,
  type AgentsTools,
} from "../src/index.ts";
import { fakeChildLoop } from "../src/testing/index.ts";
import { fakeSession } from "./support/fake-session.ts";
import { fakeTasks } from "./support/fake-tasks.ts";
import { fakeTools } from "./support/fake-tools.ts";
import { EXPLORER, HOLDER, NOOP_LOG } from "./support/harness.ts";
import { fixedIdFactory } from "./support/ids.ts";

// F의 서비스 전체 모양 키 대신 이 패키지가 쓰는 부분형 키를 같은 이름으로 만든다(대역이 전체 모양을 채우지 않는다)
const SESSION: PortKey<AgentsSession> = { name: "fresnel.session" };
const TASKS: PortKey<AgentsTasks> = { name: "fresnel.tasks" };
const TOOLS: PortKey<AgentsTools> = { name: "fresnel.tools" };
const LOOP: PortKey<AgentsLoop> = { name: "fresnel.loop" };
const STORE: PortKey<Pick<StoreService, "leases">> = { name: "fresnel.store" };

test("the plugin provides fresnel.agents, registers the agent tool and the deny rules, and runs a spawn end to end", async () => {
  const ids = fixedIdFactory();
  const session = fakeSession(ids);
  const tasks = fakeTasks({ producer: session.producer("core.tasks"), ids });
  const tools = fakeTools();
  const loop = fakeChildLoop({
    ids,
    run: (request) =>
      Promise.resolve({
        status: "completed",
        finalItemId: session.seedAssistantItem(request.threadId, "from the plugin"),
      }),
  });
  const host = await createTestHost({ without: ["records", "queue", "loop"] });
  await host.host.registerPlatform({
    name: "test-services",
    setup(ctx) {
      ctx.providePort(SESSION, session);
      ctx.providePort(TASKS, tasks);
      ctx.providePort(TOOLS, tools);
      ctx.providePort(STORE, {
        leases: {
          acquire: (resource, holder) => ok({ resource, holderId: holder.holderId, epoch: 1 }),
          renew: () => ok(undefined),
          release: () => ok(undefined),
          holds: () => ok(true),
          keepAlive: () => ({ [Symbol.dispose]: () => {} }),
          inspect: () => ok(null),
        },
      });
      ctx.providePort(LOOP, loop);
    },
  });
  const installed = await host.host.install(
    agentsPlugin({
      ids,
      settings: createStaticAgentsSettings(),
      log: NOOP_LOG,
      holder: HOLDER,
      parentToken: (threadId) => session.tokenOf(threadId),
      builtinDefinitions: [
        EXPLORER,
        { ...EXPLORER, name: "learning-review", description: "internal" },
      ],
      unlistedDefinitions: ["learning-review"],
    }),
  );
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);

  const service = host.host.ports.get(AgentServicePortKey);
  expect(service?.definitions().map((definition) => definition.name)).toEqual([
    "explore",
    "explorer",
    "general",
    "learning-review",
  ]);
  expect(service?.definition("explore")).toMatchObject({
    source: { kind: "builtin" },
    tools: ["read", "ls", "grep", "find"],
  });
  expect(service?.definition("general")?.tools).toBeUndefined();
  const description = tools.directTool("agent")?.tool.description ?? "";
  expect(description).toContain("- general: General-purpose worker");
  expect(description).toContain("- explore: Read-only explorer");
  expect(description).toContain("- explorer:");
  expect(description).not.toContain("learning-review");
  // 정의가 바뀌면 다음 광고의 설명에 바로 반영된다
  const undefine = service?.define({ ...EXPLORER, name: "late-one", description: "added later" });
  expect(tools.directTool("agent")?.tool.description).toContain("- late-one: added later");
  expect(tools.registered.filter((entry) => entry.kind === "direct")).toHaveLength(1);
  undefine?.();
  expect(tools.directTool("agent")?.tool.description).not.toContain("late-one");
  expect((tools.rules.get(AGENTS_RULE_SOURCE) ?? []).length).toBe(4);

  const parent = ids.next("thr");
  session.threads.create({ threadId: parent });
  const result = await service?.spawn(
    { agent: "explorer", task: "t" },
    {
      parentThreadId: parent,
      owner: { kind: "scope", scopeId: "helm" },
      caller: "main",
      depth: 0,
      ownerRequestId: "helm:inq-1",
      signal: new AbortController().signal,
    },
  );
  expect(result?.status).toBe("completed");
  expect(result?.answer).toContain("from the plugin");
});

import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import {
  defineManifest,
  type AgentSpawnBeforeDecision,
  type PortKey,
} from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { StoreService } from "@fresnel/contracts/records";
import type {
  ApprovalService,
  AgentService,
  SpawnOrigin,
  SpawnResult,
} from "@fresnel/contracts/services";
import type { ExtensionUnit } from "@fresnel/ext-host";
import { createTestHost } from "@fresnel/ext-host/testing";
import {
  AgentServicePortKey,
  agentsPlugin,
  createStaticAgentsSettings,
  type AgentsLoop,
  type AgentsSession,
  type AgentsTasks,
  type AgentsTools,
} from "../src/index.ts";
import { fakeChildLoop } from "../src/testing/index.ts";
import { fakeApprovals, type FakeApprovals } from "./support/fake-approvals.ts";
import { fakeSession } from "./support/fake-session.ts";
import { fakeTasks } from "./support/fake-tasks.ts";
import { fakeTools } from "./support/fake-tools.ts";
import { HOLDER, NOOP_LOG } from "./support/harness.ts";
import { fixedIdFactory } from "./support/ids.ts";

// 실제 ext-host 디스패처로 훅 확장을 올린 시험. 여러 확장의 앞 결정이 합쳐지고(H-2), 카드의 출처가 확장 이름으로 남고,
// 뒤 훅의 보고 고치기가 실제 chain 병합 규칙을 거친다.

// 이 패키지가 쓰는 포트를 같은 이름으로 부분형 키로 만든다(plugin.test.ts와 같다)
const SESSION: PortKey<AgentsSession> = { name: "fresnel.session" };
const TASKS: PortKey<AgentsTasks> = { name: "fresnel.tasks" };
const TOOLS: PortKey<AgentsTools> = { name: "fresnel.tools" };
const LOOP: PortKey<AgentsLoop> = { name: "fresnel.loop" };
const STORE: PortKey<Pick<StoreService, "leases">> = { name: "fresnel.store" };
const APPROVALS: PortKey<Pick<ApprovalService, "request">> = { name: "fresnel.approvals" };

function beforeHookUnit(
  name: string,
  loadIndex: number,
  decision: AgentSpawnBeforeDecision,
): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name,
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [{ layer: "L1", hooks: ["agent.spawn.before"] }],
    trust: { level: "builtin" },
  });
  return {
    manifest,
    entry: ({ manifest: loaded, register }) => {
      register(loaded.name, { defaultEnabled: true }, (g) => {
        g.on("agent.spawn.before", () => decision);
      });
    },
    loadIndex,
    builtin: true,
  };
}

function afterPatchUnit(name: string, loadIndex: number, reportText: string): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name,
    version: "0.1.0",
    entry: "./src/index.ts",
    plugins: [{ layer: "L1", hooks: ["agent.spawn.after"] }],
    trust: { level: "builtin" },
  });
  return {
    manifest,
    entry: ({ manifest: loaded, register }) => {
      register(loaded.name, { defaultEnabled: true }, (g) => {
        g.on("agent.spawn.after", () => ({ reportText }));
      });
    },
    loadIndex,
    builtin: true,
  };
}

interface Booted {
  readonly service: AgentService;
  readonly approvals: FakeApprovals;
  readonly parentThreadId: ThreadId;
  readonly origin: SpawnOrigin;
}

async function boot(units: readonly ExtensionUnit[]): Promise<Booted> {
  const ids = fixedIdFactory();
  const session = fakeSession(ids);
  const tasks = fakeTasks({ producer: session.producer("core.tasks"), ids });
  const tools = fakeTools();
  const approvals = fakeApprovals();
  const loop = fakeChildLoop({
    ids,
    run: (request) =>
      Promise.resolve({
        status: "completed",
        finalItemId: session.seedAssistantItem(request.threadId, "found it"),
      }),
  });
  const host = await createTestHost({ without: ["records", "queue", "loop"] });
  await host.host.registerPlatform({
    name: "test-services",
    setup(ctx) {
      ctx.providePort(SESSION, session);
      ctx.providePort(TASKS, tasks);
      ctx.providePort(TOOLS, tools);
      ctx.providePort(LOOP, loop);
      ctx.providePort(APPROVALS, approvals);
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
    },
  });
  await host.host.install(
    agentsPlugin({
      ids,
      settings: createStaticAgentsSettings(),
      log: NOOP_LOG,
      holder: HOLDER,
      parentToken: (threadId) => session.tokenOf(threadId),
    }),
  );
  // 설치는 순서대로 한다(적재 순서가 핸들러 순서를 정한다)
  await units.reduce<Promise<unknown>>(
    (previous, unit) => previous.then(() => host.host.install(unit)),
    Promise.resolve(),
  );
  const service = host.host.ports.get(AgentServicePortKey);
  if (service === undefined) throw new Error("fresnel.agents is not provided");
  const parentThreadId = ids.next("thr");
  session.threads.create({ threadId: parentThreadId });
  return {
    service,
    approvals,
    parentThreadId,
    origin: {
      parentThreadId,
      owner: { kind: "scope", scopeId: "helm" },
      caller: "main",
      depth: 0,
      ownerRequestId: "helm:inq-1",
      signal: new AbortController().signal,
    },
  };
}

function spawnOnce(booted: Booted, requestId: string): Promise<SpawnResult> {
  return booted.service.spawn({ agent: "general", task: "t", requestId }, booted.origin);
}

describe("two hook extensions on agent.spawn.before, through the real dispatcher", () => {
  test("an ask from one and a block from another merge to block: refused, and no card opens", async () => {
    const booted = await boot([
      beforeHookUnit("guard-ask", 1, { ask: true, reason: "check first" }),
      beforeHookUnit("policy-block", 2, { block: true, reason: "not today" }),
    ]);
    const result = await spawnOnce(booted, "merge-1");
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] not today",
    );
    expect(booted.approvals.requests).toHaveLength(0);
  });

  test("an ask alone opens one card whose ruleId and askedBy name the extension that asked", async () => {
    const booted = await boot([
      beforeHookUnit("guard-ask", 1, { ask: true, reason: "check first" }),
    ]);
    const result = await spawnOnce(booted, "ask-1");
    expect(result.status).toBe("completed");
    expect(booted.approvals.requests).toHaveLength(1);
    expect(booted.approvals.requests[0]?.body).toMatchObject({
      kind: "tool",
      tool: {
        toolName: "agent",
        ruleId: "hook:guard-ask",
        askedBy: { extension: "guard-ask", reason: "check first" },
      },
    });
  });
});

describe("agent.spawn.after through the real chain merge", () => {
  test("a patch from an extension is capped to 60,000 characters and marked truncated", async () => {
    const booted = await boot([afterPatchUnit("report-patch", 1, "y".repeat(70_000))]);
    const result = await spawnOnce(booted, "patch-1");
    expect(result.status).toBe("completed");
    expect(result.report?.text).toHaveLength(60_000);
    expect(result.report?.truncated).toBe(true);
  });

  test("a patch from an extension replaces the reported text, and the status stays completed", async () => {
    const booted = await boot([afterPatchUnit("report-patch", 1, "rewritten by extension")]);
    const result = await spawnOnce(booted, "patch-2");
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("rewritten by extension");
    expect(result.answer).not.toContain("found it");
  });
});

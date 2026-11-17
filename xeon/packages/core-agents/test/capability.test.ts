import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import {
  AgentsJudge,
  AgentsJudgeKey,
  validateCapability,
  type CapabilityApi,
} from "@fresnel/contracts/capabilities";
import {
  defineManifest,
  pluginDeclsOf,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
} from "@fresnel/contracts/extensions";
import type { JudgeInput, JudgeOutcome } from "@fresnel/contracts/services";
import { ModelServiceName } from "@fresnel/contracts/services";
import { StoreServiceName, type StoreService } from "@fresnel/contracts/records";
import { createTestHost } from "@fresnel/ext-host/testing";
import {
  AgentServicePortKey,
  agentsManifest,
  agentsPlugin,
  createStaticAgentsSettings,
  type AgentsLoop,
  type AgentsSession,
  type AgentsTasks,
  type AgentsTools,
} from "../src/index.ts";
import { fakeChildLoop } from "../src/testing/index.ts";
import { fakeModels, type FakeModels, type FakeReply } from "./support/fake-models.ts";
import { fakeSession, type FakeSession } from "./support/fake-session.ts";
import { fakeTasks } from "./support/fake-tasks.ts";
import { fakeTools } from "./support/fake-tools.ts";
import { HOLDER, NOOP_LOG } from "./support/harness.ts";
import { fixedIdFactory } from "./support/ids.ts";

type FixedIds = ReturnType<typeof fixedIdFactory>;

// hooks-core-boundary §6.2 D-30. 공개 기능 `agents.judge`는 `AgentService.judge`를 그대로 넘긴다. 같은 입력이면 같은 결과다.
// 판정 모델이 없으면 거부하지 않고 `failed` 값으로 돌려준다.

const SESSION: PortKey<AgentsSession> = { name: "fresnel.session" };
const TASKS: PortKey<AgentsTasks> = { name: "fresnel.tasks" };
const TOOLS: PortKey<AgentsTools> = { name: "fresnel.tools" };
const LOOP: PortKey<AgentsLoop> = { name: "fresnel.loop" };
const STORE: PortKey<Pick<StoreService, "leases">> = { name: StoreServiceName };
const MODELS: PortKey<FakeModels> = { name: ModelServiceName };

const NOT_MET: FakeReply = {
  kind: "tool",
  arguments: { verdict: "not_met", rationale: "tests not run", missing: ["tests pass"] },
};

/** 기능 소비자 확장. `agents.judge`를 optional로 선언하고 호스트가 넘긴 기능 API를 받는다 */
function consumer() {
  const apis: { judge?: CapabilityApi<typeof AgentsJudge> } = {};
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      apis.judge = g.capability(AgentsJudgeKey);
    });
  };
  return {
    apis,
    unit: {
      manifest: defineManifest({
        schemaVersion: 2,
        name: "judge-consumer",
        version: "0.1.0",
        entry: "./src/index.ts",
        plugins: [
          {
            layer: "L3",
            hooks: [],
            optional: [{ id: "agents.judge", range: "^1.0.0" }],
          },
        ],
      }),
      entry,
      loadIndex: 1,
      builtin: false,
    },
  };
}

async function boot(models: FakeModels | undefined) {
  const ids = fixedIdFactory();
  const session = fakeSession(ids);
  const tasks = fakeTasks({ producer: session.producer("core.tasks"), ids });
  const tools = fakeTools();
  const loop = fakeChildLoop({
    ids,
    run: () => Promise.reject(new Error("the judge does not run a child turn")),
  });
  const t = await createTestHost({ without: ["records", "queue", "loop"] });
  await t.host.registerPlatform({
    name: "test-services",
    setup(ctx) {
      ctx.providePort(SESSION, session);
      ctx.providePort(TASKS, tasks);
      ctx.providePort(TOOLS, tools);
      ctx.providePort(LOOP, loop);
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
      if (models !== undefined) ctx.providePort(MODELS, models);
    },
  });
  const installed = await t.host.install(
    agentsPlugin({
      ids,
      settings: createStaticAgentsSettings(),
      log: NOOP_LOG,
      holder: HOLDER,
      parentToken: (threadId) => session.tokenOf(threadId),
    }),
  );
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  const service = t.host.ports.get(AgentServicePortKey);
  const { apis, unit } = consumer();
  const consumed = await t.host.install(unit);
  expect(consumed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  await t.settled();
  if (service === undefined || apis.judge === undefined) throw new Error("boot failed");
  return { ids, session, service, judge: apis.judge, host: t.host };
}

/** 같은 내용의 판정 입력을 새 대화에서 만든다. 대화마다 판정 실행 수가 따로 세여 두 호출의 결과를 같은 값으로 비교할 수 있다 */
function inputIn(session: FakeSession, ids: FixedIds): JudgeInput {
  const threadId = ids.next("thr");
  const created = session.threads.create({ threadId });
  if (!created.ok) throw new Error("the judge test thread could not be created");
  return {
    threadId,
    turnId: ids.next("trn"),
    stepId: ids.next("stp"),
    goalRef: "g1",
    goal: { text: "Ship the fix", criteria: ["tests pass"] },
    evidence: [{ kind: "assistant_text", text: "I fixed it." }],
  };
}

describe("the agents.judge capability", () => {
  test("the manifest declares agents.judge 1.0.0 as provided by the L1 plugin, and the definition validates", () => {
    expect(validateCapability(AgentsJudge)).toEqual([]);
    const checked = validateManifest(agentsManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(pluginDeclsOf(checked.manifest ?? {})[0]?.provides).toEqual([
      { id: "agents.judge", version: "1.0.0" },
    ]);
  });

  test("a call through the capability returns the same outcome as AgentService.judge for the same input", async () => {
    const models = fakeModels([NOT_MET, NOT_MET]);
    const { ids, session, service, judge } = await boot(models);
    const throughCapability = await judge.judge(inputIn(session, ids), {
      requestId: "judge:stp-1:g1",
    });
    const direct: JudgeOutcome = await service.judge(inputIn(session, ids));
    expect(throughCapability.kind).toBe("judged");
    expect(throughCapability).toEqual(direct);
    expect(models.calls).toHaveLength(2);
    expect(throughCapability).toMatchObject({
      kind: "judged",
      record: { run: 1, verdict: "not_met", missing: ["tests pass"] },
    });
  });

  test("a freshly judged call charges its tokens to the drive budget once, and a recorded judgement charges nothing", async () => {
    const models = fakeModels([NOT_MET, NOT_MET]);
    const { ids, session, judge, host } = await boot(models);
    const charged: [string, number][] = [];
    host.chargeDriveTokens = (threadId, tokens) => {
      charged.push([threadId, tokens]);
    };
    const input = inputIn(session, ids);
    await judge.judge(input, { requestId: "judge:stp-1:g1" });
    // 같은 단계의 재호출은 기록된 판정을 따르므로 토큰을 쓰지 않는다
    const again = await judge.judge(input, { requestId: "judge:stp-1:g1" });
    expect(again.kind).toBe("recorded");
    expect(charged).toEqual([[input.threadId, 15]]);
  });

  test("without a judge model the capability returns failed as a value, the same as AgentService.judge", async () => {
    const { ids, session, service, judge } = await boot(undefined);
    const throughCapability = await judge.judge(inputIn(session, ids), { requestId: "judge:x" });
    const direct = await service.judge(inputIn(session, ids));
    expect(throughCapability).toEqual({
      kind: "failed",
      message: "fresnel.models is not available",
    });
    expect(throughCapability).toEqual(direct);
  });
});

import { afterAll, expect, test } from "bun:test";
import { Type } from "typebox";
import type { AgentTool, ThreadId } from "@xeon/contracts/conversation";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import {
  LoopServicePortKey,
  SessionPortKey,
  StoreServicePortKey,
  TaskServicePortKey,
  ToolServicePortKey,
  type LoopService,
  type TaskService,
  type ToolService,
} from "@xeon/contracts/services";
import type { SessionService, StoreService } from "@xeon/contracts/records";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapeClock,
} from "@xeon/core-models/testing";
import { ExtHostPortKey, hostOf, type ExtHost } from "@xeon/ext-host";
import { assemble } from "../../src/assemble.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";

// L1B.4 AG-11 (L1.agents.plan §5, M2 검토 3): 서브에이전트가 `tools` 슬롯을 쥔 채 자식을 기다리는 교착.
// 풀 크기가 1일 때 `agent` 도구 호출이 슬롯을 쥐고, 자식이 도구를 부르려면 같은 풀의 슬롯이 필요하다. `agent`가 자식을 기다리는 동안
// 슬롯을 내려놓지(`ToolService.suspendWhile`) 않으면 둘 다 영원히 기다린다.
//
// 이 시험은 실제 core-persistence(SQLite), core-tasks(풀), core-tools(파이프라인), core-loop(`runChildTurn`), core-agents를 한 엔진에 올린다.
// 같은 층(L1) 패키지끼리는 import할 수 없어(DR-02) 한 패키지의 시험으로는 이 조합을 만들 수 없고, 모든 L1을 import할 수 있는 조립 루트(L4)에 둔다.
// 모델만 테이프다. core-agents와 자식 thread 열기는 조립 루트(HOST.6)가 싣고, 시험은 `agentDefinitions`로 정의 하나만 넘긴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

interface Captured {
  ext: ExtHost;
  session: SessionService;
  store: StoreService;
  tools: ToolService;
  tasks: TaskService;
  loop: LoopService;
}

/** 엔진이 올린 서비스를 시험 쪽으로 꺼내는 확장 */
function captureModule(into: { current: Captured | undefined }) {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "agent-slot-capture",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const extension: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, {}, (g) => {
      const host = hostOf(g);
      into.current = {
        ext: host.port(ExtHostPortKey),
        session: host.port(SessionPortKey),
        store: host.port(StoreServicePortKey),
        tools: host.port(ToolServicePortKey),
        tasks: host.port(TaskServicePortKey),
        loop: host.port(LoopServicePortKey),
      };
    });
  };
  return { manifest, extension };
}

/** 테이프 재생이 쓰는 실제 시간 시계. 이 시험의 테이프는 지연 없이 바로 답한다 */
function realClock(): TapeClock {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const state = { next: 1 };
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const handle = state.next;
      state.next += 1;
      timers.set(handle, setTimeout(fn, ms));
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

function countOf(events: readonly { readonly kind: string }[], kind: string): number {
  return events.filter((event) => event.kind === kind).length;
}

const PROBE_PARAMS = Type.Object({}, { additionalProperties: false });

function probeTool(runs: string[]): AgentTool<typeof PROBE_PARAMS> {
  return {
    name: "probe",
    label: "Probe",
    description: "Reads nothing and reports that it ran.",
    parameters: PROBE_PARAMS,
    replay: "safe",
    execute(toolCallId) {
      runs.push(toolCallId);
      return Promise.resolve({ content: [{ type: "text", text: "probe ran" }], details: null });
    },
  };
}

/** 같은 role-queue에서 순서대로 소비된다: 부모 요청, 자식 요청 둘, 부모 요청 */
function tapeModels() {
  const player = tapePlayer(
    tape("agent-tools-slot", [
      {
        role: "main",
        label: "parent delegates",
        response: {
          type: "message",
          content: [
            t.toolCall("agent", { agent: "scout", task: "run the probe once" }, "call_agent"),
          ],
          stopReason: "toolUse",
        },
      },
      {
        role: "main",
        label: "child calls the probe",
        response: {
          type: "message",
          content: [t.toolCall("probe", {}, "call_probe")],
          stopReason: "toolUse",
        },
      },
      {
        role: "main",
        label: "child reports",
        response: {
          type: "message",
          content: [t.text("probe finished")],
          stopReason: "stop",
        },
      },
      {
        role: "main",
        label: "parent answers",
        response: { type: "message", content: [t.text("all done")], stopReason: "stop" },
      },
    ]),
    { clock: realClock() },
  );
  return tapeBuildModels(tapeProvider(player));
}

function turnCompleted(session: SessionService, threadId: ThreadId, timeoutMs: number) {
  return new Promise<"completed" | "timeout">((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve("timeout");
    }, timeoutMs);
    const unsubscribe = session.feed.onCommit((batch) => {
      for (const event of batch.events) {
        if (event.threadId === threadId && event.kind === "turn.completed") {
          clearTimeout(timer);
          unsubscribe();
          resolve("completed");
        }
      }
    });
  });
}

realTest(
  "agent_waits_for_child_without_holding_the_tools_slot: limits.tools = 1, an agent call whose child calls a tool",
  async () => {
    writeUserSettings(home, {
      "l1.tasks.limits.tools": 1,
      "l1.models.default": "tape/tape-1",
      "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
    });
    const captured: { current: Captured | undefined } = { current: undefined };
    const engine = await assemble({
      mode: "in-process",
      dataDir: home.dataDir,
      buildModels: tapeModels(),
      extraPlugins: [captureModule(captured)],
      agentDefinitions: [
        {
          name: "scout",
          description: "Runs the probe.",
          prompt: "Call the probe once, then report.",
          tools: ["probe"],
          source: { kind: "builtin" },
        },
      ],
    });
    try {
      const services = captured.current;
      if (services === undefined) throw new Error("the capture extension did not start");
      const { ext, session, tools, loop } = services;

      // 부모 thread: 엔진의 포트로 만들고 잠가서 쓰기 소유를 얻는다. 자식 thread의 소유는 엔진의 홀더가 부모 토큰에서 이어받는다
      const created = await engine.ports.threads.create({});
      const threadId = created.threadId;
      const locked = await engine.ports.locks.tryAcquire(threadId, "cli");
      if (!locked.ok) throw new Error("the parent thread is locked by someone else");
      const token = locked.token;
      const opened = session.openForWrite(threadId, token);
      expect(opened.ok).toBe(true);
      await ext.openThread(threadId);
      const probeRuns: string[] = [];
      const registered = tools.register({
        kind: "direct",
        orderKey: "ext.probe",
        tool: probeTool(probeRuns),
        hints: { readOnly: true },
        policy: { risk: "read" },
      });
      expect(registered.ok).toBe(true);
      // 부모의 `agent` 호출은 exec 위험이라 기본 모드에서 승인을 묻는다. 이 시험은 승인이 아니라 슬롯을 본다
      const rules = tools.registerRules("core:int-test", [
        {
          id: "int.allow-agent",
          action: "tool.call",
          resource: { tool: "agent" },
          effect: "allow",
        },
      ]);
      expect(rules.issues).toEqual([]);

      const finished = turnCompleted(session, threadId, 20_000);
      const admitted = await loop.admit({
        threadId,
        content: "delegate the probe to a scout",
        via: "interactive",
      });
      expect(admitted.ok && admitted.value.status).toBe("started");
      // 교착이면 20초 뒤 timeout이다
      expect(await finished).toBe("completed");

      // 자식이 도구를 한 번 실행했고 정착했으며, 부모의 `agent` 호출이 그 보고를 결과로 받았다
      expect(probeRuns).toHaveLength(1);
      const mine: { kind: string; payload: unknown }[] = [];
      const children: { kind: string; payload: unknown }[] = [];
      for await (const read of session.readFrom(0)) {
        if (!read.ok) continue;
        const target = read.value.threadId === threadId ? mine : children;
        target.push({ kind: read.value.kind, payload: read.value.payload });
      }
      expect(countOf(mine, "agent.spawned")).toBe(1);
      expect(countOf(mine, "agent.settled")).toBe(1);
      expect(countOf(mine, "turn.completed")).toBe(1);
      expect(countOf(children, "effect.result")).toBe(1);
      expect(countOf(children, "turn.completed")).toBe(1);
      const settled = mine.find((event) => event.kind === "agent.settled");
      expect(settled?.payload).toMatchObject({ status: "completed", error: null });
    } finally {
      await engine.close();
    }
  },
  30_000,
);

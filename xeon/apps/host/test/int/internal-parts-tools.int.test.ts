import { afterAll, expect, test } from "bun:test";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { ToolServicePortKey, type ToolService } from "@fresnel/contracts/services";
import { ExtHostPortKey, hostOf, type ExtHost } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { assemble } from "../../src/assemble.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { testOrchestration } from "../fixtures/test-group.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AGE-33 (int, 실제 엔진, 임시 홈): 내부 부품이 모델에 내주는 도구의 수, 그리고 부품(host-dialog-bridge,
// host-skill-bridge, host-memory-bridge, host-proposals-bridge)을 기본 프로필에서 빼면 어느 wire 메서드와 도구가 사라지는지를 실제 엔진으로 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

interface Captured {
  ext: ExtHost;
  tools: ToolService;
}

/** 엔진이 올린 도구 서비스를 시험 쪽으로 꺼내는 확장 */
function captureModule(into: { current: Captured | undefined }): HostPluginModule {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: "tools-count-capture",
    version: "0.1.0",
    entry: "./index.ts",
    plugins: [{ layer: "plugin", hooks: [] }],
    trust: { level: "builtin" },
  });
  const extension: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, {}, (g) => {
      const host = hostOf(g);
      into.current = { ext: host.port(ExtHostPortKey), tools: host.port(ToolServicePortKey) };
    });
  };
  return { manifest, extension };
}

/** 모델에게 도구 이름을 광고한 결과: 항상 보이는 것과 tool_search로 찾아야 하는 것 */
async function advertisedNames(
  services: Captured,
  threadId: Parameters<ExtHost["openThread"]>[0],
): Promise<{ readonly always: readonly string[]; readonly deferred: readonly string[] }> {
  await services.ext.openThread(threadId);
  const input = {
    run: { threadId, caller: "main" as const, depth: 0 },
    activated: new Set<string>(),
  };
  const result = await services.tools.advertise(input);
  if (!result.ok) throw new Error(`advertise failed: ${result.error.kind}`);
  return {
    always: result.value.tools.map((tool) => tool.name).toSorted(),
    deferred: result.value.deferred.map((tool) => tool.name).toSorted(),
  };
}

realTest(
  "the model sees 8 tools up front (7 plus tool_search) and the other 35 only through tool_search",
  async () => {
    writeUserSettings(home, TAPE_SETTINGS);
    const captured: { current: Captured | undefined } = { current: undefined };
    const engine = await assemble({
      mode: "in-process",
      dataDir: home.dataDir,
      extraPlugins: [captureModule(captured)],
    });
    try {
      const services = captured.current;
      if (services === undefined) throw new Error("the capture extension did not start");
      const created = await engine.ports.threads.create({});
      const names = await advertisedNames(services, created.threadId);
      // 항상 보이는 일곱: 질문(host-dialog-bridge), 작업 목록(cap-work), 파일 넷과 셸(cap-workspace). 여덟째는 검색 도구다
      expect(names.always).toEqual(
        [
          "ask_user",
          "bash",
          "edit",
          "grep",
          "read",
          "task_write",
          "tool_search",
          "write",
        ].toSorted(),
      );
      // 검색으로만 찾는 것: 서브에이전트(core-agents) 1, 산출물과 리뷰(cap-artifacts) 3, 지식과 메모리(cap-knowledge) 6,
      // MCP(cap-mcp) 3, 예약(cap-schedule) 1, 웹(cap-web) 6, 보호 경로(cap-workspace, AGE-63) 2,
      // 그리고 내부 부품이 아닌 authoring 플러그인의 13
      expect(names.deferred.filter((name) => name === "agent")).toHaveLength(1);
      expect(
        names.deferred.filter((name) => name.startsWith("artifact_") || name === "review_request"),
      ).toHaveLength(3);
      expect(
        names.deferred.filter((name) =>
          [
            "memory_manage",
            "knowledge_search",
            "session_read",
            "session_scroll",
            "skill_manage",
            "skill_view",
          ].includes(name),
        ),
      ).toHaveLength(6);
      expect(names.deferred.filter((name) => name.startsWith("mcp_"))).toHaveLength(3);
      expect(names.deferred.filter((name) => name === "schedule_create")).toHaveLength(1);
      expect(
        names.deferred.filter((name) => name === "sandbox_protect" || name === "sandbox_protected"),
      ).toHaveLength(2);
      expect(names.deferred.filter((name) => name.startsWith("web_"))).toHaveLength(6);
      expect(names.deferred.filter((name) => name.startsWith("authoring_"))).toHaveLength(13);
      expect(names.deferred).toHaveLength(35);
    } finally {
      await engine.close();
    }
  },
  60_000,
);

async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "ok";
  } catch (caught) {
    return caught instanceof Error ? caught.message : "failed";
  }
}

const UNITS = [
  "cap-workspace",
  "cap-dialog",
  "cap-artifacts",
  "host-dialog-bridge",
  "cap-work",
  "cap-mcp",
  "cap-web",
  "cap-knowledge",
  "host-goal-bridge",
  "host-task-bridge",
  "host-skill-bridge",
  "host-memory-bridge",
  "host-proposals-bridge",
  "cap-schedule",
];

/** 기본 프로필을 `without`만 빼고 다시 쓴 엔진에서 네 부품에 기대는 wire 메서드와 도구를 본다 */
async function withoutUnit(without: string | undefined) {
  const h = useEngineHome();
  writeUserSettings(h, TAPE_SETTINGS);
  const captured: { current: Captured | undefined } = { current: undefined };
  const group = testOrchestration(fixedIdFactory(9));
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [group.module, captureModule(captured)],
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    await connection.request("profile.put", {
      profile: {
        id: "default",
        title: "default",
        plugins: UNITS.filter((name) => name !== without).map((name) => ({ name })),
        settings: [],
        startDrive: null,
      },
      baseRev: null,
    });
    const created = await connection.request("thread.create", {});
    const { threadId } = created;
    const services = captured.current;
    if (services === undefined) throw new Error("the capture extension did not start");
    const names = await advertisedNames(services, threadId);
    return {
      "command.list": await outcome(connection.request("command.list", { threadId })),
      "status.list": await outcome(connection.request("status.list", { threadId })),
      "notify.list": await outcome(connection.request("notify.list", { afterSeq: 0 })),
      "knowledge.skills.list": await outcome(connection.request("knowledge.skills.list", {})),
      "knowledge.memory.read": await outcome(connection.request("knowledge.memory.read", {})),
      "proposal.list unavailable": JSON.stringify(
        (await connection.request("proposal.list", {})).unavailable,
      ),
      "orchestration.list": JSON.stringify(
        (await connection.request("orchestration.list", {})).groups.map((entry) => entry.id),
      ),
      ask_user: names.always.includes("ask_user") || names.deferred.includes("ask_user"),
      groupId: group.module.manifest.name,
    };
  } finally {
    await connection.close();
    await host.close();
    h.dispose();
  }
}

realTest(
  "with every part the wire methods answer; without host-dialog-bridge the command, status and notice methods and ask_user are gone",
  async () => {
    const full = await withoutUnit(undefined);
    expect(full["command.list"]).toBe("ok");
    expect(full["status.list"]).toBe("ok");
    expect(full["notify.list"]).toBe("ok");
    expect(full["knowledge.skills.list"]).toBe("ok");
    expect(full["knowledge.memory.read"]).toBe("ok");
    expect(full["proposal.list unavailable"]).toBe("[]");
    expect(full["orchestration.list"]).toBe(JSON.stringify([full.groupId]));
    expect(full.ask_user).toBe(true);

    const noDialog = await withoutUnit("host-dialog-bridge");
    expect(noDialog["command.list"]).toBe("command.list: the command service is not available");
    expect(noDialog["status.list"]).toBe("status.list: the dialog service is not available");
    expect(noDialog["notify.list"]).toBe("notify.list: the dialog service is not available");
    expect(noDialog.ask_user).toBe(false);
    // 나머지 세 부품의 메서드는 그대로다
    expect(noDialog["knowledge.skills.list"]).toBe("ok");
    expect(noDialog["proposal.list unavailable"]).toBe("[]");
  },
  120_000,
);

realTest(
  "without host-skill-bridge only the skills wire method is missing, without host-memory-bridge only the memory method is missing, and without host-proposals-bridge proposal.list reports the knowledge queue unavailable",
  async () => {
    const noSkill = await withoutUnit("host-skill-bridge");
    expect(noSkill["knowledge.skills.list"]).toBe("jsonrpc.methodNotFound");
    expect(noSkill["knowledge.memory.read"]).toBe("ok");
    expect(noSkill["command.list"]).toBe("ok");

    const noMemory = await withoutUnit("host-memory-bridge");
    expect(noMemory["knowledge.memory.read"]).toBe("jsonrpc.methodNotFound");
    expect(noMemory["knowledge.skills.list"]).toBe("ok");

    // 목표와 태스크 브릿지가 없으면 그 호출은 빈 결과를 낸다(오류가 아니다). 나머지 서비스는 그대로다
    const noGoalTask = await withoutUnit("host-goal-bridge");
    expect(noGoalTask["knowledge.skills.list"]).toBe("ok");
    expect(noGoalTask["knowledge.memory.read"]).toBe("ok");

    const noProposals = await withoutUnit("host-proposals-bridge");
    expect(noProposals["proposal.list unavailable"]).toBe(JSON.stringify(["knowledge"]));
    expect(noProposals["knowledge.skills.list"]).toBe("ok");
    expect(noProposals["command.list"]).toBe("ok");
  },
  120_000,
);

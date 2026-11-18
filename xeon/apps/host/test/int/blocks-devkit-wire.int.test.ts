import { expect, test } from "bun:test";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import { WireError, type HostConnection, type WireParams } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5e §4.9, W-47 (int, 실제 엔진): 블록 모델 읽기(`blocks.describe`)와 구성 검사(`ext.validateComposition`).
// 두 메서드 모두 실제 엔진의 처리기와 포트를 거치고, 외부로 나가는 것이 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Engine {
  readonly connection: HostConnection;
  close(): Promise<void>;
}

/** 실제 엔진을 임시 홈에 세우고 hello까지 맞춘 연결을 돌려준다. `close`가 연결, 엔진, 홈을 정리한다 */
async function openEngine(): Promise<Engine> {
  const home = useEngineHome();
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return {
    connection,
    async close() {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

/** 실패한 호출의 와이어 오류. 와이어 오류가 아니면 시험을 실패시킨다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw new Error("expected the request to fail with a WireError");
}

realTest(
  "blocks.describe returns the engine's block model: six blocks in order, three boundaries, and the hooks each block carries",
  async () => {
    const engine = await openEngine();
    try {
      const described = await engine.connection.request("blocks.describe", {});
      // 와이어로 옮긴 값은 엔진 빌드의 블록 모델과 같다
      expect(described).toEqual(BLOCK_MODEL);
      expect(described.version).toBe(1);
      expect(described.blocks.map((block) => block.id)).toEqual([
        "context",
        "model",
        "tools",
        "ask",
        "agents",
        "record",
      ]);
      expect(described.boundaries.map((boundary) => boundary.id)).toEqual([
        "conversation-start",
        "input-received",
        "before-turn-end",
      ]);
      // 도구 블록은 도구 호출 앞에서 결정하고 도구 결과를 뒤에서 받는다
      const tools = described.blocks.find((block) => block.id === "tools");
      expect(tools?.hooks).toEqual({
        before: ["tool.call.before", "guard.tool.before", "guard.output.before"],
        after: ["tool.result"],
        events: ["tool.execution.before", "tool.execution.update", "tool.execution.after"],
      });
      // 입력 경계에 든 훅은 사용자 입력 앞의 훅이다
      const inputBoundary = described.boundaries.find((item) => item.id === "input-received");
      expect(inputBoundary?.hooks).toEqual(["input.user.before", "input.bash.before"]);
      // 기록 블록은 앞뒤 훅이 없고(빈 배열로 온다) 닻이 없는 이벤트 구독만 가진다
      const record = described.blocks.find((block) => block.id === "record");
      expect(record?.hooks.before).toEqual([]);
      expect(record?.hooks.after).toEqual([]);
      expect(record?.hooks.events).toContain("boundary.settle.after");
      expect(described.positions).toHaveLength(BLOCK_MODEL.positions.length);
    } finally {
      await engine.close();
    }
  },
  30_000,
);

realTest(
  "ext.validateComposition flags a block hook its plugin does not declare at the hook's path, and passes a matching declaration",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      // 구성의 형식은 요청 params의 타입을 그대로 쓴다. 변수로 빼도 `op`가 `string`으로 넓어지지 않는다
      const guard: WireParams<"ext.validateComposition">["composition"] = {
        blocks: [{ id: "guard", stage: "guard", op: "on", hooks: ["tool.call.before"] }],
      };
      expect(
        await connection.request("ext.validateComposition", {
          composition: guard,
          plugins: [{ layer: "L3", hooks: ["tool.call.before"] }],
        }),
      ).toEqual({ issues: [] });

      expect(
        await connection.request("ext.validateComposition", {
          composition: guard,
          plugins: [{ layer: "L3", hooks: ["boundary.settle.after"] }],
        }),
      ).toEqual({
        issues: [
          {
            severity: "error",
            code: "hook_undeclared",
            path: "/blocks/0/hooks/0",
            message: expect.stringContaining("tool.call.before"),
          },
        ],
      });
    } finally {
      await engine.close();
    }
  },
  30_000,
);

realTest(
  "ext.validateComposition checks the structure without plugins: a second drive block and a capability call from an on block are errors at their paths",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      expect(
        await connection.request("ext.validateComposition", {
          composition: {
            blocks: [
              { id: "m", stage: "m", op: "drive" },
              { id: "m2", stage: "m2", op: "drive" },
            ],
          },
        }),
      ).toEqual({
        issues: [
          {
            severity: "error",
            code: "drive_duplicate",
            path: "/blocks/1",
            message: expect.any(String),
          },
        ],
      });

      expect(
        await connection.request("ext.validateComposition", {
          composition: {
            blocks: [
              {
                id: "detect",
                stage: "detect",
                op: "on",
                hooks: ["input.user.before"],
                consumes: ["web.search"],
              },
            ],
          },
        }),
      ).toEqual({
        issues: [
          {
            severity: "error",
            code: "on_capability_call",
            path: "/blocks/0/consumes",
            message: expect.any(String),
          },
        ],
      });

      // 형식이 틀린 구성은 값의 검사가 아니라 입력 검사에서 막힌다
      const malformed = await wireErrorOf(
        connection.request("ext.validateComposition", { composition: { blocks: [] } }),
      );
      expect(malformed.data).toMatchObject({ kind: "jsonrpc.invalidParams" });
      expect(malformed.data.details).toEqual({
        issues: [{ path: "/composition/blocks", message: "must not have fewer than 1 items" }],
      });
    } finally {
      await engine.close();
    }
  },
  30_000,
);

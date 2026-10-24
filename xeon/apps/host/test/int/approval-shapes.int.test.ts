import { expect, test } from "bun:test";
import { createStubServer } from "@xeon/cap-mcp/testing";
import type { JsonObject } from "@xeon/contracts/conversation";
import type { EventWire } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels, type ToolStep } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M2 E5 (HOST.6): 질문 도구(cap-dialog), 계획 승인(cap-work), MCP 서버 주도 질문(cap-mcp)이 같은 승인 요청 레코드 모양으로 기록된다.
// 세 능력은 L2 층끼리 import할 수 없어 한 패키지의 시험으로 비교할 수 없으므로, 모두 올리는 호스트에서 같은 승인 서비스가 쓴 레코드를 맞댄다.
// MCP 질문은 D5 (a) 경로의 끝에서 끝까지 시험도 겸한다: 서버가 input_required를 내고, L1.tools가 질문 승인으로 올리고, 답이 연속 정보로 돌아가 도구가 끝난다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Scenario {
  readonly asked: EventWire;
  readonly done: readonly EventWire[];
  readonly texts: string;
}

interface Settled {
  readonly decision: "allow" | "answer";
  readonly answer: JsonObject;
}

async function runScenario(
  steps: readonly ToolStep[],
  settled: Settled,
  options: { readonly settings?: JsonObject; readonly lead?: readonly string[] } = {},
): Promise<Scenario> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...options.settings });
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: callingModels("shapes", steps, "done.", options.lead ?? []),
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    // MCP 서버 도구는 연결된 다음 turn 시작에 오른다. 앞선 turn 하나로 연결을 기다린다(`lead`는 그 turn의 모델 응답이다)
    if ((options.lead ?? []).length > 0) {
      const warm = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "warm",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === warm.turnId,
      );
    }
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "go",
    });
    const asked = await collector.waitFor((event) => event.kind === "approval.requested");
    const answered = await connection.request("approval.respond", {
      approvalId: asked.id,
      decision: settled.decision,
      answer: settled.answer,
    });
    expect(answered).toEqual({ applied: true });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    );
    return {
      asked,
      done: collector.events,
      texts: toolResultTexts(collector.events).join("\n"),
    };
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
  }
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function keysOf(value: unknown): string[] {
  return Object.keys(recordOf(value)).toSorted();
}

/** 승인 요청 이벤트의 윤곽: 봉투 키, payload 키, 출처 키, 기억 범위, 본문 키 */
function outline(asked: EventWire) {
  const payload = recordOf(asked.payload);
  const body = recordOf(payload["body"]);
  return {
    envelope: keysOf(asked).filter((key) => key !== "payload"),
    payload: keysOf(payload),
    origin: keysOf(payload["origin"]),
    remember: payload["remember"],
    bodyKind: typeof body["kind"] === "string" ? body["kind"] : "",
    bodyKeys: keysOf(body),
  };
}

realTest(
  "question tool, plan approval and MCP question are recorded as the same approval request record",
  async () => {
    const stub = createStubServer({
      era: "modern",
      tools: [
        {
          name: "ask_server",
          description: "Asks the user one thing before it answers.",
          inputSchema: { type: "object", properties: {} },
          handle: (call) =>
            call.inputResponses === undefined
              ? {
                  kind: "input_required",
                  inputRequests: {
                    q1: {
                      method: "elicitation/create",
                      params: {
                        mode: "form",
                        message: "Who are you?",
                        requestedSchema: {
                          type: "object",
                          properties: { name: { type: "string" } },
                          required: ["name"],
                        },
                      },
                    },
                  },
                  requestState: "state-1",
                }
              : {
                  kind: "complete",
                  content: [{ type: "text", text: `got ${JSON.stringify(call.inputResponses)}` }],
                },
        },
      ],
    });
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => stub.http(request),
    });
    try {
      const question = await runScenario(
        [
          {
            name: "ask_user",
            args: {
              questions: [
                {
                  id: "color",
                  question: "Which color?",
                  options: [
                    { id: "red", label: "Red" },
                    { id: "blue", label: "Blue" },
                  ],
                },
              ],
            },
          },
        ],
        { decision: "answer", answer: { color: { selected: ["blue"] } } },
      );
      const plan = await runScenario(
        [
          { name: "enter_plan_mode", args: {} },
          { name: "submit_plan", args: { title: "Refactor", body: "1. read\n2. change" } },
        ],
        { decision: "allow", answer: { mode: "acceptEdits" } },
      );
      const mcp = await runScenario(
        [{ name: "ask_server", args: {} }],
        { decision: "answer", answer: { q1: { selected: [], text: "Ada" } } },
        {
          lead: ["warmed up."],
          settings: {
            "l2.mcp.servers": {
              fixture: {
                transport: { type: "http", url: `http://127.0.0.1:${String(server.port)}/mcp` },
              },
            },
            "l2.mcp.approvalMode": "auto",
          },
        },
      );

      const questionOutline = outline(question.asked);
      const mcpOutline = outline(mcp.asked);
      const planOutline = outline(plan.asked);
      expect(questionOutline.bodyKind).toBe("question");
      expect(planOutline.bodyKind).toBe("plan");
      expect(mcpOutline.bodyKind).toBe("question");
      // 세 레코드는 봉투, payload, 출처, 기억 범위, 본문 바깥 모양이 같다
      expect(mcpOutline).toEqual(questionOutline);
      expect({ ...planOutline, bodyKind: "question", bodyKeys: questionOutline.bodyKeys }).toEqual(
        questionOutline,
      );
      expect(questionOutline.remember).toEqual(["once"]);
      // 질문 본문의 묶음 모양도 같다
      const questionBody = recordOf(recordOf(recordOf(question.asked.payload)["body"])["question"]);
      const mcpBody = recordOf(recordOf(recordOf(mcp.asked.payload)["body"])["question"]);
      expect(keysOf(mcpBody)).toEqual(keysOf(questionBody));

      // D5 (a): 답이 연속 정보로 서버에 돌아가 도구가 끝났다
      expect(mcp.texts).toContain("got");
      expect(mcp.texts).toContain("Ada");
      expect(question.texts).toContain("blue");
    } finally {
      await server.stop(true);
    }
  },
  90_000,
);

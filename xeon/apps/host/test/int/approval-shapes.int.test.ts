import { expect, test } from "bun:test";
import { createStubServer } from "@xeon/cap-mcp/testing";
import type { JsonObject, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { EventWire } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels, type ToolStep } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { SECRET_REF, SECRET_TOOL, startSecretEnvScenario } from "../fixtures/secret-env.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle, until } from "../fixtures/wire-client.ts";

// M2 E5 (HOST.6): 질문 도구(cap-dialog), 계획 승인(cap-work), MCP 서버 주도 질문(cap-mcp), 도구 승인(L1.tools)과 비밀 사용 승인(L1.tools)이
// 같은 승인 요청 레코드 모양으로 기록되고, 출처(origin)의 turnId, stepId, toolCallId, caller가 같은 규칙의 값을 갖는다.
// 능력들은 L2 층끼리 import할 수 없어 한 패키지의 시험으로 비교할 수 없으므로, 모두 올리는 호스트에서 같은 승인 서비스가 쓴 레코드를 맞댄다.
// 키 이름만 맞추면 값이 다른 것(예전에는 질문·계획이 stepId를 null로, 서브에이전트 이름을 잃은 caller로 남겼다)을 못 잡아서 값도 비교한다.
// MCP 질문은 D5 (a) 경로의 끝에서 끝까지 시험도 겸한다: 서버가 input_required를 내고, L1.tools가 질문 승인으로 올리고, 답이 연속 정보로 돌아가 도구가 끝난다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Scenario {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly asked: EventWire;
  readonly done: readonly EventWire[];
  readonly texts: string;
}

interface Settled {
  readonly decision: "allow" | "answer";
  readonly answer?: JsonObject;
}

async function runScenario(
  steps: readonly ToolStep[],
  settled: Settled,
  options: {
    readonly settings?: JsonObject;
    readonly lead?: readonly string[];
    /** warm turn 전에 기다릴 조건. 연결은 세션 시작을 막지 않아 느린 러너(macOS)에서는 warm turn이 연결보다 먼저 끝날 수 있다 */
    readonly ready?: () => boolean;
  } = {},
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
      const ready = options.ready;
      if (ready !== undefined) expect(await until(ready, 10_000)).toBe(true);
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
      ...(settled.answer === undefined ? {} : { answer: settled.answer }),
    });
    expect(answered).toEqual({ applied: true });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    );
    return {
      threadId: created.threadId,
      turnId: started.turnId,
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

/**
 * 비밀 사용 승인(규칙이 bash를 허용한 호출의 `secret.use` 요청). 다른 시나리오와 엔진 홈을 번갈아 쓰므로 끝까지 돌리고 닫은 뒤 요청만 돌려준다
 */
async function runSecretScenario(): Promise<Scenario> {
  const scenario = await startSecretEnvScenario({ allowBashByRule: true });
  try {
    expect(await scenario.allow()).toEqual({ applied: true });
    return {
      threadId: scenario.threadId,
      turnId: scenario.turnId,
      asked: scenario.asked,
      done: scenario.collector.events.slice(),
      texts: scenario.texts(),
    };
  } finally {
    await scenario.close();
  }
}

/**
 * 출처 값 규칙: turnId는 요청한 turn, stepId는 그 turn의 단계(이벤트 봉투와 같은 값), toolCallId는 모델이 낸 호출 id, caller는 주 대화다.
 * 어느 능력이 어느 어댑터로 올렸든 같다.
 */
function expectOriginValues(
  asked: EventWire,
  expected: { readonly threadId: ThreadId; readonly turnId: TurnId; readonly toolCallId: string },
): void {
  const origin = recordOf(recordOf(asked.payload)["origin"]);
  expect(origin["threadId"]).toBe(expected.threadId);
  expect(origin["turnId"]).toBe(expected.turnId);
  // 루프가 제공자 id에 단계 salt(`_` + 8자)를 붙여 기록한다(L1.loop.spec §3.3 7번)
  expect(origin["toolCallId"]).toMatch(new RegExp(`^${expected.toolCallId}_[0-9A-Z]{8}$`));
  expect(origin["caller"]).toBe("main");
  expect(typeof origin["stepId"]).toBe("string");
  expect(origin["stepId"]).toBe(asked.stepId);
  expect(asked.threadId).toBe(expected.threadId);
  expect(asked.turnId).toBe(expected.turnId);
}

realTest(
  "question tool, plan approval, MCP question, tool approval and secret approval are recorded as the same approval request record",
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
      const tool = await runScenario(
        [{ name: "bash", args: { command: "echo shapes" } }],
        {
          decision: "allow",
        },
        { settings: { "l0.sandbox.enabled": false } },
      );
      const secret = await runSecretScenario();
      const mcp = await runScenario(
        [{ name: "ask_server", args: {} }],
        { decision: "answer", answer: { q1: { selected: [], text: "Ada" } } },
        {
          lead: ["warmed up."],
          ready: () => stub.requests.some((request) => request.method === "tools/list"),
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
      const toolOutline = outline(tool.asked);
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

      // 도구 승인과 비밀 사용 승인도 봉투, payload, 출처의 모양이 같다. 본문은 tool이고 기억 범위는 요청마다 정한다
      const secretOutline = outline(secret.asked);
      for (const other of [toolOutline, secretOutline]) {
        expect(other.bodyKind).toBe("tool");
        expect(other.envelope).toEqual(questionOutline.envelope);
        expect(other.payload).toEqual(questionOutline.payload);
        expect(other.origin).toEqual(questionOutline.origin);
      }
      expect(toolOutline.remember).toEqual(["once", "thread"]);
      expect(secretOutline.remember).toEqual(["once"]);
      expect(recordOf(recordOf(secret.asked.payload)["body"])["tool"]).toMatchObject({
        toolName: SECRET_TOOL,
        ruleId: "secret.use",
      });
      expect(recordOf(secret.asked.payload)["title"]).toBe(
        `Allow "${SECRET_TOOL}" to use ${SECRET_REF}?`,
      );

      // 출처의 값도 같은 규칙이다: 요청한 turn과 단계(이벤트 봉투와 같은 값), 모델이 낸 호출 id, 주 대화
      expectOriginValues(question.asked, { ...question, toolCallId: "call_1" });
      expectOriginValues(plan.asked, { ...plan, toolCallId: "call_2" });
      expectOriginValues(mcp.asked, { ...mcp, toolCallId: "call_1" });
      expectOriginValues(tool.asked, { ...tool, toolCallId: "call_1" });
      expectOriginValues(secret.asked, { ...secret, toolCallId: "call_1" });

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

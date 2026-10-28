import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { type EventWire, WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { approvalModels, APPROVAL_COMMAND } from "../fixtures/approval-tape.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, type EventCollector } from "../fixtures/wire-client.ts";

// HOST.4 (int): approval.requested가 내구 이벤트로 나오고 approval.list가 그것을 보이며 approval.respond로 turn이 이어진다.
// 실제 엔진, 실제 저장소, 모델 테이프. bash 도구가 실제로 실행된다(임시 작업 폴더).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

interface Fixture {
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly threadId: ThreadId;
  close(): Promise<void>;
}

async function start(): Promise<Fixture> {
  const home = useEngineHome();
  // 이 기기에 샌드박스 도구가 없을 수 있다. 승인 흐름을 보는 시험이라 샌드박스는 끈다
  writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
  const workspace = mkdtempSync(join(tmpdir(), "xh-appr-"));
  const previousCwd = process.cwd();
  // 엔진은 시작할 때의 작업 폴더를 도구의 읽기·쓰기 root로 잡는다(cap-workspace)
  process.chdir(workspace);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: approvalModels("approval"),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  const created = await connection.request("thread.create", { workspace });
  await connection.request("turn.start", { threadId: created.threadId, input: "run it" });
  return {
    connection,
    collector,
    threadId: created.threadId,
    async close() {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    },
  };
}

/** 도구 결과 item의 본문과 오류 여부 */
function toolResults(events: readonly EventWire[]): { text: string; isError: boolean }[] {
  const out: { text: string; isError: boolean }[] = [];
  for (const event of events) {
    if (event.kind !== "item.recorded") continue;
    const payload: unknown = event.payload;
    if (typeof payload !== "object" || payload === null || !("item" in payload)) continue;
    const item = payload.item;
    if (
      typeof item !== "object" ||
      item === null ||
      !("kind" in item) ||
      item.kind !== "toolResult"
    )
      continue;
    out.push({
      text: JSON.stringify(item),
      isError: JSON.stringify(item).includes('"isError":true'),
    });
  }
  return out;
}

function requested(event: EventWire): boolean {
  return event.kind === "approval.requested";
}

describe("approval.respond", () => {
  realTest(
    "the tool call waits for an answer; approval.list shows it; allow runs the tool and the turn ends",
    async () => {
      const fx = await start();
      const asked = await fx.collector.waitFor(requested);
      const listed = await fx.connection.request("approval.list", { threadId: fx.threadId });
      expect(listed.approvals).toHaveLength(1);
      const [pending] = listed.approvals;
      expect(pending).toMatchObject({ approvalId: asked.id, seq: asked.seq });
      expect(pending?.request.body.kind).toBe("tool");
      expect(JSON.stringify(pending?.request)).toContain(APPROVAL_COMMAND);
      expect(listed.position.seq).toBeGreaterThanOrEqual(asked.seq);
      // 승인 대기 중에는 turn이 끝나지 않는다
      expect(fx.collector.events.some((event) => event.kind === "turn.completed")).toBe(false);

      const answered = await fx.connection.request("approval.respond", {
        approvalId: asked.id,
        decision: "allow",
      });
      expect(answered).toEqual({ applied: true });
      const resolved = await fx.collector.waitFor((event) => event.kind === "approval.resolved");
      expect(resolved.payload).toMatchObject({ approvalId: asked.id, decision: "allow" });
      const done = await fx.collector.waitFor((event) => event.kind === "turn.completed");
      expect(done.payload).toMatchObject({ status: "completed" });
      const results = toolResults(fx.collector.events);
      expect(results).toHaveLength(1);
      expect(results[0]?.isError).toBe(false);
      expect(results[0]?.text).toContain("approved-by-user");

      // 해결된 요청은 목록에서 빠지고, 같은 응답을 다시 보내면 applied: false다
      const after = await fx.connection.request("approval.list", { threadId: fx.threadId });
      expect(after.approvals).toEqual([]);
      expect(
        await fx.connection.request("approval.respond", {
          approvalId: asked.id,
          decision: "allow",
        }),
      ).toEqual({ applied: false, reason: "already_resolved" });
      await fx.close();
    },
  );

  realTest("deny ends the call without running the command", async () => {
    const fx = await start();
    const asked = await fx.collector.waitFor(requested);
    const answered = await fx.connection.request("approval.respond", {
      approvalId: asked.id,
      decision: "deny",
      answer: { feedback: "not now" },
    });
    expect(answered).toEqual({ applied: true });
    await fx.collector.waitFor((event) => event.kind === "turn.completed");
    const results = toolResults(fx.collector.events);
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.text).toContain("not now");
    expect(results[0]?.text).not.toContain("approved-by-user");
    await fx.close();
  });

  realTest("a response of the wrong shape for the request is not applied", async () => {
    const fx = await start();
    const asked = await fx.collector.waitFor(requested);
    // 도구 승인에 질문 답을 보낼 수 없다
    const wrong = await fx.connection.request("approval.respond", {
      approvalId: asked.id,
      decision: "answer",
      answer: { q1: { selected: ["a"] } },
    });
    expect(wrong).toMatchObject({ applied: false, reason: "answer_invalid" });
    expect(typeof wrong.detail).toBe("string");
    expect(
      (await fx.connection.request("approval.list", { threadId: fx.threadId })).approvals,
    ).toHaveLength(1);
    await fx.connection.request("approval.respond", { approvalId: asked.id, decision: "deny" });
    await fx.collector.waitFor((event) => event.kind === "turn.completed");
    await fx.close();
  });

  realTest("an unknown approval id is applied false", async () => {
    const fx = await start();
    expect(
      await fx.connection.request("approval.respond", {
        approvalId: "evt_missing",
        decision: "allow",
      }),
    ).toEqual({ applied: false, reason: "unknown_approval" });
    const asked = await fx.collector.waitFor(requested);
    await fx.connection.request("approval.respond", { approvalId: asked.id, decision: "deny" });
    await fx.close();
  });

  realTest("approval.list on an unknown thread is thread.notFound", async () => {
    const fx = await start();
    const asked = await fx.collector.waitFor(requested);
    const error = await wireErrorOf(
      fx.connection.request("approval.list", { threadId: fixedIdFactory(5).next("thr") }),
    );
    expect(error.code).toBe(3001);
    await fx.connection.request("approval.respond", { approvalId: asked.id, decision: "deny" });
    await fx.close();
  });
});

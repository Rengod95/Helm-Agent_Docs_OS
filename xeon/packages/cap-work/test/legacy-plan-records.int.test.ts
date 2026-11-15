import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { readTasks } from "../src/projection/read.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { tid } from "./support/tasks.ts";

// 계획 모드와 계획 승인은 없앴다 [결정: 2026-11-13 사용자]. 옛 계획 기록(work.plan_*, 계획 승인 요청과 해결)은 이벤트 표에 남아 있다.
// 지금의 생산자는 retired kind를 거부하므로(store.kind_retired) 이 시험은 옛 기록을 이벤트 표에 직접 남긴다.
// 투영을 다시 만들어도 깨지지 않고, 작업 표와 투영 표의 값이 옛 기록이 없을 때와 같아야 한다. 옛 계획 표는 지워진다 [결정: 2026-11-15 사용자].

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

/** 옛 기록 한 건을 이벤트 표의 다음 seq에 직접 남기고 낸 id를 돌려준다. 투영은 이 경로로 갱신되지 않으므로 시험은 따로 다시 만든다 */
function appendLegacy(h: Harness, kind: string, payload: JsonValue): string {
  const written = h.store.root.write((tx) => {
    const seq = Number(tx.get("SELECT next_seq FROM event_seq WHERE singleton = 1")?.["next_seq"]);
    if (!Number.isInteger(seq)) throw new Bug("harness: event_seq has no next_seq");
    const last = tx.get("SELECT id FROM events ORDER BY seq DESC LIMIT 1")?.["id"];
    const parentId = typeof last === "string" ? last : null;
    const id = h.ids.next("evt");
    const recordedAt = h.clock.now();
    const envelope = {
      id,
      kind,
      version: 1,
      threadId: h.threadId,
      turnId: null,
      stepId: null,
      recordedAt,
      causationId: null,
      correlationId: null,
      payload,
      durable: true,
      seq,
      parentId,
    };
    tx.run(
      `INSERT INTO events (seq, id, thread_id, parent_id, kind, version, turn_id, step_id, recorded_at,
         request_id, private_owner, envelope)
       VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, NULL, ?)`,
      [seq, id, h.threadId, parentId, kind, recordedAt, `legacy:${id}`, JSON.stringify(envelope)],
    );
    tx.run("UPDATE event_seq SET next_seq = ? WHERE singleton = 1", [seq + 1]);
    return id;
  });
  if (!written.ok) throw new Bug("the legacy record did not write", { cause: written.error });
  return written.value;
}

/** 작업 표를 [id, 내용, 상태, 막는 작업] 값으로 옮긴다 */
function tasksOf(h: Harness): [string, string, string, string[]][] {
  const read = readTasks(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("the task rows did not read", { cause: read.error });
  return read.value.map((task) => [task.id, task.content, task.status, [...task.blockedBy]]);
}

/** cap_work_ 표의 이름을 정렬해 돌려준다 */
function workTablesOf(h: Harness): string[] {
  const read = h.store.root.read((tx) =>
    tx.all("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'cap_work_%'"),
  );
  if (!read.ok) throw new Bug("the schema did not read", { cause: read.error });
  return read.value.map((row) => String(row["name"])).toSorted();
}

describe("old plan records in the event table", () => {
  test("a rebuild over old plan submissions, approvals and withdrawals keeps the task rows and drops the old plan table", async () => {
    opened = await openHarness();
    const h = opened;
    await h.api.create({ content: "write tests" }, h.opts("create-1"));
    await h.api.create({ content: "ship" }, h.opts("create-2"));
    await h.api.link({ id: tid("t2"), blockedBy: [tid("t1")], op: "add" }, h.opts("link-1"));
    const tasks: [string, string, string, string[]][] = [
      ["t1", "write tests", "pending", []],
      ["t2", "ship", "pending", ["t1"]],
    ];
    expect(tasksOf(h)).toEqual(tasks);
    const digests = await h.workDigests();

    // 옛 대화: 계획 p1은 제출되고 승인 요청이 떴다가 사용자가 반려했고, 계획 p2는 종료 기록으로 철회됐다
    appendLegacy(h, "work.plan_submitted", {
      planId: "p1",
      version: 1,
      title: "Plan",
      body: "v1 body",
      artifact: null,
      supersedes: null,
    });
    const requestId = appendLegacy(h, "approval.requested", {
      origin: {
        threadId: h.threadId,
        turnId: null,
        stepId: null,
        toolCallId: null,
        caller: "host",
      },
      requestKey: "plan:p1:1",
      title: "Review the plan",
      body: {
        kind: "plan",
        plan: { plan: "v1 body", planRef: "plan:p1:1", nextModes: ["default"] },
      },
      remember: ["once"],
      surfaceThreadId: h.threadId,
      requestedAt: h.clock.now(),
    });
    appendLegacy(h, "approval.resolved", {
      approvalId: requestId,
      decision: "deny",
      answer: { feedback: "add tests" },
      remember: "once",
      requestedRemember: null,
      resolvedBy: "user",
    });
    appendLegacy(h, "work.plan_withdrawn", { planId: "p2", version: 1, reason: "exit_mode" });

    // 옛 DB에는 계획 표가 남아 있었다. 재구성은 이 표를 지워야 한다(표 모양은 시험에 필요한 만큼만 둔다)
    const oldTable = h.store.root.write((tx) => {
      tx.run("CREATE TABLE cap_work_plans (session_id TEXT NOT NULL, plan_id TEXT NOT NULL)");
    });
    if (!oldTable.ok) throw new Bug("the old plan table did not create", { cause: oldTable.error });

    await h.rebuild();
    expect(tasksOf(h)).toEqual(tasks);
    expect(await h.workDigests()).toEqual(digests);
    expect(workTablesOf(h)).toEqual([
      "cap_work_edges",
      "cap_work_goals",
      "cap_work_judgments",
      "cap_work_meta",
      "cap_work_reports",
      "cap_work_tasks",
    ]);
  });
});

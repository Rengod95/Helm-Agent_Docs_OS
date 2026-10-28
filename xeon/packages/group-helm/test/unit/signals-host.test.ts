import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import type { TurnId } from "@xeon/contracts/conversation";
import type { PayloadOf } from "@xeon/ext-host";
import { HelmStateSchema, type HelmState } from "../../src/state.ts";
import { createRig, type Rig } from "../support/rig.ts";

function statesOf(rig: Rig): readonly HelmState[] {
  return rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
}

function failing(id: string): PayloadOf<"tool.execution.after"> {
  return {
    toolCallId: id,
    toolName: "bash",
    input: { command: "make", attempt: id },
    result: { content: [{ type: "text", text: "build failed at line 12" }] },
    isError: true,
  };
}

/** 같은 도구가 같은 오류로 세 번 실패하는 turn을 흉내 낸다 */
async function stuckTurn(rig: Rig, key: string, turnId?: TurnId): Promise<void> {
  const call = (n: number) =>
    rig.t.host.dispatch("tool.execution.after", failing(`${key}-${String(n)}`), {
      threadId: rig.thread,
      dispatchKey: `${key}:${String(n)}`,
    });
  await call(1);
  await call(2);
  await call(3);
  await rig.settle(`${key}:settle`, turnId);
}

test("signals.autostart-modes: off records only", async () => {
  const rig = await createRig({ settings: { "ext.helm.autoStart": "off" } });
  await stuckTurn(rig, "a");
  expect(rig.records("grp.helm.signal.detected")).toEqual([
    expect.objectContaining({ signal: "stuck", action: "recorded", inquiryId: null }),
  ]);
  expect(rig.t.queue.items).toHaveLength(0);
  expect(statesOf(rig).at(-1)?.pending ?? null).toBeNull();
});

test("signals.autostart-modes: suggest posts one next-turn notice and never opens a turn", async () => {
  const rig = await createRig({ settings: { "ext.helm.autoStart": "suggest" } });
  await stuckTurn(rig, "a");
  expect(rig.records("grp.helm.signal.detected")).toEqual([
    expect.objectContaining({ signal: "stuck", action: "suggested" }),
  ]);
  expect(rig.t.queue.items).toHaveLength(1);
  expect(rig.t.queue.items[0]).toMatchObject({
    when: "next",
    item: { kind: "context", customType: "grp.helm.notice.suggested", display: true },
  });
  expect(rig.t.loop.turns).toHaveLength(0);
  // 같은 turn(같은 turnId와 디스패치 키)을 다시 실행해도 기록과 알림은 늘지 않는다
  const turnId = rig.t.ids.next("trn");
  await stuckTurn(rig, "b", turnId);
  const records = rig.records("grp.helm.signal.detected").length;
  const notices = rig.t.queue.items.length;
  await stuckTurn(rig, "b", turnId);
  expect(rig.records("grp.helm.signal.detected")).toHaveLength(records);
  expect(rig.t.queue.items).toHaveLength(notices);
});

test("signals.autostart-modes: auto commits pending and the next boundary starts the inquiry", async () => {
  const rig = await createRig({ settings: { "ext.helm.autoStart": "auto" } });
  await stuckTurn(rig, "a");
  expect(rig.records("grp.helm.signal.detected")).toEqual([
    expect.objectContaining({ signal: "stuck", action: "requested" }),
  ]);
  expect(statesOf(rig).at(-1)?.pending).toMatchObject({ source: "signal", signal: "stuck" });
  await rig.drain();
  expect(rig.t.loop.turns).toHaveLength(2);
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
});

test("signals.pure-query-no-side-effect: the same dispatch keys again leave state and records as they were", async () => {
  const rig = await createRig({ settings: { "ext.helm.autoStart": "off" } });
  await stuckTurn(rig, "a");
  const records = rig.records("grp.helm.signal.detected").length;
  const states = statesOf(rig).length;
  await stuckTurn(rig, "a");
  expect(rig.records("grp.helm.signal.detected")).toHaveLength(records);
  expect(statesOf(rig).at(-1)?.watch.errorRun).toBeGreaterThanOrEqual(3);
  expect(statesOf(rig).length).toBeLessThanOrEqual(states + 1);
  expect(rig.fakes.web.calls + rig.fakes.tasks.calls).toBe(0);
});

test("signals.commit-once-per-turn: five tool calls and one settle commit the state once", async () => {
  const rig = await createRig({ settings: { "ext.helm.autoStart": "off" } });
  const before = statesOf(rig).length;
  // 한 turn의 순서: 입력 지점이 집계표를 열고, 도구 결과가 쌓이고, 정착에서 한 번 커밋한다
  await rig.t.host.dispatch(
    "input.agent.before",
    { prompt: "작업", systemPrompt: "s", systemPromptOptions: {} },
    { threadId: rig.thread, dispatchKey: "p", initial: { messages: [], systemPrompt: "s" } },
  );
  await readCalls(rig, ["t1", "t2", "t3", "t4", "t5"], before);
  await rig.settle("s");
  expect(statesOf(rig)).toHaveLength(before + 1);
});

async function readCalls(rig: Rig, ids: readonly string[], before: number): Promise<void> {
  const [id, ...rest] = ids;
  if (id === undefined) return;
  await rig.t.host.dispatch(
    "tool.execution.after",
    { toolCallId: id, toolName: "read", input: { path: id }, result: "ok", isError: false },
    { threadId: rig.thread, dispatchKey: id },
  );
  expect(statesOf(rig)).toHaveLength(before);
  await readCalls(rig, rest, before);
}

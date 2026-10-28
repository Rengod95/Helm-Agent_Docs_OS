import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { t as tapeText, tape, tapePlayer } from "@xeon/core-models/testing";
import { createTestHost } from "@xeon/ext-host/testing";
import { helmGroup } from "../../src/index.ts";
import { WRITE_DENY_REASON } from "../../src/guard.ts";
import { HelmStateSchema } from "../../src/state.ts";
import { miniLoop, realTapeClock } from "../support/mini-loop.ts";
import {
  DEFS,
  callCommand,
  createWorld,
  defaultAnswers,
  drainRounds,
  installWorld,
  settleOnce,
} from "../support/rig.ts";

const WRITE_CALL = tapeText.toolCall("write", {}, "call_write");
const BASH_CALL = tapeText.toolCall("bash", {}, "call_bash");

/**
 * E1(UC-2): 확산 단계 쓰기 거부, 렌즈 N개 spawn, 결과 커밋 뒤 적용 turn 정확히 한 번.
 * 모델 응답은 테이프가 정한다. 그 turn의 tool_call 지점 호출은 작은 루프가 L1처럼 발화한다
 */
test("uc2.write-deny-and-n-lenses", async () => {
  const player = tapePlayer(
    tape("uc2-helm", [
      {
        role: "main",
        label: "diverge: the model tries bash and write",
        response: {
          type: "message",
          content: [BASH_CALL, WRITE_CALL],
          stopReason: "toolUse",
        },
      },
      {
        role: "main",
        label: "diverge: the model answers after the denials",
        response: {
          type: "message",
          content: [tapeText.text("쓰기 없이 관점만 정리합니다.")],
          stopReason: "stop",
        },
      },
      {
        role: "main",
        label: "apply: the single apply turn",
        response: {
          type: "message",
          content: [tapeText.text("발견을 적용했습니다.")],
          stopReason: "stop",
        },
      },
      {
        role: "main",
        label: "after Helm is off: the same write call runs",
        response: { type: "message", content: [WRITE_CALL], stopReason: "toolUse" },
      },
      {
        role: "main",
        label: "after Helm is off: the final answer",
        response: { type: "message", content: [tapeText.text("끝났습니다.")], stopReason: "stop" },
      },
    ]),
    { clock: realTapeClock() },
  );
  const loop = miniLoop(player, defaultAnswers());
  const world = createWorld();
  const t = await createTestHost({ capabilityDefs: DEFS, loop: loop.options });
  loop.bind(t);
  await installWorld(t, world);
  await t.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 4,
    builtin: true,
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "start");
  await drainRounds(t, thread, 8);

  // (1) 확산 단계의 bash(exec)와 write(write) 호출은 실행되지 않고, 거부 사유가 도구 결과로 모델에 돌아간다
  expect(loop.log.executed).toEqual([]);
  expect(loop.log.denied).toEqual([
    { tool: "bash", reason: WRITE_DENY_REASON },
    { tool: "write", reason: WRITE_DENY_REASON },
  ]);
  expect(loop.log.results).toEqual([
    `[xeon:denied_by_extension] ${WRITE_DENY_REASON}`,
    `[xeon:denied_by_extension] ${WRITE_DENY_REASON}`,
  ]);
  // 발산 turn의 시스템 프롬프트에는 Helm 블록이 하나 붙는다
  expect(loop.log.systemPrompts[0]).toMatch(
    /^base\n\n\[helm\] inquiry h[a-z2-7]{13} round 1 phase diverge/,
  );

  // (2) 렌즈 3개 → spawn 3개, 적용 turn은 정확히 한 번이고 그 requestId는 적용 turn이다
  expect(t.loop.spawns).toHaveLength(3);
  expect(t.loop.turns.map((request) => request.requestId.split(":").slice(2).join(":"))).toEqual([
    "turn:diverge:1",
    "turn:apply:1",
  ]);
  const states = t.records
    .events(thread)
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
  expect(states.map((state) => state.phase)).toEqual([
    "idle",
    "diverge",
    "explore",
    "explore",
    "converge",
    "apply",
    "idle",
  ]);
  const finished = t.records
    .events(thread)
    .filter((event) => event.kind === "grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  expect(world.fakes.tasks.created).toHaveLength(2);
  expect(player.remaining()).toBe(2);

  // (3) Helm을 끈 다음 turn에서는 같은 쓰기 호출이 실행된다
  t.host.scope("helm")?.disable();
  await drainRounds(t, thread, 4, "idle");
  const toggles = t.records
    .events(thread)
    .filter((event) => event.kind === "scope.changed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      return typeof payload === "object" &&
        payload !== null &&
        "scopeId" in payload &&
        "status" in payload &&
        payload.scopeId === "helm"
        ? [payload.status]
        : [];
    });
  expect(toggles.at(-1)).toBe("disabled");
  await loop.userTurn(t, thread);
  expect(loop.log.executed).toEqual(["write"]);
  expect(loop.log.denied).toHaveLength(2);
  player.assertExhausted();
});

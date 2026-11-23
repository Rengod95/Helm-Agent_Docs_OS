import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  askReachesPerson,
  createUnattendedThreads,
} from "../../src/assembly/unattended-threads.ts";

// F-07: ask_user는 화면이 붙은 대화의 Drive turn(문맥이 비대화형)에서도 사람에게 가고, 예약이 만든 무인 대화와 서브에이전트는 그대로 막힌다.

const ids = fixedIdFactory(1);
const attended: ThreadId = ids.next("thr");
const scheduled: ThreadId = ids.next("thr");
const MAIN = { kind: "model", agent: "main" } as const;

test("ask reaches a person for an interactive call, and for a non-interactive main call on an attended thread", () => {
  const unattended = createUnattendedThreads();
  unattended.add(scheduled);
  expect(
    askReachesPerson({ caller: MAIN, threadId: attended, interactive: true }, unattended),
  ).toBe(true);
  expect(askReachesPerson({ caller: MAIN, threadId: attended }, unattended)).toBe(true);
  // Drive turn: 문맥은 비대화형이지만 대화에는 사람이 붙어 있다
  expect(
    askReachesPerson({ caller: MAIN, threadId: attended, interactive: false }, unattended),
  ).toBe(true);
});

test("ask stays unavailable for a scheduled thread, a subagent, a background call and a host without the list", () => {
  const unattended = createUnattendedThreads();
  unattended.add(scheduled);
  expect(
    askReachesPerson({ caller: MAIN, threadId: scheduled, interactive: false }, unattended),
  ).toBe(false);
  expect(
    askReachesPerson(
      { caller: { kind: "model", agent: "subagent" }, threadId: attended, interactive: false },
      unattended,
    ),
  ).toBe(false);
  expect(
    askReachesPerson(
      { caller: { kind: "model", agent: "background" }, threadId: attended, interactive: false },
      unattended,
    ),
  ).toBe(false);
  expect(
    askReachesPerson({ caller: MAIN, threadId: attended, interactive: false }, undefined),
  ).toBe(false);
});

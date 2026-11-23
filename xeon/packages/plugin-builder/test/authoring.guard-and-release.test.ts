import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  authoringWriteGuard,
  confirmedYes,
  packConfirmation,
  replayInDevMode,
} from "../src/index.ts";

const DIR = "/work/demo";

test("authoring.guard-blocks-outside-dir: writes inside the target folder pass, writes outside and unreadable targets are blocked (A-3)", () => {
  expect(
    authoringWriteGuard(DIR, {
      toolName: "write",
      risk: "write",
      input: { path: "/work/demo/src/a.ts" },
    }),
  ).toBeUndefined();
  expect(
    authoringWriteGuard(DIR, { toolName: "write", risk: "write", input: { path: "src/a.ts" } }),
  ).toBeUndefined();
  expect(
    authoringWriteGuard(DIR, {
      toolName: "write",
      risk: "write",
      input: { path: "/work/other/a.ts" },
    }),
  ).toEqual({
    block: true,
    reason: "authoring: write would write outside the target folder (/work/other/a.ts)",
  });
  expect(
    authoringWriteGuard(DIR, { toolName: "edit", risk: "write", input: { file_path: "../x.ts" } }),
  ).toEqual({
    block: true,
    reason: "authoring: edit would write outside the target folder (../x.ts)",
  });
  expect(
    authoringWriteGuard(DIR, { toolName: "write", risk: "write", input: { content: "x" } }),
  ).toEqual({
    block: true,
    reason: "authoring: cannot tell the write target of write",
  });
  expect(
    authoringWriteGuard(DIR, {
      toolName: "shell",
      risk: "exec",
      input: { cwd: "/work/demo/test" },
    }),
  ).toBeUndefined();
  expect(
    authoringWriteGuard(DIR, { toolName: "shell", risk: "exec", input: { cwd: "/" } }),
  ).toEqual({
    block: true,
    reason: "authoring: shell would write outside the target folder (/)",
  });
  expect(
    authoringWriteGuard(DIR, { toolName: "shell", risk: "exec", input: { command: "ls" } }),
  ).toEqual({
    block: true,
    reason: "authoring: cannot tell the working folder of shell",
  });
  // bash는 입력에 작업 폴더가 없다. 호스트가 셸을 대상 폴더로 고정했을 때만 통과하고, 고정이 없으면 막힌다
  const bash = { toolName: "bash", risk: "exec", input: { command: "ls" } } as const;
  expect(authoringWriteGuard(DIR, bash)).toEqual({
    block: true,
    reason: "authoring: cannot tell the working folder of bash",
  });
  expect(authoringWriteGuard(DIR, bash, { shellPinned: true })).toBeUndefined();
  // 고정이 있어도 작업 폴더를 밖으로 적은 호출과, bash가 아닌 셸 도구의 작업 폴더 없는 호출은 막힌다
  expect(
    authoringWriteGuard(
      DIR,
      { toolName: "bash", risk: "exec", input: { command: "ls", cwd: "/work" } },
      { shellPinned: true },
    ),
  ).toEqual({
    block: true,
    reason: "authoring: bash would write outside the target folder (/work)",
  });
  expect(
    authoringWriteGuard(
      DIR,
      { toolName: "shell", risk: "exec", input: { command: "ls" } },
      { shellPinned: true },
    ),
  ).toEqual({ block: true, reason: "authoring: cannot tell the working folder of shell" });
  // 읽기와 위험 등급이 없는 호출은 보지 않는다. 대상 폴더 이름이 접두로 겹치는 옆 폴더는 밖이다
  expect(
    authoringWriteGuard(DIR, { toolName: "read", risk: "read", input: { path: "/etc/hosts" } }),
  ).toBeUndefined();
  expect(
    authoringWriteGuard(DIR, { toolName: "write", input: { path: "/etc/hosts" } }),
  ).toBeUndefined();
  expect(
    authoringWriteGuard(DIR, {
      toolName: "write",
      risk: "write",
      input: { path: "/work/demo-evil/a.ts" },
    }),
  ).toMatchObject({ block: true });
});

test("authoring.package-requires-ask: the confirmation is a yes-or-no question with a stable request id (A-4)", () => {
  const first = packConfirmation("/work/demo", 0);
  expect(first.requestId).toMatch(/^authoring:package:[0-9a-f]{12}:0$/);
  // 같은 질문은 같은 요청 id다. 기록된 답을 돌려받는 근거다
  expect(packConfirmation("/work/demo", 0).requestId).toBe(first.requestId);
  // 거절 뒤 다시 묻는 질문은 다른 번호를 받는다
  const again = packConfirmation("/work/demo", 1);
  expect(again.requestId).toMatch(/^authoring:package:[0-9a-f]{12}:1$/);
  expect(again.requestId.slice(0, -1)).toBe(first.requestId.slice(0, -1));
  expect(first.card.questions.map((question) => [question.id, question.text])).toEqual([
    ["confirm", "다음 폴더를 묶을까요? /work/demo"],
  ]);
  expect(
    first.card.questions.map((question) => [
      question.id,
      question.options.map((option) => option.id),
    ]),
  ).toEqual([["confirm", ["yes", "no"]]]);
});

test("authoring.package-requires-ask: the packing confirmation has its own request id under 64 characters (A-4)", () => {
  const asked = packConfirmation("/out", 0);
  expect(asked.requestId).toMatch(/^authoring:package:[0-9a-f]{12}:0$/);
  expect(asked.requestId.length).toBeLessThanOrEqual(64);
  expect(packConfirmation("/out", 0).requestId).toBe(asked.requestId);
  expect(asked.card.questions.map((question) => question.text)).toEqual([
    "다음 폴더를 묶을까요? /out",
  ]);
});

test("authoring.confirmed-yes: only an answer that selects yes counts, and a value of another shape does not", () => {
  expect(confirmedYes({ confirm: { selected: ["yes"] } })).toBe(true);
  expect(confirmedYes({ confirm: { selected: ["no"] } })).toBe(false);
  expect(confirmedYes({ other: { selected: ["yes"] } })).toBe(false);
  expect(confirmedYes(null)).toBe(false);
  expect(confirmedYes("yes")).toBe(false);
});

test("authoring.replay-dev-only: a shipped build gets dev_mode_required and the runner is not called (A-5)", async () => {
  const calls: string[] = [];
  const report = {
    ok: true,
    commits: 2,
    passed: 2,
    firstDiff: null,
    cuts: [
      { commitIndex: 1, equal: true, firstDiff: null },
      { commitIndex: 2, equal: true, firstDiff: null },
    ],
    effects: { turn: 2, spawn: 0, delegate: 0, post: 0 },
    failure: null,
  };
  const run = (input: { target: string }) => {
    calls.push(input.target);
    return Promise.resolve(ok(report));
  };
  expect(await replayInDevMode(false, run, { target: "demo" })).toEqual(
    err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
  );
  expect(calls).toEqual([]);
  expect(await replayInDevMode(true, run, { target: "demo" })).toEqual(ok(report));
  expect(calls).toEqual(["demo"]);
});

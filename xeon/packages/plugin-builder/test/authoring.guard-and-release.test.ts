import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { AskRequest } from "@fresnel/contracts/extensions";
import {
  authoringWriteGuard,
  installWithConfirmation,
  packWithConfirmation,
  replayInDevMode,
  type Ask,
  type ReleaseDevkit,
} from "../src/index.ts";

const DIR = "/work/demo";

const noAnswer: Ask = () => Promise.resolve({ status: "denied" });

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
    })?.block,
  ).toBe(true);
});

function devkitSpy(): { devkit: ReleaseDevkit; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    devkit: {
      pack: (input) => {
        calls.push(`pack:${input.dir}`);
        return Promise.resolve(ok({ path: "/out", files: ["a"], sha256: "a".repeat(64) }));
      },
      link: (input) => {
        calls.push(`link:${input.source}`);
        return Promise.resolve(ok({ name: "demo", version: "0.1.0", location: "/ext/demo" }));
      },
    },
  };
}

function answering(selected: string, seen: AskRequest[]): Ask {
  return (request) => {
    seen.push(request);
    return Promise.resolve({ status: "answered", answer: { confirm: { selected: [selected] } } });
  };
}

test("authoring.package-requires-ask: nothing is written before a yes, and the question has a stable request id (A-4)", async () => {
  const seen: AskRequest[] = [];
  const no = devkitSpy();
  expect(
    await packWithConfirmation(no.devkit, answering("no", seen), { dir: "/work/demo" }),
  ).toEqual(err({ kind: "denied", message: "packaging was not confirmed" }));
  const denied = devkitSpy();
  expect(await packWithConfirmation(denied.devkit, noAnswer, { dir: "/work/demo" })).toEqual(
    err({ kind: "denied", message: "packaging was not confirmed" }),
  );
  expect(no.calls).toEqual([]);
  expect(denied.calls).toEqual([]);

  const yes = devkitSpy();
  const packed = await packWithConfirmation(yes.devkit, answering("yes", seen), {
    dir: "/work/demo",
  });
  expect(packed).toEqual(ok({ path: "/out", files: ["a"], sha256: "a".repeat(64) }));
  expect(yes.calls).toEqual(["pack:/work/demo"]);
  const ids = seen.map((request) => request.requestId);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toMatch(/^authoring:package:[0-9a-f]{12}:0$/);
  expect(ids[1]).toBe(ids[0]);
  // 거절 뒤 다시 묻는 질문은 다른 번호를 받는다
  const again: AskRequest[] = [];
  await packWithConfirmation(devkitSpy().devkit, answering("no", again), { dir: "/work/demo" }, 1);
  expect(again[0]?.requestId).toMatch(/^authoring:package:[0-9a-f]{12}:1$/);
  expect(again[0]?.requestId.slice(0, -1)).toBe(ids[0]?.slice(0, -1));
  expect(
    seen[0]?.card.questions.map((question) => [
      question.id,
      question.options.map((option) => option.id),
    ]),
  ).toEqual([["confirm", ["yes", "no"]]]);
});

test("authoring.install-requires-ask: link is called only after a yes", async () => {
  const seen: AskRequest[] = [];
  const no = devkitSpy();
  expect((await installWithConfirmation(no.devkit, answering("no", seen), "/out")).ok).toBe(false);
  expect(no.calls).toEqual([]);
  const yes = devkitSpy();
  expect(await installWithConfirmation(yes.devkit, answering("yes", seen), "/out")).toEqual(
    ok({ name: "demo", version: "0.1.0", location: "/ext/demo" }),
  );
  expect(yes.calls).toEqual(["link:/out"]);
  expect(seen[1]?.requestId).toMatch(/^authoring:install:[0-9a-f]{12}:0$/);
  expect(seen[1]?.requestId.length).toBeLessThanOrEqual(64);
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

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import {
  gradeCase,
  parseCase,
  type CommandRunner,
  type EvalCase,
} from "../../../src/assembly/eval/case.ts";

// T-TEST-CASE: 케이스 형식 검증과 규칙 채점(파일, 정규식, 명령 종료 코드, 도구 사용, 비용 상한). 모델을 부르지 않는다.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-case-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function caseOf(checks: unknown[], type = "regression"): EvalCase {
  const parsed = parseCase({ id: "review-finds-null-check", type, prompt: "review it", checks });
  if (!parsed.ok) throw new Error("the test case must be valid");
  return parsed.value;
}

const exits =
  (code: number): CommandRunner =>
  () =>
    Promise.resolve(code);

test("a case parses with its type, and malformed ones are rejected with a path", () => {
  expect(
    parseCase({
      id: "a-1",
      type: "quiet",
      prompt: "x",
      checks: [{ tool_used: { name: "bash", max: 0 } }],
    }).ok,
  ).toBe(true);
  expect(
    parseCase({ id: "A_1", type: "quiet", prompt: "x", checks: [{ max_cost_usd: 1 }] }).ok,
  ).toBe(false);
  expect(parseCase({ id: "a", type: "other", prompt: "x", checks: [{ max_cost_usd: 1 }] }).ok).toBe(
    false,
  );
  expect(parseCase({ id: "a", type: "quiet", prompt: "x", checks: [] }).ok).toBe(false);
  expect(
    parseCase({ id: "a", type: "quiet", prompt: "x", checks: [{ unknown_check: 1 }] }).ok,
  ).toBe(false);
});

test("a passing case lists every check as passed with its detail", async () => {
  const dir = workspace({ "review.md": "missing null check on line 3", "src/a.ts": "x" });
  const grade = await gradeCase(
    caseOf([
      { file_exists: "review.md" },
      { file_matches: { path: "review.md", pattern: "null check" } },
      { command: "bun test" },
      { tool_used: { name: "read", min: 1 } },
      { max_cost_usd: 0.5 },
    ]),
    { workspace: dir, toolCalls: ["read", "read", "grep"], costUsd: 0.25 },
    exits(0),
  );
  expect(grade).toEqual({
    passed: true,
    results: [
      { index: 0, check: "file_exists", passed: true, detail: "found" },
      { index: 1, check: "file_matches", passed: true, detail: "matched" },
      { index: 2, check: "command", passed: true, detail: "exit 0, expected 0" },
      { index: 3, check: "tool_used", passed: true, detail: "read called 2 times" },
      { index: 4, check: "max_cost_usd", passed: true, detail: "cost 0.25 limit 0.5" },
    ],
  });
});

test("each failing check says why, and a failure does not stop the later checks", async () => {
  const dir = workspace({ "review.md": "all fine" });
  const grade = await gradeCase(
    caseOf([
      { file_exists: "missing.md" },
      { file_matches: { path: "review.md", pattern: "null check" } },
      { command: "bun test", exit: 0 },
      { tool_used: { name: "bash", max: 0 } },
      { max_cost_usd: 0.1 },
    ]),
    { workspace: dir, toolCalls: ["bash"], costUsd: 0.25 },
    exits(1),
  );
  expect(grade.passed).toBe(false);
  expect(grade.results.map((result) => [result.passed, result.detail])).toEqual([
    [false, "missing"],
    [false, "no_match"],
    [false, "exit 1, expected 0"],
    [false, "bash called 1 times"],
    [false, "cost 0.25 limit 0.1"],
  ]);
});

test("paths outside the workspace and invalid patterns fail instead of being read or thrown", async () => {
  const dir = workspace({ "ok.txt": "x" });
  const grade = await gradeCase(
    caseOf([
      { file_exists: "../outside.txt" },
      { file_exists: "/etc/hosts" },
      { file_matches: { path: "ok.txt", pattern: "(" } },
    ]),
    { workspace: dir, toolCalls: [], costUsd: 0 },
    exits(0),
  );
  expect(grade.results.map((result) => result.detail)).toEqual([
    "path_outside_workspace",
    "path_outside_workspace",
    "invalid_pattern",
  ]);
});

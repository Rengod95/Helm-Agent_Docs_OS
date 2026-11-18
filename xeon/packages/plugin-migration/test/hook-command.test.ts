// 경로 형태별 시험(migration.md §4.3.5 [제안]): 명령 문자열이 원본 폴더 안의 스크립트 하나로 풀리는지, 풀리지 않으면 이유가 무엇인지.
import { describe, expect, test } from "bun:test";
import {
  parseHookCommand,
  type HookCommandCode,
  type HookCommandContext,
} from "../src/adapters/hook-command.ts";
import type { HookRunner } from "../src/index.ts";

const HOME = "/home/sample";
const APP = `${HOME}/work/app`;
const USER: HookCommandContext = {
  folder: `${HOME}/.claude`,
  projectDir: undefined,
  homeDir: HOME,
};
const PROJECT: HookCommandContext = { folder: APP, projectDir: APP, homeDir: HOME };

describe("hook command: 스크립트로 풀리는 형태", () => {
  test.each<[string, HookCommandContext, string, HookRunner, readonly string[]]>([
    [
      "$CLAUDE_PROJECT_DIR/.claude/hooks/check.sh",
      PROJECT,
      `${APP}/.claude/hooks/check.sh`,
      "sh",
      [],
    ],
    [
      '"$CLAUDE_PROJECT_DIR"/.claude/hooks/check.sh',
      PROJECT,
      `${APP}/.claude/hooks/check.sh`,
      "sh",
      [],
    ],
    [
      "${CLAUDE_PROJECT_DIR}/.claude/hooks/check.py",
      PROJECT,
      `${APP}/.claude/hooks/check.py`,
      "python3",
      [],
    ],
    ["./scripts/guard.js", PROJECT, `${APP}/scripts/guard.js`, "node", []],
    [".claude/hooks/x.mjs", PROJECT, `${APP}/.claude/hooks/x.mjs`, "node", []],
    [".claude/hooks/x.ts", PROJECT, `${APP}/.claude/hooks/x.ts`, "bun", []],
    [
      "$CLAUDE_PROJECT_DIR/.claude/hooks/x.sh --strict",
      PROJECT,
      `${APP}/.claude/hooks/x.sh`,
      "sh",
      ["--strict"],
    ],
    ["bash .claude/hooks/x.sh", PROJECT, `${APP}/.claude/hooks/x.sh`, "bash", []],
    ["sh ./x.sh", PROJECT, `${APP}/x.sh`, "sh", []],
    ["~/.claude/hooks/x.sh", USER, `${HOME}/.claude/hooks/x.sh`, "sh", []],
    ["$HOME/.claude/hooks/x.sh", USER, `${HOME}/.claude/hooks/x.sh`, "sh", []],
    ["/home/sample/.claude/hooks/x.sh", USER, `${HOME}/.claude/hooks/x.sh`, "sh", []],
  ])("%s는 스크립트다", (command, ctx, path, runner, args) => {
    const parsed = parseHookCommand(command, ctx);
    expect(parsed.kind).toBe("script");
    if (parsed.kind !== "script") return;
    expect(parsed.path).toBe(path);
    expect(parsed.runner).toBe(runner);
    expect(parsed.args).toEqual(args);
    expect(parsed.fileName).toBe(path.slice(path.lastIndexOf("/") + 1));
  });
});

describe("hook command: 옮기지 않는 이유", () => {
  test.each<[string, HookCommandContext, HookCommandCode]>([
    // 인라인 셸: 파이프, 연결, 리다이렉션, 명령 치환, 줄바꿈, 백틱, 역슬래시
    ["cat .claude/x.sh | sh", PROJECT, "inline_command"],
    ["echo a && ./x.sh", PROJECT, "inline_command"],
    ["./x.sh > /tmp/out", PROJECT, "inline_command"],
    ["$(whoami) ./x.sh", PROJECT, "inline_command"],
    ["`whoami` ./x.sh", PROJECT, "inline_command"],
    ["./x.sh\nrm -rf /", PROJECT, "inline_command"],
    ["\\./x.sh", PROJECT, "inline_command"],
    // 프로그램 이름만 있는 명령은 스크립트가 아니다
    ["jq -r .tool_input", PROJECT, "inline_command"],
    ["npx prettier --check", PROJECT, "inline_command"],
    ["FOO=1 ./x.sh", PROJECT, "inline_command"],
    ["sh", PROJECT, "inline_command"],
    ["", PROJECT, "inline_command"],
    // 알 수 없는 변수, 작은따옴표 안의 달러, 짝이 안 맞는 따옴표
    ["$FOO/x.sh", PROJECT, "inline_command"],
    ["'$CLAUDE_PROJECT_DIR'/x.sh", PROJECT, "inline_command"],
    ['"./x.sh', PROJECT, "inline_command"],
    // 실행기 단어와 확장자가 맞지 않는다
    ["python3 .claude/hooks/x.sh", PROJECT, "inline_command"],
    ["bun ./x.sh", PROJECT, "inline_command"],
    // 인자에 변수가 있거나 인자가 너무 많다
    ['./x.sh --a "$HOME"', PROJECT, "inline_command"],
    [`./x.sh${" a".repeat(17)}`, PROJECT, "inline_command"],
    // 원본 폴더 밖
    ["$CLAUDE_PROJECT_DIR/../other/x.sh", PROJECT, "script_outside_root"],
    ["/etc/x.sh", PROJECT, "script_outside_root"],
    ["~/scripts/x.sh", USER, "script_outside_root"],
    ["$CLAUDE_PROJECT_DIR/x.sh", USER, "script_outside_root"],
    ["./x.sh", USER, "script_outside_root"],
    [".claude/hooks/x.sh", USER, "script_outside_root"],
    // 알 수 없는 확장자
    ["./x.txt", PROJECT, "unknown_runner"],
    ["./x", PROJECT, "unknown_runner"],
  ])("%s는 %s", (command, ctx, code) => {
    expect(parseHookCommand(command, ctx)).toEqual({ kind: "blocked", code });
  });
});

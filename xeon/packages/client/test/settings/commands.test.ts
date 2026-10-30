import { describe, expect, test } from "bun:test";
import type { CommandListResult, CommandRunResult } from "@xeon/contracts/wire";
import {
  commandListView,
  completeSlash,
  slashLineOf,
  slashStepOf,
} from "../../src/settings/index.ts";

// 슬래시 명령 view-model: 입력 줄 판정, command.list 목록·자동완성, command.run 결과 한 걸음.

const LIST: CommandListResult = {
  commands: [
    {
      name: "learning",
      description: "학습 제안을 다룬다",
      argumentHint: "<sub>",
      args: [{ name: "sub", choices: ["list", "approve"] }],
      kind: "action",
      source: "extension",
      origin: "group-learning",
      hasShell: false,
    },
    {
      name: "helm",
      description: "Helm 그룹을 다룬다",
      argumentHint: "<start|stop>",
      args: [{ name: "action", choices: ["start", "stop", "status"] }],
      kind: "action",
      source: "extension",
      origin: "group-helm",
      hasShell: false,
    },
    {
      name: "review",
      description: "검토 템플릿",
      argumentHint: null,
      args: [],
      kind: "template",
      source: "project",
      origin: ".xeon/commands/review.md",
      hasShell: true,
    },
  ],
};

describe("slashLineOf", () => {
  test("a slash command line keeps the whole text and its name", () => {
    expect(slashLineOf("/helm start")).toEqual({ name: "helm", text: "/helm start" });
    expect(slashLineOf("/learning")).toEqual({ name: "learning", text: "/learning" });
    expect(slashLineOf("/plan 설계\n둘째 줄")).toEqual({
      name: "plan",
      text: "/plan 설계\n둘째 줄",
    });
    expect(slashLineOf("/group:run go")).toEqual({ name: "group:run", text: "/group:run go" });
  });

  test("paths, capital names and plain text are chat input", () => {
    expect(slashLineOf("/usr/bin/env")).toBeNull();
    expect(slashLineOf("/Foo")).toBeNull();
    expect(slashLineOf("/")).toBeNull();
    expect(slashLineOf("/ helm")).toBeNull();
    expect(slashLineOf("hello /helm")).toBeNull();
    expect(slashLineOf(" /helm")).toBeNull();
  });
});

describe("commandListView and completeSlash", () => {
  const rows = commandListView(LIST);

  test("rows are sorted by name and carry label, hint and shell flag", () => {
    expect(rows.map((row) => row.label)).toEqual(["/helm", "/learning", "/review"]);
    expect(rows[0]).toEqual({
      name: "helm",
      label: "/helm",
      description: "Helm 그룹을 다룬다",
      hint: "<start|stop>",
      kind: "action",
      origin: "group-helm",
      needsShellConfirm: false,
      firstChoices: ["start", "stop", "status"],
    });
    expect(rows[2]?.needsShellConfirm).toBe(true);
    expect(rows[2]?.firstChoices).toEqual([]);
  });

  test("a name prefix completes names and a first argument prefix completes its choices", () => {
    expect(completeSlash(rows, "/")).toEqual(["/helm", "/learning", "/review"]);
    expect(completeSlash(rows, "/l")).toEqual(["/learning"]);
    expect(completeSlash(rows, "/helm ")).toEqual(["/helm start", "/helm stop", "/helm status"]);
    expect(completeSlash(rows, "/helm st")).toEqual(["/helm start", "/helm stop", "/helm status"]);
    expect(completeSlash(rows, "/helm sta")).toEqual(["/helm start", "/helm status"]);
    expect(completeSlash(rows, "/helm start now")).toEqual([]);
    expect(completeSlash(rows, "/nope x")).toEqual([]);
    expect(completeSlash(rows, "helm")).toEqual([]);
  });
});

describe("slashStepOf", () => {
  const cases: readonly [CommandRunResult, ReturnType<typeof slashStepOf>][] = [
    [{ status: "not_command" }, { kind: "chat" }],
    [
      { status: "expanded", name: "review", text: "검토해 줘" },
      { kind: "send", name: "review", text: "검토해 줘" },
    ],
    [
      {
        status: "needs_confirmation",
        name: "review",
        shell: [
          { index: 1, command: "git diff" },
          { index: 0, command: "git status" },
        ],
      },
      { kind: "confirm", name: "review", commands: ["git status", "git diff"] },
    ],
    [
      { status: "done", name: "helm", message: "시작했다", result: { started: true } },
      { kind: "show", name: "helm", message: "시작했다", result: { started: true } },
    ],
  ];
  test.each(cases)("%j", (result, step) => {
    expect(slashStepOf(result)).toEqual(step);
  });
});

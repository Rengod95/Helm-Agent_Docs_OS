import { describe, expect, test } from "bun:test";
import { createCommandsService } from "../src/commands/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { memoryCommandFiles } from "./support/memory-command-files.ts";

const PROJECT = "/work/.xeon/commands";

function setup(files: Record<string, string>) {
  const commandFiles = memoryCommandFiles(files);
  const h = harness({ commandFiles });
  return { h, commandFiles, ...createCommandsService(h.deps) };
}

describe("명령 파일 읽기", () => {
  test("앞머리가 없으면 본문 첫 줄 앞 60자가 설명이다", async () => {
    const long = "가".repeat(70);
    const { api } = setup({
      [`${PROJECT}/plain.md`]: "첫 줄 설명\n둘째 줄",
      [`${PROJECT}/long.md`]: `${long}\n끝`,
    });
    const { commands } = await api.list({}, callOptions(newThread()));
    const byName = new Map(commands.map((command) => [command.name, command]));
    expect(byName.get("plain")).toMatchObject({
      description: "첫 줄 설명",
      argumentHint: null,
      args: [],
      kind: "template",
      source: "project",
      origin: `${PROJECT}/plain.md`,
      hasShell: false,
    });
    expect(byName.get("long")?.description).toBe(`${"가".repeat(60)}...`);
  });

  test("description과 argument-hint와 args 필드를 읽는다", async () => {
    const { api } = setup({
      [`${PROJECT}/research.md`]: `---
description: 주제를 탐구한다
argument-hint: <주제> [깊이]
args:
  - { name: topic, required: true }
  - { name: depth, choices: [quick, deep] }
---
$1에 대해 \${2:-quick} 수준으로 탐구하라. 참고: !{git log --oneline -5}`,
    });
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands).toEqual([
      {
        name: "research",
        description: "주제를 탐구한다",
        argumentHint: "<주제> [깊이]",
        args: [
          { name: "topic", required: true },
          { name: "depth", choices: ["quick", "deep"] },
        ],
        kind: "template",
        source: "project",
        origin: `${PROJECT}/research.md`,
        hasShell: true,
      },
    ]);
  });

  test("args 필드는 자동완성 정보일 뿐 치환에 영향이 없다", async () => {
    const { api } = setup({
      [`${PROJECT}/t.md`]: "---\nargs:\n  - { name: topic, required: true }\n---\n[$1]",
    });
    const out = await api.run({ text: "/t" }, callOptions(newThread(), { requestId: "r" }));
    expect(out).toEqual({ status: "expanded", name: "t", text: "[]" });
  });

  test("YAML 오류인 파일만 건너뛰고 진단을 남긴다", async () => {
    const { h, api } = setup({
      [`${PROJECT}/broken.md`]: "---\ndescription: Broken: unquoted colon\n---\nDo something.\n",
      [`${PROJECT}/fine.md`]: "fine",
    });
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands.map((command) => command.name)).toEqual(["fine"]);
    const skipped = h.lines.filter((line) => line.event === "dialog.command_file_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.fields).toMatchObject({ path: `${PROJECT}/broken.md` });
  });

  test("args 선언이 틀리면 그 필드만 무시하고 명령은 남긴다", async () => {
    const { h, api } = setup({
      [`${PROJECT}/odd.md`]: "---\nargs: not-a-list\ndescription: 오류 args\n---\nbody",
    });
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands).toMatchObject([{ name: "odd", description: "오류 args", args: [] }]);
    expect(h.lines.map((line) => line.event)).toContain("dialog.command_file_skipped");
  });

  test("명령 이름 규칙에 맞지 않는 파일 이름은 건너뛴다. 콜론 이름은 받는다", async () => {
    const { api } = setup({
      [`${PROJECT}/Bad Name.md`]: "x",
      [`${PROJECT}/review:start.md`]: "x",
      [`${PROJECT}/notes.txt`]: "x",
    });
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands.map((command) => command.name)).toEqual(["review:start"]);
  });

  test("끊어진 심볼릭 링크는 조용히 건너뛰고 디렉터리가 없어도 오류가 아니다", async () => {
    const { h, api, commandFiles } = setup({ [`${PROJECT}/ok.md`]: "ok" });
    commandFiles.brokenLink(`${PROJECT}/gone.md`);
    const { commands } = await api.list({}, callOptions(newThread()));
    expect(commands.map((command) => command.name)).toEqual(["ok"]);
    expect(h.lines).toEqual([]);
  });

  test("파일이 바뀌지 않았으면 다시 읽지 않고, 바뀌면 다시 읽는다", async () => {
    const { commandFiles, api } = setup({ [`${PROJECT}/a.md`]: "one" });
    const options = callOptions(newThread(), { requestId: "r" });
    await api.list({}, options);
    const readsAfterFirst = commandFiles.readCalls();
    await api.list({}, options);
    await api.run({ text: "/a" }, options);
    expect(commandFiles.readCalls()).toBe(readsAfterFirst);
    commandFiles.put(`${PROJECT}/a.md`, "two");
    expect(await api.run({ text: "/a" }, options)).toMatchObject({ text: "two" });
    expect(commandFiles.readCalls()).toBeGreaterThan(readsAfterFirst);
  });
});

describe("모델에 대한 광고", () => {
  test("이름 순서로 목록을 만들고 설정이 끄면 만들지 않는다", async () => {
    const { advertisement, api } = setup({
      [`${PROJECT}/zeta.md`]: "---\ndescription: 마지막\n---\nz",
      [`${PROJECT}/alpha.md`]: "---\ndescription: 처음\n---\na",
    });
    const thread = newThread();
    const signal = new AbortController().signal;
    const text = await advertisement(thread, signal);
    expect(text?.split("\n").slice(1)).toEqual(["- /alpha: 처음", "- /zeta: 마지막"]);
    // 명령이 늘면 조각이 바뀐다
    await api.register({ name: "mid", description: "중간", template: "m", origin: "grp" });
    expect(await advertisement(thread, signal)).toContain("- /mid: 중간");

    const off = setup({ [`${PROJECT}/alpha.md`]: "a" });
    const disabled = harness({
      commandFiles: memoryCommandFiles({ [`${PROJECT}/alpha.md`]: "a" }),
      layers: [{ scope: "user", values: new Map([["l2.dialog.commands.advertise", false]]) }],
    });
    expect(
      await createCommandsService(disabled.deps).advertisement(thread, signal),
    ).toBeUndefined();
    expect(off.h.deps.settings(thread).commands.advertise).toBe(true);
  });

  test("명령이 없으면 조각이 없고 50개까지만 싣는다", async () => {
    const empty = setup({});
    const thread = newThread();
    const signal = new AbortController().signal;
    expect(await empty.advertisement(thread, signal)).toBeUndefined();
    const files = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `${PROJECT}/c${String(index).padStart(2, "0")}.md`,
        `body ${index}`,
      ]),
    );
    const many = setup(files);
    const text = await many.advertisement(thread, signal);
    expect(text?.split("\n")).toHaveLength(51);
  });
});

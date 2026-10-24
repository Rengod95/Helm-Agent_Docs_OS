import { describe, expect, test } from "bun:test";
import { CapabilityError } from "@xeon/contracts/capabilities";
import { createCommandsService } from "../src/commands/service.ts";
import { callOptions, fakeShell, harness, newThread } from "./support/harness.ts";
import { memoryCommandFiles } from "./support/memory-command-files.ts";

const PROJECT = "/work/.xeon/commands";

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected a CapabilityError");
}

function setup(template: string, options: Parameters<typeof harness>[0] = {}) {
  const commandFiles = memoryCommandFiles({ [`${PROJECT}/log.md`]: template });
  const h = harness({ commandFiles, ...options });
  const service = createCommandsService(h.deps);
  return { h, ...service };
}

describe("셸 주입 확인 게이트", () => {
  test("confirmShell 없이 run하면 셸 호출 0회와 needs_confirmation이다", async () => {
    const { h, api } = setup("최근: !{git log --oneline -$1} 끝");
    const options = callOptions(newThread(), { requestId: "r1" });
    const out = await api.run({ text: "/log 3" }, options);
    expect(out).toEqual({
      status: "needs_confirmation",
      name: "log",
      shell: [{ index: 0, command: "git log --oneline -3" }],
    });
    expect(h.shell.calls).toHaveLength(0);
  });

  test("확인한 뒤에는 순서대로 실행하고 결과로 치환한다", async () => {
    const { h, api } = setup("A=!{echo a} B=!{echo b}\n$ARGUMENTS");
    h.shell.reply({ output: "one\n" }, { output: "two\n\n" });
    const options = callOptions(newThread(), { requestId: "r1" });
    const out = await api.run({ text: "/log tail", confirmShell: true }, options);
    expect(out).toEqual({ status: "expanded", name: "log", text: "A=one B=two\ntail" });
    expect(h.shell.calls).toEqual([
      { command: "echo a", requestId: "r1:sh0" },
      { command: "echo b", requestId: "r1:sh1" },
    ]);
  });

  test("실패한 명령은 [셸 오류: 코드]로 치환하고 계속한다", async () => {
    const { h, api } = setup("!{false}|!{echo ok}");
    h.shell.reply({ kind: "failed", code: "1", message: "exit 1" }, { output: "ok" });
    const out = await api.run(
      { text: "/log", confirmShell: true },
      callOptions(newThread(), { requestId: "r1" }),
    );
    expect(out).toEqual({ status: "expanded", name: "log", text: "[셸 오류: 1]|ok" });
  });

  test("거부된 명령은 denied로 끝나고 뒤 명령을 실행하지 않는다", async () => {
    const { h, api } = setup("!{rm -rf /} !{echo never}");
    h.shell.reply({ kind: "denied", message: "blocked by policy" });
    const error = await rejection(
      api.run({ text: "/log", confirmShell: true }, callOptions(newThread(), { requestId: "r1" })),
    );
    expect(error.data).toMatchObject({ code: "denied", detail: { index: 0, command: "rm -rf /" } });
    expect(h.shell.calls).toHaveLength(1);
  });

  test("설정이 off면 command_shell_disabled다", async () => {
    const { h, api } = setup("!{echo hi}", {
      layers: [{ scope: "user", values: new Map([["l2.dialog.commands.shellInjection", "off"]]) }],
    });
    const error = await rejection(
      api.run({ text: "/log", confirmShell: true }, callOptions(newThread(), { requestId: "r1" })),
    );
    expect(error.data.code).toBe("command_shell_disabled");
    expect(h.shell.calls).toHaveLength(0);
  });

  test("셸 포트가 없거나 requestId가 없으면 실행하지 않는다", async () => {
    const missing = setup("!{echo hi}", { shell: null });
    const error = await rejection(
      missing.api.run(
        { text: "/log", confirmShell: true },
        callOptions(newThread(), { requestId: "r1" }),
      ),
    );
    expect(error.data).toMatchObject({ code: "unavailable", detail: { reason: "shell_missing" } });

    const { h, api } = setup("!{echo hi}");
    const noKey = await rejection(
      api.run({ text: "/log", confirmShell: true }, callOptions(newThread())),
    );
    expect(noKey.data.code).toBe("invalid_input");
    expect(h.shell.calls).toHaveLength(0);
  });

  test("expand는 아무것도 실행하지 않고 셸 자리를 그대로 둔다", async () => {
    const { h, api } = setup("x !{echo $1} y");
    const out = await api.expand({ text: "/log hi" }, callOptions(newThread()));
    expect(out).toEqual({
      matched: true,
      name: "log",
      kind: "template",
      args: ["hi"],
      text: "x !{echo hi} y",
      shell: [{ index: 0, command: "echo hi" }],
    });
    expect(h.shell.calls).toHaveLength(0);
  });

  test("인자 값이 만든 !{…}는 셸 자리가 되지 않는다", async () => {
    const { h, api } = setup("note: $1");
    const out = await api.run(
      { text: "/log '!{rm x}'" },
      callOptions(newThread(), { requestId: "r1" }),
    );
    expect(out).toEqual({ status: "expanded", name: "log", text: "note: !{rm x}" });
    expect(h.shell.calls).toHaveLength(0);
  });

  test("중괄호는 중첩을 세고 닫히지 않은 !{는 글자로 둔다", async () => {
    const { api } = setup("a !{echo ${HOME:-x} {y}} b !{open");
    const out = await api.expand({ text: "/log" }, callOptions(newThread()));
    expect(out).toMatchObject({
      matched: true,
      text: "a !{echo ${HOME:-x} {y}} b !{open",
      shell: [{ index: 0, command: "echo ${HOME:-x} {y}" }],
    });
  });

  test("input 지점 핸들러는 셸이 있는 템플릿을 치환하지 않는다", async () => {
    const plain = setup("hello $1");
    const thread = newThread();
    const signal = new AbortController().signal;
    expect(await plain.transformInput("/log world", thread, signal)).toBe("hello world");
    expect(await plain.transformInput("not a command", thread, signal)).toBeUndefined();
    expect(await plain.transformInput("/unknown x", thread, signal)).toBeUndefined();

    const withShell = setup("hi !{echo x}");
    expect(await withShell.transformInput("/log", thread, signal)).toBeUndefined();
    expect(withShell.h.shell.calls).toHaveLength(0);
  });

  test("셸 주입이 열여섯 개를 넘는 파일은 건너뛰고 로그를 남긴다", async () => {
    const many = Array.from({ length: 17 }, (_, index) => `!{echo ${index}}`).join(" ");
    const { h, api } = setup(many);
    const listed = await api.list({}, callOptions(newThread()));
    expect(listed.commands).toEqual([]);
    expect(h.lines.map((line) => line.event)).toContain("dialog.command_file_skipped");
  });

  test("fakeShell 기본 응답은 빈 출력 성공이다", async () => {
    const shell = fakeShell();
    const ran = await shell.run("x", {
      threadId: newThread(),
      requestId: "r",
      signal: new AbortController().signal,
    });
    expect(ran).toEqual({ ok: true, value: { output: "" } });
  });
});

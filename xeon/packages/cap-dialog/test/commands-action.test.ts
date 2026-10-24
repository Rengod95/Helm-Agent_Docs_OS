import { describe, expect, test } from "bun:test";
import { CapabilityError } from "@xeon/contracts/capabilities";
import { createCommandsService } from "../src/commands/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected a CapabilityError");
}

describe("동작 명령", () => {
  test("처리기가 인자와 requestId를 받는다", async () => {
    const { api } = createCommandsService(harness().deps);
    const seen: { args: readonly string[]; requestId: string; threadId: string }[] = [];
    api.registerAction({ name: "goal", description: "목표", origin: "work" }, (args, ctx) => {
      seen.push({ args, requestId: ctx.requestId, threadId: ctx.threadId });
      return Promise.resolve({ message: "설정함", result: { ok: true } });
    });
    const thread = newThread();
    const out = await api.run(
      { text: '/goal "make it fast" now' },
      callOptions(thread, { requestId: "input-1" }),
    );
    expect(out).toEqual({ status: "done", name: "goal", message: "설정함", result: { ok: true } });
    expect(seen).toEqual([
      { args: ["make it fast", "now"], requestId: "input-1", threadId: thread },
    ]);
  });

  test("결과가 없으면 result는 null이다", async () => {
    const { api } = createCommandsService(harness().deps);
    api.registerAction({ name: "ping", description: "x", origin: "work" }, () =>
      Promise.resolve({ message: null }),
    );
    expect(await api.run({ text: "/ping" }, callOptions(newThread(), { requestId: "r" }))).toEqual({
      status: "done",
      name: "ping",
      message: null,
      result: null,
    });
  });

  test("args 선언 위반은 command_args_invalid다", async () => {
    const { api } = createCommandsService(harness().deps);
    let called = 0;
    api.registerAction(
      {
        name: "mode",
        description: "방식",
        origin: "work",
        args: [
          { name: "kind", required: true, choices: ["fast", "safe"] },
          { name: "note", rest: true },
        ],
      },
      () => {
        called += 1;
        return Promise.resolve({ message: null });
      },
    );
    const options = callOptions(newThread(), { requestId: "r" });
    const missing = await rejection(api.run({ text: "/mode" }, options));
    expect(missing.data).toMatchObject({ code: "command_args_invalid" });
    const wrong = await rejection(api.run({ text: "/mode turbo" }, options));
    expect(wrong.data.code).toBe("command_args_invalid");
    expect(called).toBe(0);
    expect(await api.run({ text: "/mode fast a b c" }, options)).toMatchObject({ status: "done" });
    expect(called).toBe(1);
  });

  test("선택 인자와 개수 초과", async () => {
    const { api } = createCommandsService(harness().deps);
    api.registerAction(
      { name: "one", description: "x", origin: "work", args: [{ name: "a" }] },
      () => Promise.resolve({ message: null }),
    );
    const options = callOptions(newThread(), { requestId: "r" });
    expect(await api.run({ text: "/one" }, options)).toMatchObject({ status: "done" });
    expect((await rejection(api.run({ text: "/one a b" }, options))).data.code).toBe(
      "command_args_invalid",
    );
  });

  test("해제 함수 뒤에는 not_command다", async () => {
    const { api } = createCommandsService(harness().deps);
    const dispose = api.registerAction({ name: "tmp", description: "x", origin: "work" }, () =>
      Promise.resolve({ message: null }),
    );
    const options = callOptions(newThread(), { requestId: "r" });
    expect((await api.run({ text: "/tmp" }, options)).status).toBe("done");
    dispose();
    expect(await api.run({ text: "/tmp" }, options)).toEqual({ status: "not_command" });
    // 해제하면 같은 이름을 다시 등록할 수 있다
    expect(() =>
      api.registerAction({ name: "tmp", description: "x", origin: "work" }, () =>
        Promise.resolve({ message: null }),
      ),
    ).not.toThrow();
  });

  test("스레드나 requestId가 없으면 invalid_input이고 처리기를 부르지 않는다", async () => {
    const { api } = createCommandsService(harness().deps);
    let called = 0;
    api.registerAction({ name: "x", description: "x", origin: "work" }, () => {
      called += 1;
      return Promise.resolve({ message: null });
    });
    expect((await rejection(api.run({ text: "/x" }, { requestId: "r" }))).data.code).toBe(
      "invalid_input",
    );
    expect((await rejection(api.run({ text: "/x" }, callOptions(newThread())))).data.code).toBe(
      "invalid_input",
    );
    expect(called).toBe(0);
  });

  test("이름 규칙을 어기면 invalid_input이다", async () => {
    const { api } = createCommandsService(harness().deps);
    let thrown: unknown;
    try {
      api.registerAction({ name: "Bad Name", description: "x", origin: "work" }, () =>
        Promise.resolve({ message: null }),
      );
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown instanceof CapabilityError ? thrown.data.code : "").toBe("invalid_input");
    expect(
      (await rejection(api.register({ name: "Bad", description: "x", template: "t", origin: "o" })))
        .data.code,
    ).toBe("invalid_input");
  });

  test("동작 명령은 expand에서 인자만 돌려주고 템플릿은 인자를 치환해 돌려준다", async () => {
    const { api } = createCommandsService(harness().deps);
    api.registerAction({ name: "goal", description: "x", origin: "work" }, () =>
      Promise.resolve({ message: null }),
    );
    await api.register({
      name: "greet",
      description: "인사",
      argumentHint: "<이름>",
      template: "안녕 ${1:-세상}",
      origin: "grp",
    });
    const options = callOptions(newThread());
    expect(await api.expand({ text: "/goal a b" }, options)).toEqual({
      matched: true,
      name: "goal",
      kind: "action",
      args: ["a", "b"],
    });
    expect(await api.expand({ text: "/greet" }, options)).toMatchObject({ text: "안녕 세상" });
    expect(await api.expand({ text: "/greet 철수" }, options)).toMatchObject({ text: "안녕 철수" });
    expect(await api.expand({ text: "plain" }, options)).toEqual({ matched: false });
    expect(await api.expand({ text: "/nothing" }, options)).toEqual({ matched: false });
  });
});

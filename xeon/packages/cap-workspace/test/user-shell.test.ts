import { describe, expect, test } from "bun:test";
import { WorkspaceShell, WorkspaceShellKey, type CallOptions } from "@xeon/contracts/capabilities";
import { fakeRunContext, fakeSession, realTools, sequentialIds } from "@xeon/core-tools/testing";
import { createShellApi } from "../src/shell/run.ts";
import { depsFor, fakeSandbox } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// 사용자가 직접 친 명령(`!명령`)의 경로: core-tools의 실제 `runUserShell`이 정책과 지점을 지나 실제 `bash` 도구(cap-workspace의 셸 서비스)를 부른다.
// 셸 서비스 아래는 메모리 실행 환경과 대역 샌드박스다. 루프의 `runUserBash`는 아직 자리표시라 이 시험은 도구 서비스를 직접 부른다.

const NOW = 1_767_571_200_000;

async function wired() {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const shell = createShellApi(depsFor(env, { sandbox: fakeSandbox() }));
  const contexts: (CallOptions["context"] | undefined)[] = [];
  const ids = sequentialIds(13_000);
  const clock = { now: () => NOW };
  const session = fakeSession({ clock, ids });
  const l1 = await realTools({
    session,
    clock,
    ids,
    resolveCapability: (key) =>
      key.capability === WorkspaceShell.id
        ? {
            ...shell,
            run: (input: Parameters<typeof shell.run>[0], options?: CallOptions) => {
              contexts.push(options?.context);
              return shell.run(input, options);
            },
          }
        : undefined,
  });
  const registered = l1.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: WorkspaceShellKey,
  });
  expect(registered.ok).toBe(true);
  const threadId = ids.next("thr");
  await l1.openThread(threadId);
  return { env, l1, session, contexts, run: () => fakeRunContext({ session, ids, threadId }) };
}

function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.map((part) => part.text ?? "").join("");
}

describe("runUserShell 위의 bash", () => {
  test("사용자 명령은 caller main, 대화형 문맥으로 셸 서비스로 전달되고 출력이 돌아온다", async () => {
    const { env, l1, session, contexts, run } = await wired();
    env.reply({ chunks: [{ text: "hello\n" }], exitCode: 0 });
    const record = await l1.tools.runUserShell(
      { command: "echo hello", includeInContext: false },
      run(),
    );
    expect(record.isError).toBe(false);
    expect(textOf(record.content)).toBe("hello\n");
    expect(env.calls[0]?.command).toBe("echo hello");
    expect(contexts[0]).toMatchObject({
      caller: { kind: "model", agent: "main" },
      interactive: true,
    });
    const kinds: string[] = session.events.map((event) => event.kind);
    expect(kinds).toEqual(["effect.intent", "effect.exec", "effect.result"]);
  });

  test("0이 아닌 종료는 도구 오류 기록으로 돌아오고 종료 코드가 남는다", async () => {
    const { env, l1, run } = await wired();
    env.reply({ chunks: [{ text: "boom\n" }], exitCode: 3 });
    const record = await l1.tools.runUserShell(
      { command: "false", includeInContext: false },
      run(),
    );
    expect(record.isError).toBe(true);
    expect(textOf(record.content)).toBe("[exit_nonzero] exit code 3\nboom\n");
    expect(record.details).toMatchObject({ code: "exit_nonzero", detail: { exitCode: 3 } });
  });
});

import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { answeringModels, createRealCli, type RealCli } from "./support/real-host.ts";
import { scriptedInput } from "./support/script.ts";

// G1-01, G2-01: 실제 호스트(@xeon/host)와 모델 테이프 위의 슬래시 명령. test/slash-commands.test.ts의 가짜 처리기를 실제 처리기로 바꿔
// 같은 흐름을 다시 확인한다: command.list { threadId }, command.run(done·expanded), 프로젝트 신뢰 뒤의 프로젝트 명령, /compact.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;

interface Started {
  readonly cli: RealCli;
  /** 다음 실행의 입력 대본을 바꾼다 */
  readonly script: (lines: readonly string[]) => void;
}

function start(options: Parameters<typeof createRealCli>[0], lines: readonly string[]): Started {
  const state = { input: scriptedInput([...lines, "/quit"]) };
  const cli = createRealCli({
    ...options,
    harness: {
      ...options?.harness,
      terminal: TTY,
      readLine: (prompt, signal) => state.input.readLine(prompt, signal),
    },
  });
  clis.push(cli);
  return {
    cli,
    script: (next) => {
      state.input = scriptedInput([...next, "/quit"]);
    },
  };
}

test("/help, /tasks and /plan come from the real engine, and command.list carries the opened thread's id", async () => {
  const { cli } = start({ models: answeringModels("slash-none", []) }, [
    "/help",
    "/tasks",
    "/plan",
  ]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  const out = cli.harness.stdoutText();
  expect(out).toContain("엔진 명령\n");
  expect(out).toMatch(/\/plan .*\n/);
  expect(out).toMatch(/\/tasks .*\n/);
  expect(out).toContain("계획 모드를 시작했습니다");
  expect(out).toContain("(작업 없음)");
  const listed = cli.sent("command.list");
  expect(listed).toHaveLength(1);
  const created = cli.sent("command.run");
  expect(created.map((request) => request.params["text"])).toEqual(["/tasks", "/plan"]);
  expect(listed[0]?.params["threadId"]).toBe(created[0]?.params["threadId"]);
  // 동작 명령은 turn을 만들지 않는다
  expect(cli.sent("turn.start")).toEqual([]);
}, 60_000);

test("a project command file runs only after the folder is trusted, and a template is sent as the user's turn", async () => {
  const { cli, script } = start(
    {
      models: answeringModels("slash-project", ["안녕 Ada"]),
      files: { ".xeon/commands/hello.md": "---\ndescription: greet\n---\nHello $ARGUMENTS\n" },
    },
    ["", "/hello Ada"],
  );
  // 결정이 없는 폴더: 시작 카드에서 엔터(나중에)를 누르면 신뢰가 서지 않아 프로젝트 명령은 없다
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stderrText()).toContain("모르는 슬래시 명령: /hello");
  expect(cli.sent("trust.decide")).toEqual([]);
  expect(cli.sent("turn.start")).toEqual([]);

  expect(await cli.harness.run(["trust", "allow"])).toBe(EXIT.ok);
  expect(cli.sent("trust.decide")).toHaveLength(1);

  script(["/help", "/hello Ada"]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toContain("  /hello   greet\n");
  const turn = cli.sent("turn.start");
  expect(turn).toHaveLength(1);
  expect(turn[0]?.params["input"]).toBe("Hello Ada");
  expect(cli.harness.stdoutText()).toContain("안녕 Ada");
}, 90_000);

/** 앞선 turn이 요약 대상이 되도록 길게 쓴 입력(컴팩션이 최근 1024토큰을 남긴다) */
function longInput(topic: string): string {
  return `${topic} ${"이 항목의 배경과 결정 이유를 자세히 정리했다. ".repeat(220)}`;
}

test("/compact summarizes a long conversation on the real engine and a second call has nothing to do", async () => {
  const summary = "## 목표\n저장소 빌드 속도 조사\n\n## 진행\n캐시 설정을 확인했다";
  const { cli } = start(
    {
      models: answeringModels("slash-compact", ["첫째 답", "둘째 답", "셋째 답", summary]),
      settings: { "l1.context.keepRecentTokens": 1024 },
    },
    [longInput("하나"), longInput("둘"), longInput("셋"), "/compact 빌드 속도 위주로", "/compact"],
  );
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  const compacts = cli.sent("thread.compact");
  expect(compacts.map((request) => request.params["instructions"])).toEqual([
    "빌드 속도 위주로",
    undefined,
  ]);
  const out = cli.harness.stdoutText();
  expect(out).toMatch(/대화를 요약했다 \(요약 전 약 \d+ 토큰\)\n/);
  expect(out).toContain("방금 요약했다. 새 대화가 쌓인 뒤에 다시 요약한다\n");
  expect(cli.harness.stderrText()).toBe("");
}, 120_000);

test("/compact on a conversation that is too short says there is nothing to summarize", async () => {
  const { cli } = start({ models: answeringModels("slash-short", ["답"]) }, ["/compact"]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toContain("요약할 내용이 아직 없다\n");
  expect(cli.sent("turn.start")).toEqual([]);
}, 60_000);

import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { eventId } from "./support/ids.ts";
import { answeringModels, createRealCli, type RealCli } from "./support/real-host.ts";
import { scriptedInput } from "./support/script.ts";
import { HELLO, spawnStdioChild, type StdioChild } from "./support/stdio-child.ts";

// G1-02, G2-10: 실제 호스트 위의 끊긴 turn 이어 실행. 첫 호스트는 실제 자식 프로세스이고 승인을 기다리는 중에 SIGKILL로 죽는다.
// 두 번째 호스트(같은 저장소)에서 `chat --continue`가 thread.list의 resumable을 보고 묻고, y일 때만 turn.resume을 부른다.
// 쓰기 소유를 얻으면 호스트가 미해결 승인을 되살리므로(HS-52) 승인 카드가 먼저 서고, 그 답을 받은 뒤에 이어 실행을 묻는다.
// 두 질문은 같은 입력 줄을 쓰므로 입력 대본은 승인 답, 이어 실행 답 순이다.

const ENTRY = `${import.meta.dir}/fixtures/scenario-host.ts`;
const COMMAND = "echo approved-by-user";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;

const clis: RealCli[] = [];
const children: StdioChild[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const cli of clis.splice(0).toReversed()) cli.dispose();
});

/** 승인을 기다리는 turn을 만들고 호스트를 SIGKILL로 죽인다. 그 thread의 id와 승인 id를 돌려준다 */
async function killedWhileAsking(
  owner: RealCli,
  command: string,
): Promise<{ readonly threadId: string; readonly approvalId: string }> {
  const child = spawnStdioChild({
    entry: ENTRY,
    home: owner.home.root,
    cwd: owner.home.work,
    env: { XEON_SCENARIO_COMMAND: command },
  });
  children.push(child);
  await child.request("host.hello", HELLO);
  const created = await child.request("thread.create", { workspace: owner.home.work });
  const threadId = idOf(created, "threadId");
  await child.request("events.subscribe", { from: "head", filter: { threadIds: [threadId] } });
  await child.request("turn.start", { threadId, input: "실행해 줘", requestId: eventId(1) });
  const asked = await child.log.waitFor(
    (event) => event.kind === "approval.requested",
    "approval.requested",
    () => `stderr: ${child.stderr()}`,
  );
  child.kill();
  expect(await child.exited).not.toBe(0);
  return { threadId, approvalId: asked.id };
}

function idOf(value: unknown, key: string): string {
  const found = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  if (typeof found !== "string") throw new Error(`no ${key} in the result`);
  return found;
}

function second(
  owner: RealCli,
  answers: readonly string[],
  lines: readonly string[],
): { readonly cli: RealCli; readonly prompts: readonly string[] } {
  const input = scriptedInput([...lines, "/quit"]);
  const cli = createRealCli({
    home: owner.home,
    models: answeringModels("turn-resume-host", answers),
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);
  return { cli, prompts: input.prompts };
}

test("y at both questions asks the restored approval, then calls turn.resume once, and the turn finishes", async () => {
  const owner = createRealCli();
  clis.push(owner);
  const killed = await killedWhileAsking(owner, COMMAND);

  // 첫 y는 되살아난 승인, 둘째 y는 이어 실행 질문의 답이다
  const { cli, prompts } = second(owner, ["finished."], ["y", "y"]);
  expect(await cli.harness.run(["chat", "--continue"])).toBe(EXIT.ok);
  const out = cli.harness.stdoutText();
  expect(out).toContain("이 세션에 끊긴 turn이 있다");
  expect(prompts.filter((prompt) => prompt.startsWith("이어서 실행할까요?"))).toHaveLength(1);
  expect(cli.sent("turn.resume")).toEqual([
    { method: "turn.resume", params: { threadId: killed.threadId } },
  ]);
  // 되살아난 승인 카드는 명령 전체를 보인다
  expect(`${out}${cli.harness.stderrText()}`).toContain(COMMAND);
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: { approvalId: killed.approvalId, decision: "allow", remember: "once" },
    },
  ]);
  expect(out).toContain("finished.");
  expect(cli.harness.stderrText()).not.toContain("xeon:");
}, 90_000);

test("n at the resume question never calls turn.resume and leaves the turn resumable", async () => {
  const owner = createRealCli();
  clis.push(owner);
  const killed = await killedWhileAsking(owner, COMMAND);

  const { cli, prompts } = second(owner, [], ["y", "n"]);
  expect(await cli.harness.run(["chat", "--continue"])).toBe(EXIT.ok);
  expect(cli.sent("turn.resume")).toEqual([]);
  expect(cli.sent("approval.respond")).toEqual([
    {
      method: "approval.respond",
      params: { approvalId: killed.approvalId, decision: "allow", remember: "once" },
    },
  ]);
  expect(prompts).toContain("이어서 실행할까요? [y/N] ");

  // 목록은 이 세션을 여전히 이어 실행할 수 있다고 알린다
  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["sessions", "ls", "--json"])).toBe(EXIT.ok);
  const doc: unknown = JSON.parse(cli.harness.stdoutText());
  expect(doc).toEqual([
    expect.objectContaining({ threadId: killed.threadId, resumable: expect.anything() }),
  ]);
}, 90_000);

test("a new session and print mode never look for a resumable turn", async () => {
  const owner = createRealCli({ models: answeringModels("turn-resume-new", ["답"]) });
  clis.push(owner);
  expect(await owner.harness.run(["chat", "-p", "안녕"])).toBe(EXIT.ok);
  expect(owner.sent("turn.resume")).toEqual([]);
  expect(owner.harness.stdoutText()).not.toContain("이어서 실행할까요?");
}, 60_000);

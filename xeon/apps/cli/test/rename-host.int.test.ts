import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { answeringModels, createRealCli, type RealCli } from "./support/real-host.ts";
import { scriptedInput } from "./support/script.ts";

// G2-12: 실제 호스트 위의 세션 제목. test/rename.test.ts의 가짜 thread.rename·thread.list를 실제 처리기로 바꿔 같은 흐름을 다시 확인한다.
// 첫 입력에서 제목을 정하는 일(공백을 한 칸으로 줄이고 앞 80자)은 호스트가 하고, 사람이 정한 제목은 그것을 덮는다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;

function start(answers: readonly string[], lines: readonly string[] = []): RealCli {
  const input = scriptedInput([...lines, "/quit"]);
  const cli = createRealCli({
    models: answeringModels("rename-host", answers),
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);
  return cli;
}

interface Listed {
  readonly threadId: string;
  readonly title: string | null;
}

/** `sessions ls --json`가 낸 세션 목록 */
async function listed(cli: RealCli): Promise<readonly Listed[]> {
  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["sessions", "ls", "--json"])).toBe(EXIT.ok);
  const doc: unknown = JSON.parse(cli.harness.stdoutText());
  if (!Array.isArray(doc)) throw new Error("sessions ls --json is not an array");
  return doc.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) throw new Error("not an object");
    const threadId = "threadId" in entry ? entry.threadId : undefined;
    const title = "title" in entry ? entry.title : undefined;
    if (typeof threadId !== "string") throw new Error("no threadId");
    return { threadId, title: typeof title === "string" ? title : null };
  });
}

test("the host names a session after its first input, and sessions rename replaces that title", async () => {
  const cli = start(["답"]);
  const input = "  릴리즈 준비를\n  점검해 줘  ";
  expect(await cli.harness.run(["chat", "-p", input])).toBe(EXIT.ok);
  // 공백(줄바꿈 포함)은 한 칸으로 줄고 앞뒤는 잘린다
  const [only] = await listed(cli);
  expect(only?.title).toBe("릴리즈 준비를 점검해 줘");

  const id = only?.threadId ?? "";
  expect(await cli.harness.run(["sessions", "rename", id, "배포", "체크리스트"])).toBe(EXIT.ok);
  expect(cli.sent("thread.rename")).toEqual([
    { method: "thread.rename", params: { threadId: id, title: "배포 체크리스트" } },
  ]);
  expect(cli.harness.stdoutText()).toContain(`이름을 바꿨다: ${id}  배포 체크리스트\n`);
  expect((await listed(cli))[0]?.title).toBe("배포 체크리스트");

  // 텍스트 목록은 제목을 보인다
  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["sessions", "ls"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toContain(id);
  expect(cli.harness.stdoutText()).toContain("배포 체크리스트");
  expect(cli.harness.stdoutText()).not.toContain("(제목 없음)");
}, 60_000);

test("a first input longer than 80 characters is cut to its first 80", async () => {
  const cli = start(["답"]);
  const long = "가".repeat(120);
  expect(await cli.harness.run(["chat", "-p", long])).toBe(EXIT.ok);
  expect((await listed(cli))[0]?.title).toBe("가".repeat(80));
}, 60_000);

test("/rename in chat sets the title of the current session and the first input does not override it", async () => {
  const cli = start(["답"], ["/rename 나의 세션", "첫 입력"]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toContain("제목을 바꿨다: 나의 세션\n");
  expect((await listed(cli))[0]?.title).toBe("나의 세션");
}, 60_000);

test("/rename without a title never reaches the host, and renaming a missing session is a readable error", async () => {
  const cli = start([], ["/rename"]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stderrText()).toContain("사용법: /rename <제목> (제목이 비어 있다)");
  expect(cli.sent("thread.rename")).toEqual([]);

  const missing = "thr_00000000000000000000000009";
  cli.harness.stderr.length = 0;
  expect(await cli.harness.run(["sessions", "rename", missing, "제목"])).toBe(EXIT.error);
  expect(cli.harness.stderrText()).toContain(`xeon: 세션 ${missing}이(가) 없다`);
}, 60_000);

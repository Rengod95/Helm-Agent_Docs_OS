import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { answeringModels, createRealCli, type RealCli } from "./support/real-host.ts";
import { scriptedInput } from "./support/script.ts";

// G1-03: 실제 호스트 위의 프로젝트 신뢰. test/trust.test.ts의 가짜 처리기를 실제 trust.get·trust.decide와 신뢰 저장 파일(trust.json)로 바꿔
// 같은 흐름을 다시 확인한다. 결정은 저장 파일에 남고 다음 실행에서 판정이 바뀐다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;

/** 신뢰할 자원(.xeon/commands)이 있는 작업 폴더 */
function withResources(lines: readonly string[] = [], answers: readonly string[] = []): RealCli {
  const input = scriptedInput([...lines, "/quit"]);
  const cli = createRealCli({
    models: answeringModels("trust-host", answers),
    files: { ".xeon/commands/hello.md": "Hello\n" },
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);
  return cli;
}

function trustFile(cli: RealCli): string {
  return join(cli.home.root, "config", "trust.json");
}

test("xeon trust shows the real card, and --json is the host's TrustStatus for this workspace", async () => {
  const cli = withResources();
  expect(await cli.harness.run(["trust"])).toBe(EXIT.ok);
  const card = cli.harness.stdoutText();
  expect(card).toContain(`프로젝트: ${cli.home.work}\n`);
  expect(card).toContain("불러오려는 자원: .xeon/commands\n");
  expect(card).toContain("판정: 아직 정하지 않음");
  expect(card).toContain(`  1) 이 폴더를 신뢰한다 (저장: ${cli.home.work})\n`);
  expect(cli.sent("trust.get")).toEqual([
    { method: "trust.get", params: { workspace: cli.home.work } },
  ]);
  expect(cli.sent("trust.decide")).toEqual([]);
  expect(existsSync(trustFile(cli))).toBe(false);

  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["trust", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(cli.harness.stdoutText())).toMatchObject({
    projectRoot: cli.home.work,
    required: true,
    verdict: "undecided",
    resources: [".xeon/commands"],
    options: [
      { choice: { kind: "folder", verdict: "allow" }, savedPath: cli.home.work },
      { choice: { kind: "parent", verdict: "allow" } },
      { choice: { kind: "session", verdict: "allow" }, savedPath: null },
      { choice: { kind: "folder", verdict: "deny" } },
      { choice: { kind: "session", verdict: "deny" }, savedPath: null },
    ],
  });
}, 60_000);

test("xeon trust allow writes trust.json with the owner-only mode and the next run reads it back", async () => {
  const cli = withResources();
  expect(await cli.harness.run(["trust", "allow", "--scope", "parent"])).toBe(EXIT.ok);
  expect(cli.sent("trust.decide")).toEqual([
    {
      method: "trust.decide",
      params: { workspace: cli.home.work, choice: { kind: "parent", verdict: "allow" } },
    },
  ]);
  // parent 허용은 상위 폴더 경로를 저장 파일에 남긴다
  const saved = readFileSync(trustFile(cli), "utf8");
  expect(saved).toContain(join(cli.home.work, ".."));
  expect(statSync(trustFile(cli)).mode & 0o077).toBe(0);

  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["trust", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(cli.harness.stdoutText())).toMatchObject({
    verdict: "allow",
    via: "store",
  });
}, 60_000);

test("a session-only decision stores nothing; a deny is stored and shown", async () => {
  const cli = withResources();
  expect(await cli.harness.run(["trust", "allow", "--scope", "session"])).toBe(EXIT.ok);
  expect(existsSync(trustFile(cli))).toBe(false);

  expect(await cli.harness.run(["trust", "deny"])).toBe(EXIT.ok);
  expect(cli.sent("trust.decide").at(-1)?.params["choice"]).toEqual({
    kind: "folder",
    verdict: "deny",
  });
  expect(existsSync(trustFile(cli))).toBe(true);
  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["trust", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(cli.harness.stdoutText())).toMatchObject({ verdict: "deny", via: "store" });
}, 60_000);

test("interactive chat asks the card before the thread exists, stores the picked choice, and does not ask again", async () => {
  const cli = withResources(["1"], ["안녕하세요"]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  const order = cli.sent().map((request) => request.method);
  expect(order.indexOf("trust.get")).toBeLessThan(order.indexOf("thread.create"));
  expect(cli.sent("trust.decide")).toEqual([
    {
      method: "trust.decide",
      params: { workspace: cli.home.work, choice: { kind: "folder", verdict: "allow" } },
    },
  ]);
  expect(readFileSync(trustFile(cli), "utf8")).toContain(cli.home.work);

  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["chat", "-p", "안녕"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toContain("안녕하세요");
  expect(cli.harness.stdoutText()).not.toContain("불러오려는 자원");
  expect(cli.harness.stderrText()).toBe("");
}, 60_000);

test("enter at the card postpones: nothing is stored and the chat goes on untrusted", async () => {
  const cli = withResources([""]);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.sent("trust.decide")).toEqual([]);
  expect(existsSync(trustFile(cli))).toBe(false);
  expect(cli.sent("thread.create")).toHaveLength(1);
}, 60_000);

test("a folder with nothing to trust says so on stderr and the chat never asks", async () => {
  const input = scriptedInput(["/quit"]);
  const cli = createRealCli({
    models: answeringModels("trust-host-empty", []),
    harness: { terminal: TTY, readLine: (prompt, signal) => input.readLine(prompt, signal) },
  });
  clis.push(cli);
  expect(await cli.harness.run(["trust"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toBe("");
  expect(cli.harness.stderrText()).toBe(`${cli.home.work}: 신뢰가 필요한 프로젝트 자원이 없다\n`);
  expect(await cli.harness.run(["chat"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).not.toContain("불러오려는 자원");
}, 60_000);

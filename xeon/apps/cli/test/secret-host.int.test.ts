import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// G1-07: 실제 호스트와 실제 비밀 저장소(sops, age) 위의 secret 명령. test/secret.test.ts의 가짜 처리기를 실제 secret.* 처리기로 바꿔
// 등록, 목록, 시험 출력(길이와 해시 앞 8자), 삭제 전 참조 표시를 한 저장소에서 잇는다. 값은 어느 출력, 요청, 파일에도 없어야 한다.

const clis: RealCli[] = [];
const tmpDirs: string[] = [];
afterEach(() => {
  for (const cli of clis.splice(0)) cli.dispose();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const VALUE = "Zq7-very-secret-0123456789-abcdef!";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;

/** 값을 놓을 SOPS 파일과 age 키 파일 위치. 홈 안의 secrets 폴더를 쓴다(홈은 XEON_HOME 임시 디렉터리다) */
function sopsSettings(): Readonly<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "xcli-sops-"));
  tmpDirs.push(dir);
  // age 키 쌍을 만든다(파일 권한은 age-keygen이 0600으로 쓴다)
  const made = Bun.spawnSync(["age-keygen", "-o", join(dir, "keys.txt")], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if (made.exitCode !== 0) throw new Error(`age-keygen failed: ${made.stderr.toString()}`);
  const recipient = /public key: (age1\w+)/.exec(readFileSync(join(dir, "keys.txt"), "utf8"))?.[1];
  if (recipient === undefined) throw new Error("age-keygen wrote no public key");
  // 값을 놓을 SOPS 파일은 그 키가 수신자인 암호화된 파일로 미리 있어야 한다(자리 표시 키 하나)
  writeFileSync(join(dir, "seed.yaml"), "SEED: placeholder-value-0001\n");
  const sealed = Bun.spawnSync(
    [
      "sops",
      "--encrypt",
      "--age",
      recipient,
      "--output",
      join(dir, "dev.yaml"),
      join(dir, "seed.yaml"),
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if (sealed.exitCode !== 0) throw new Error(`sops failed: ${sealed.stderr.toString()}`);
  rmSync(join(dir, "seed.yaml"));
  return {
    "l0.secrets.sops.files": [{ env: "dev", path: join(dir, "dev.yaml") }],
    "l0.secrets.ageKey.source": "file",
    "l0.secrets.ageKey.filePath": join(dir, "keys.txt"),
  };
}

/** 홈 디렉터리 아래 모든 파일의 바이트 */
function filesUnder(root: string): readonly Buffer[] {
  const found: Buffer[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (statSync(path).size > 4_000_000) continue;
    found.push(readFileSync(path));
  }
  return found;
}

function expectNoValue(cli: RealCli): void {
  const bytes = new TextEncoder().encode(VALUE);
  const forms = [VALUE, Buffer.from(bytes).toString("base64"), Buffer.from(bytes).toString("hex")];
  const haystack = [
    cli.harness.stdoutText(),
    cli.harness.stderrText(),
    JSON.stringify(cli.sent()),
  ].join("\n");
  for (const form of forms) expect(haystack).not.toContain(form);
  // 저장소 파일에는 암호화된 값만 있다
  for (const file of filesUnder(cli.home.root)) {
    for (const form of forms) expect(file.includes(form)).toBe(false);
  }
}

test("a secret is added, listed, tested and removed on the real store without its value showing anywhere", async () => {
  const asked: string[] = [];
  const answers = ["n", "y"];
  const cli = createRealCli({
    settings: sopsSettings(),
    harness: {
      terminal: TTY,
      secretInputs: [VALUE, VALUE],
      readLine: (prompt) => (asked.push(prompt), Promise.resolve(answers.shift() ?? null)),
    },
  });
  clis.push(cli);
  const { harness } = cli;
  const text = (): string => harness.stdoutText();

  expect(await harness.run(["secret", "add", "github-token"]), harness.stderrText()).toBe(EXIT.ok);
  expect(text()).toContain("github-token: 등록했다\n");
  expect(cli.sent("secret.beginEntry")).toEqual([
    { method: "secret.beginEntry", params: { name: "github-token", action: "add" } },
  ]);

  harness.stdout.length = 0;
  expect(await harness.run(["secret", "ls"])).toBe(EXIT.ok);
  expect(text()).toContain("github-token");

  harness.stdout.length = 0;
  const prefix = createHash("sha256").update(VALUE).digest("hex").slice(0, 8);
  expect(await harness.run(["secret", "test", "github-token"])).toBe(EXIT.ok);
  expect(text()).toBe(
    `github-token: registered (복호화 가능, 길이 ${String(VALUE.length)}바이트, sha256 앞 8자 ${prefix})\n`,
  );
  harness.stdout.length = 0;
  expect(await harness.run(["secret", "test", "github-token", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(text())).toEqual({
    name: "github-token",
    state: "registered",
    decryptable: true,
    length: VALUE.length,
    sha256Prefix: prefix,
  });

  // 없는 이름은 1이다
  harness.stdout.length = 0;
  expect(await harness.run(["secret", "test", "nothing-here", "--json"])).toBe(EXIT.error);
  expect(JSON.parse(text())).toEqual({
    name: "nothing-here",
    state: "missing",
    decryptable: false,
    length: null,
    sha256Prefix: null,
  });

  // 지우기 전에 이 비밀을 가리키는 곳을 보이고 묻는다. n이면 지우지 않는다
  harness.stdout.length = 0;
  expect(await harness.run(["secret", "rm", "github-token"])).toBe(EXIT.error);
  expect(cli.sent("secret.references")).toEqual([
    { method: "secret.references", params: { name: "github-token" } },
  ]);
  expect(text()).toContain(
    "github-token: 참조하는 설정 키 없음 / 활성 lease 0개 / 최근 사용한 세션 없음\n",
  );
  expect(asked).toHaveLength(1);
  expect(cli.sent("secret.remove")).toEqual([]);

  // y이면 지운다
  harness.stdout.length = 0;
  expect(await harness.run(["secret", "rm", "github-token"])).toBe(EXIT.ok);
  expect(text()).toContain("github-token: 지웠다\n");
  expect(cli.sent("secret.remove")).toEqual([
    { method: "secret.remove", params: { name: "github-token" } },
  ]);
  harness.stdout.length = 0;
  harness.stderr.length = 0;
  expect(await harness.run(["secret", "ls"])).toBe(EXIT.ok);
  expect(text()).not.toContain("github-token");

  expectNoValue(cli);
}, 120_000);

test("secret rm --yes removes without asking and a name that does not exist is a readable error", async () => {
  const cli = createRealCli({
    settings: sopsSettings(),
    harness: { terminal: TTY, secretInputs: [VALUE, VALUE] },
  });
  clis.push(cli);
  expect(await cli.harness.run(["secret", "add", "api-key"])).toBe(EXIT.ok);
  cli.harness.stdout.length = 0;
  expect(await cli.harness.run(["secret", "rm", "api-key", "--yes"])).toBe(EXIT.ok);
  expect(cli.harness.stdoutText()).toBe("api-key: 지웠다\n");
  // 참조가 하나도 없으면 stderr에 남길 줄이 없다
  expect(cli.harness.stderrText()).toBe("");

  cli.harness.stderr.length = 0;
  expect(await cli.harness.run(["secret", "rm", "api-key", "--yes"])).toBe(EXIT.error);
  expect(cli.harness.stderrText()).toContain("xeon: 그 이름의 비밀이 없다");
  expectNoValue(cli);
}, 120_000);

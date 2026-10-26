import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createRealCli, type RealCli } from "./support/real-host.ts";

// M2 첫 실행(M-12): 깨끗한 기기에서 설정 없이 `xeon secret add`가 된다. 실제 호스트, 실제 sops와 age, 임시 XEON_HOME이다.
// 사용자가 SOPS 파일도 age 키도 준비하지 않는다(설정은 파일 키 폴백 확인 하나뿐이다: 이 기기는 Secret Service가 없다).
// 같은 홈 위에 클라이언트 둘(CLI와 데스크톱 사이드카 자리)이 따로 뜨면 한 비밀 저장소를 본다. 값은 시험이 만든 가짜다.

const clis: RealCli[] = [];
afterEach(() => {
  for (const cli of clis.splice(0).toReversed()) cli.dispose();
});

const VALUE = "Zq7-first-run-fake-0123456789-abcdef!";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 100 } as const;
const real = Bun.which("sops") !== null && Bun.which("age-keygen") !== null;
const FILE_KEY = { "l0.secrets.ageKey.source": "file" } as const;

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

const modeOf = (path: string): number => statSync(path).mode & 0o777;

test.skipIf(real)(
  "sops or age missing on this machine: first-run integration tests are skipped (environment, not code)",
  () => {
    expect(real).toBe(false);
  },
);

test.skipIf(!real)(
  "secret add works with no SOPS file and no age key prepared, and a second client sees it",
  async () => {
    const first = createRealCli({
      settings: FILE_KEY,
      harness: { terminal: TTY, secretInputs: [VALUE, VALUE] },
    });
    clis.push(first);
    const root = first.home.root;
    expect(readdirSync(join(root, "config"))).toEqual(["settings.json"]);

    expect(
      await first.harness.run(["secret", "add", "github-token"]),
      first.harness.stderrText(),
    ).toBe(EXIT.ok);
    expect(first.harness.stdoutText()).toContain("github-token: 등록했다\n");

    // 기본 파일과 키가 사용자 config 디렉터리 아래에 만들어졌다
    const sopsFile = join(root, "config", "secrets", "sops", "user.yaml");
    expect(modeOf(sopsFile)).toBe(0o600);
    expect(modeOf(join(root, "config", "secrets", "age", "keys.txt"))).toBe(0o600);
    expect(readFileSync(sopsFile, "utf8")).toContain("GITHUB_TOKEN:");

    // 두 번째 클라이언트: 같은 홈, 다른 클라이언트 상태 파일. 같은 비밀을 보고 복호화한다
    const second = createRealCli({
      home: { ...first.home, stateFile: join(root, "sidecar-state.json") },
      harness: { terminal: TTY },
    });
    clis.push(second);
    expect(await second.harness.run(["secret", "ls"]), second.harness.stderrText()).toBe(EXIT.ok);
    expect(second.harness.stdoutText()).toContain("github-token");
    second.harness.stdout.length = 0;
    expect(
      await second.harness.run(["secret", "test", "github-token", "--json"]),
      second.harness.stderrText(),
    ).toBe(EXIT.ok);
    expect(JSON.parse(second.harness.stdoutText())).toMatchObject({
      name: "github-token",
      state: "registered",
      decryptable: true,
      length: VALUE.length,
    });

    // 값은 어느 출력, 요청, 파일에도 없다
    const forms = [
      VALUE,
      Buffer.from(VALUE).toString("base64"),
      Buffer.from(VALUE).toString("hex"),
    ];
    const haystack = [
      first.harness.stdoutText(),
      first.harness.stderrText(),
      second.harness.stdoutText(),
      second.harness.stderrText(),
      JSON.stringify(first.sent()),
      JSON.stringify(second.sent()),
    ].join("\n");
    for (const form of forms) expect(haystack).not.toContain(form);
    for (const file of filesUnder(root)) {
      for (const form of forms) expect(file.includes(form)).toBe(false);
    }
    expect(statSync(root).isDirectory()).toBe(true);
  },
);

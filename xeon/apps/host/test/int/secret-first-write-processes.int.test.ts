import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

// L0.secrets.spec §4.6 8번. 같은 사용자의 호스트 두 프로세스(CLI와 데스크톱 사이드카 자리)가 깨끗한 홈에서 동시에 첫 `add`를 해도
// 키와 SOPS 파일은 하나만 생기고 두 값이 모두 들어간다. 프로세스 사이 잠금은 xeon.os의 flock이다. 임시 XEON_HOME만 쓴다.

const real = Bun.which("sops") !== null && Bun.which("age-keygen") !== null;
const CHILD = join(import.meta.dir, "..", "fixtures", "secret-add-child.ts");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface ChildResult {
  readonly exitCode: number;
  readonly stdout: string;
}

async function runChild(home: string, name: string, value: string): Promise<ChildResult> {
  const proc = Bun.spawn(["bun", CHILD, name], {
    env: {
      PATH: Bun.env["PATH"] ?? "/usr/bin:/bin",
      HOME: home,
      XEON_HOME: home,
    },
    stdin: new TextEncoder().encode(value),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { exitCode, stdout };
}

test.skipIf(real)(
  "sops or age missing on this machine: the two-process first-write test is skipped (environment, not code)",
  () => {
    expect(real).toBe(false);
  },
);

test.skipIf(!real)(
  "two processes adding their first secrets at the same time create one key and one file with both values",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "xh-first-"));
    dirs.push(home);
    const a = "race-fake-value-aaaa-0301";
    const b = "race-fake-value-bbbb-0302";
    const [first, second] = await Promise.all([
      runChild(home, "exa-api-key", a),
      runChild(home, "brave-api-key", b),
    ]);
    expect([first.exitCode, second.exitCode], `${first.stdout}${second.stdout}`).toEqual([0, 0]);
    // 키 파일과 수신자 기록은 하나씩, SOPS 파일도 하나다
    const ageDir = join(home, "config", "secrets", "age");
    expect(readdirSync(ageDir).toSorted()).toEqual(["keys.txt", "recipient.file.txt"]);
    expect(
      readdirSync(join(home, "config", "secrets", "sops")).filter((n) => !n.endsWith(".lock")),
    ).toEqual(["user.yaml"]);
    expect(statSync(join(home, "config", "secrets", "sops", "user.yaml")).mode & 0o777).toBe(0o600);
    // 두 키가 같은 파일에 모두 들어 있다(하나가 다른 하나를 덮어쓰지 않았다)
    const text = readFileSync(join(home, "config", "secrets", "sops", "user.yaml"), "utf8");
    expect(text).toContain("EXA_API_KEY:");
    expect(text).toContain("BRAVE_API_KEY:");
    expect(text.includes(a) || text.includes(b)).toBe(false);
    // 복호화는 그 키 파일로 된다
    const keyFile = join(home, "config", "secrets", "age", "keys.txt");
    for (const [key, expected] of [
      ["EXA_API_KEY", a],
      ["BRAVE_API_KEY", b],
    ] as const) {
      const out = Bun.spawnSync(
        [
          "sops",
          "decrypt",
          "--extract",
          `["${key}"]`,
          join(home, "config", "secrets", "sops", "user.yaml"),
        ],
        {
          env: { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: home, SOPS_AGE_KEY_FILE: keyFile },
        },
      );
      expect(out.stdout.toString() === expected).toBe(true);
    }
  },
  60_000,
);

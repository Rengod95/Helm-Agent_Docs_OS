import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOsRuntime } from "@fresnel/platform-os";
import { scriptRunnersOnPath } from "../../src/assembly/plugin-host.ts";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// `python3` 스크립트 실행기가 실제 샌드박스 안에서 돈다(AGE-58 마무리, 트랙 enK7). 사용자 결정 2026-11-21(AGE-63): 승인된 플러그인의 스크립트는 열린 정책이다.
// 설치 폴더와 폴더 밖, 가짜 홈을 셸 도구와 같이 읽고 쓴다. 막는 것은 보호 경로뿐이다(`script-boundary.int.test.ts`). 바이트코드는 쓰지 않는다(환경 변수 `PYTHONDONTWRITEBYTECODE`).
// 시험이 만든 가짜 값만 쓰고 얻은 값은 출력하지 않는다. 예전의 ctypes(Mach 서비스, 키체인 조회)와 막은 도구 실행 시험은 열린 정책에서 실제 기기를 건드리므로 지웠다.
// 샌드박스나 `python3`가 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 샌드박스 없음은 종료 코드 2다.

const TEST_TIMEOUT_MS = 90_000;
const probe = await openScriptBox();
const available = sandboxAvailable(probe);
const reason = probe.service.status().reason ?? "the sandbox service is not available";
const hasPython = probe.runner("python3") !== undefined;
await probe.close();
if (!available) {
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-python.int: ${reason}\n`);
    process.exit(2);
  }
  process.stderr.write("SKIPPED script-python.int: sandbox not runnable here\n");
}
const suite = available && hasPython && process.platform === "darwin" ? describe : describe.skip;

async function resultsOf(
  box: ScriptBox,
  body: string,
  stdin = "",
): Promise<Record<string, string>> {
  const outcome = await box.run({ runner: "python3", body, stdin });
  if (typeof outcome === "string") throw new Error(outcome);
  const results: Record<string, string> = {};
  for (const line of outcome.stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) results[line.slice(0, at)] = line.slice(at + 1);
  }
  return results;
}

suite("python3 script runner inside the sandbox (AGE-58, enK7)", () => {
  test(
    "a hook script reads the JSON on stdin, calls jq and git, and decides",
    async () => {
      const box = await openScriptBox();
      try {
        const outcome = await box.run({
          runner: "python3",
          stdin: '{"tool":"bash","input":{"command":"rm -rf /"}}',
          body: `import json, re, sys, os, subprocess
event = json.load(sys.stdin)
command = event["input"]["command"]
jq = subprocess.run(["/usr/bin/jq", "-r", ".a"], input='{"a":"x"}', capture_output=True, text=True).stdout.strip()
git = subprocess.run(["/usr/bin/git", "--version"], capture_output=True, text=True).returncode
if re.search(r"rm\\s+-rf", command):
    print("decision=deny jq=" + jq + " git=" + str(git) + " cwd=" + str(os.path.basename(os.getcwd()) != ""))
    sys.exit(2)
`,
        });
        if (typeof outcome === "string") throw new Error(outcome);
        expect(outcome.exitCode).toBe(2);
        expect(outcome.stdout.trim()).toBe("decision=deny jq=x git=0 cwd=True");
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the open policy: python3 reads and writes outside the plugin folder and in a fake home like the shell tool, and writes no bytecode",
    async () => {
      const box = await openScriptBox();
      try {
        const secret = join(box.outside, "secret.txt");
        writeFileSync(secret, "fake-secret-value");
        mkdirSync(join(box.home, ".ssh"), { recursive: true });
        writeFileSync(join(box.home, ".ssh", "id"), "fake-key");
        const results = await resultsOf(
          box,
          `import os, sys
out = []
def check(name, fn):
    try:
        fn()
        out.append(name + "=open")
    except OSError:
        out.append(name + "=blocked")
check("read_outside", lambda: open(${JSON.stringify(secret)}).read())
check("read_fake_home", lambda: open(${JSON.stringify(join(box.home, ".ssh", "id"))}).read())
check("list_fake_home", lambda: os.listdir(${JSON.stringify(box.home)}))
check("write_tree", lambda: open(${JSON.stringify(join(box.tree, "w.txt"))}, "w").write("x"))
check("write_outside", lambda: open(${JSON.stringify(join(box.outside, "w.txt"))}, "w").write("x"))
check("read_tmp_write", lambda: open(os.environ["TMPDIR"] + "/ok", "w").write("x"))
out.append("dont_write_bytecode=" + str(sys.dont_write_bytecode))
print("\\n".join(out))
`,
        );
        expect(results).toEqual({
          read_outside: "open",
          read_fake_home: "open",
          list_fake_home: "open",
          write_tree: "open",
          write_outside: "open",
          read_tmp_write: "open",
          dont_write_bytecode: "True",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "python3 found through a Homebrew link resolves to the real interpreter and starts",
    async () => {
      if (Bun.which("python3", { PATH: "/opt/homebrew/bin" }) === null) return;
      const box = await openScriptBox({ pythonPath: "/opt/homebrew/bin" });
      try {
        const outcome = await box.run({
          runner: "python3",
          body: "import json, sys\nprint('ok ' + json.dumps([1]))\n",
        });
        if (typeof outcome === "string") throw new Error(outcome);
        expect({ code: outcome.exitCode, out: outcome.stdout.trim(), err: outcome.stderr }).toEqual(
          {
            code: 0,
            out: "ok [1]",
            err: "",
          },
        );
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // macOS의 `/usr/bin/python3` 껍데기는 개발자 도구의 실제 인터프리터로 풀린다(껍데기가 `xcrun` 캐시를 쓰려다 실패하는 길을 피한다).
  // 다만 Apple의 Python 3.9는 `/dev/urandom`을 읽어 난수를 만들고 이 프로필은 그것을 열지 않으므로 시작하지 못한다(알려진 한계, 범위 밖이라 열지 않았다)
  test("the /usr/bin python3 shell resolves to the real developer tools interpreter, not the shell", () => {
    const found = Bun.which("python3", { PATH: "/usr/bin" });
    if (found === null) return;
    const resolved = scriptRunnersOnPath({ PATH: "/usr/bin" }, readOsRuntime().runSync).runner(
      "python3",
    );
    if (resolved === undefined) return;
    expect(resolved).not.toBe("/usr/bin/python3");
    expect(resolved).toContain("/Developer/");
  });

  test(
    "the install folder, its stdlib and site-packages and the folder above it are all readable under the open policy (a listing only, no content)",
    async () => {
      const box = await openScriptBox();
      try {
        const results = await resultsOf(
          box,
          `import os, sys, glob
out = []
def check(name, fn):
    try:
        fn()
        out.append(name + "=open")
    except OSError:
        out.append(name + "=blocked")
prefix = sys.base_prefix
check("prefix", lambda: os.listdir(prefix))
check("stdlib", lambda: os.listdir(os.path.dirname(os.__file__)))
check("site_packages", lambda: os.listdir(os.path.dirname(os.__file__) + "/site-packages"))
check("prefix_parent", lambda: os.listdir(os.path.dirname(prefix)))
print("\\n".join(out))
`,
        );
        expect(results).toEqual({
          prefix: "open",
          stdlib: "open",
          site_packages: "open",
          prefix_parent: "open",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

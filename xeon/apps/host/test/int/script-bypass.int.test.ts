import { describe, expect, test } from "bun:test";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 스크립트 실행기의 샌드박스 아래에서 보통의 훅 스크립트가 도는지 실제 샌드박스(macOS: sandbox-exec, srt)로 본다.
// 사용자 결정 2026-11-21(AGE-63): 승인된 플러그인의 스크립트는 열린 정책이다(셸 도구와 같이 읽고 쓰고 도구를 쓴다). 그래서 예전의 우회 시험(막은 도구 실행, 네이티브 호출로
// 막은 서비스 조회, 키체인과 프로세스 정보 조회)은 "막혔다"를 더 이상 주장하지 않아 지웠다. 그 시험들은 실제 기기의 키체인, 클립보드, 화면, launchd, 다른 프로세스를 건드려야 했다.
// 막는 것은 시험 `script-boundary.int.test.ts`가 본다(보호 경로, 사용자 extra, 차단 도메인).
// 샌드박스를 쓸 수 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;
const TEST_TIMEOUT_MS = 90_000;

const probe = await openScriptBox();
const available = sandboxAvailable(probe);
const reason = probe.service.status().reason ?? "the sandbox service is not available";
await probe.close();
if (!available) {
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-bypass.int: ${reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED script-bypass.int: sandbox not runnable here\n");
}
const macOnly = available && process.platform === "darwin";
const suite = macOnly ? describe : describe.skip;

async function resultsOf(
  box: ScriptBox,
  spec: Parameters<ScriptBox["run"]>[0],
): Promise<Record<string, string>> {
  const outcome = await box.run(spec);
  if (typeof outcome === "string") throw new Error(outcome);
  const results: Record<string, string> = {};
  for (const line of outcome.stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) results[line.slice(0, at)] = line.slice(at + 1);
  }
  return results;
}

suite("script runner sandbox: ordinary hook scripts under the open policy", () => {
  test(
    "ordinary hook scripts still run: grep, sed, awk, jq, git, curl --version, a temp file, bun and node scripts",
    async () => {
      const box = await openScriptBox();
      try {
        const shell = await resultsOf(box, {
          runner: "bash",
          body: `c() { local n=$1; shift; if "$@" >/dev/null 2>&1; then echo "$n=ok"; else echo "$n=FAIL"; fi; }
c jq bash -c 'test "$(echo "{\\"tool\\":\\"Bash\\"}" | jq -r .tool)" = Bash'
c grep bash -c 'echo abc | grep -q b'
c sed bash -c 'test "$(echo abc | sed s/b/x/)" = axc'
c awk bash -c 'test "$(echo "1 2" | awk "{print \\$2}")" = 2'
c sort bash -c 'printf "b\\na\\n" | sort | head -1 | grep -q a'
c git_version git --version
c git_commit bash -c 'd=$TMPDIR/r && git init -q $d && git -C $d -c user.name=a -c user.email=b@c commit -q --allow-empty -m x && git -C $d log --oneline | grep -q x'
c curl_version curl --version
c id_un id -un
c hostname hostname
c uname uname -a
c tmp_write bash -c 'echo x > $TMPDIR/f && cat $TMPDIR/f'
c cat_devnull bash -c 'echo a | cat > /dev/null'
c own_child bash -c 'sleep 5 & p=$!; kill $p; wait $p 2>/dev/null; true'
c bg_wait bash -c 'sleep 0.1 & wait'
`,
        });
        expect(Object.entries(shell).filter(([, value]) => value !== "ok")).toEqual([]);
        expect(Object.keys(shell).length).toBe(15);

        const script = `import os from "node:os";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const out = [];
const check = (name, fn) => { try { fn(); out.push(name + "=ok"); } catch { out.push(name + "=FAIL"); } };
check("userInfo", () => os.userInfo().username);
check("hostname", () => os.hostname());
check("cpus", () => os.cpus().length);
check("totalmem", () => os.totalmem());
check("memoryUsage", () => process.memoryUsage());
check("cpuUsage", () => process.cpuUsage());
check("tmpwrite", () => { writeFileSync(process.env.TMPDIR + "/a", "x"); readFileSync(process.env.TMPDIR + "/a"); });
check("spawn_sh", () => { if (spawnSync("/bin/sh", ["-c", "echo x"]).status !== 0) throw new Error("sh"); });
check("spawn_jq", () => { if (spawnSync("/usr/bin/jq", ["-r", ".a"], { input: '{"a":1}' }).stdout.toString().trim() !== "1") throw new Error("jq"); });
check("spawn_git", () => { if (spawnSync("/usr/bin/git", ["--version"]).status !== 0) throw new Error("git"); });
console.log(out.join("\\n"));
`;
        const bun = await resultsOf(box, { runner: "bun", body: script });
        expect(Object.entries(bun).filter(([, value]) => value !== "ok")).toEqual([]);
        expect(Object.keys(bun).length).toBe(10);

        const nodePath = nodeExecPath();
        if (nodePath !== undefined) {
          const nodeBox = await openScriptBox({
            resolve: (name) => (name === "node" ? nodePath : box.runner(name)),
          });
          try {
            const node = await resultsOf(nodeBox, {
              runner: "node",
              body: script,
            });
            expect(Object.entries(node).filter(([, value]) => value !== "ok")).toEqual([]);
            expect(Object.keys(node).length).toBe(10);
          } finally {
            await nodeBox.close();
          }
        }
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/** `node`의 실제 실행 파일 경로(mise 같은 shim 뒤의 진짜 파일). 없으면 undefined */
function nodeExecPath(): string | undefined {
  const ran = Bun.spawnSync(["node", "-p", "process.execPath"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const path = ran.exitCode === 0 ? ran.stdout.toString().trim() : "";
  return path.startsWith("/") ? path : undefined;
}

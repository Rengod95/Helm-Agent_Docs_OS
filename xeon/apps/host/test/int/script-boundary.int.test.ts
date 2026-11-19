import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 스크립트 실행기(`g.runScript`)가 도는 샌드박스의 경계를 실제 샌드박스(macOS: sandbox-exec, srt)로 고정한다(AGE-58, 사용자 결정 2026-11-19).
// 읽기·실행 허용을 `/bin`, `/usr/bin`(과 도구가 돌기 위한 시스템 경로 몇 개)으로 넓힌 뒤의 경계다. 쓰기와 폴더 밖 데이터 읽기는 그대로 막혀 있어야 하고,
// 위험한 도구(클립보드, 화면 캡처, 키체인, 다른 앱 조작, 다른 프로세스 정보)는 프로필에서 막힌다. 네트워크는 2026-11-17 결정대로 열려 있다.
// 시험이 쓰는 것은 시험이 만든 임시 폴더의 가짜 비밀 파일과 시험이 띄운 로컬 수신기뿐이다. 실제 `~/.ssh`와 키체인 폴더는 "열리지 않는다"만 본다(내용은 읽지 않는다).
// 샌드박스를 쓸 수 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;
const TEST_TIMEOUT_MS = 60_000;

const probe = await openScriptBox();
const available = sandboxAvailable(probe);
const reason = probe.service.status().reason ?? "the sandbox service is not available";
await probe.close();
if (!available) {
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-boundary.int: ${reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED script-boundary.int: sandbox not runnable here\n");
}
const suite = available ? describe : describe.skip;

/** 스크립트가 `이름=값` 줄로 적은 결과를 읽는다 */
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

/** 셸 내장만 쓰는 검사 함수. 명령이 성공하면 open, 아니면 blocked다 */
const PROBE_FN = `t() { local label=$1; shift; if "$@" 2>/dev/null; then echo "$label=open"; else echo "$label=blocked"; fi; }\n`;

suite("the script runner sandbox boundary after the /bin and /usr/bin widening (AGE-58)", () => {
  test(
    "network: raw TCP to the loopback and to a reserved documentation address is blocked",
    async () => {
      const box = await openScriptBox();
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data() {}, open() {} },
      });
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [String(listener.port)],
          body: `${PROBE_FN}t tcp_loopback bash -c "exec 3<>/dev/tcp/127.0.0.1/$1"\nt tcp_reserved bash -c "exec 3<>/dev/tcp/192.0.2.1/80"\n`,
        });
        expect(results).toEqual({ tcp_loopback: "blocked", tcp_reserved: "blocked" });
      } finally {
        listener.stop();
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "network: a Unix socket and a DNS lookup are blocked, and the runtime fetch without the proxy is blocked",
    async () => {
      const box = await openScriptBox();
      if (box.runner("bun") === undefined) {
        await box.close();
        return;
      }
      const socketPath = join(box.outside, "probe.sock");
      const unixServer = Bun.listen({ unix: socketPath, socket: { data() {}, open() {} } });
      const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
      try {
        const outcome = await box.run({
          runner: "bun",
          args: [socketPath, String(http.port)],
          body: `import { lookup } from "node:dns/promises";
const [socketPath, port] = process.argv.slice(2);
const out: Record<string, string> = {};
try {
  await Bun.connect({ unix: socketPath, socket: { data() {}, open() {} } });
  out.unix = "open";
} catch {
  out.unix = "blocked";
}
try {
  await lookup("example.com");
  out.dns = "open";
} catch {
  out.dns = "blocked";
}
try {
  await fetch("http://127.0.0.1:" + port + "/direct", { proxy: "", signal: AbortSignal.timeout(4000) });
  out.fetch_direct = "open";
} catch {
  out.fetch_direct = "blocked";
}
console.log(JSON.stringify(out));
`,
        });
        if (typeof outcome === "string") throw new Error(outcome);
        expect(JSON.parse(outcome.stdout)).toEqual({
          unix: "blocked",
          dns: "blocked",
          fetch_direct: "blocked",
        });
      } finally {
        unixServer.stop();
        await http.stop();
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "network: OPEN BY DECISION (2026-11-17, all network allowed): a client that uses the sandbox proxy credentials from its own environment reaches a loopback listener",
    async () => {
      // 결정대로 열려 있음을 확인한다("격리 플러그인의 네트워크는 전체 허용", 2026-11-17). 프록시 주소와 인증 값이 자식의 환경 변수로 오고,
      // 프록시는 전역 정책(차단 목록)이라 목록 밖 호스트를 모두 지나 보낸다. 사용자가 네트워크를 막기로 정하면 이 시험을 "막힘"으로 뒤집는다.
      const box = await openScriptBox();
      if (box.runner("bun") === undefined) {
        await box.close();
        return;
      }
      const hits: string[] = [];
      const http = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          hits.push(new URL(request.url).pathname);
          return new Response("ok");
        },
      });
      try {
        const outcome = await box.run({
          runner: "bun",
          args: [String(http.port)],
          body: `const port = process.argv[2];
const proxy = new URL(String(process.env.HTTP_PROXY));
const credential = decodeURIComponent(proxy.username) + ":" + decodeURIComponent(proxy.password);
let reply = "";
await new Promise<void>((done) => {
  void Bun.connect({
    hostname: "127.0.0.1",
    port: Number(proxy.port),
    socket: {
      open(socket) {
        socket.write("GET http://127.0.0.1:" + port + "/via-proxy HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\nProxy-Authorization: Basic " + btoa(credential) + "\\r\\nConnection: close\\r\\n\\r\\n");
      },
      data(_socket, data) {
        reply += new TextDecoder().decode(data);
      },
      close() {
        done();
      },
      error() {
        done();
      },
      connectError() {
        done();
      },
    },
  });
  setTimeout(done, 4000);
});
console.log(reply.split("\\r\\n")[0]);
`,
        });
        if (typeof outcome === "string") throw new Error(outcome);
        expect(outcome.stdout.trim()).toBe("HTTP/1.1 200 OK");
        expect(hits).toEqual(["/via-proxy"]);
      } finally {
        await http.stop();
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "files: reads outside the plugin folder are blocked, its own file is readable, writes outside the folder are blocked, and only the call's own temp folder is writable",
    async () => {
      const box = await openScriptBox();
      const otherTree = join(box.root, "other-plugin", "tree");
      mkdirSync(otherTree, { recursive: true });
      writeFileSync(join(otherTree, "x.js"), "other plugin file");
      writeFileSync(
        join(box.outside, "secret.txt"),
        "fake secret in a temp folder made by this test",
      );
      const home = homedir();
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [
            join(box.outside, "secret.txt"),
            join(otherTree, "x.js"),
            join(box.outside, "written.txt"),
            box.home,
            box.service.status().available ? join(box.root, "data") : "",
          ],
          body: `${PROBE_FN}t read_secret bash -c "exec 3< $1"
t read_other_plugin bash -c "exec 3< $2"
t read_engine_home bash -c "exec 3< $4"
t read_engine_data bash -c "exec 3< $5"
t read_user_home bash -c "exec 3< ${home}"
t read_ssh bash -c "exec 3< ${home}/.ssh"
t read_keychains bash -c "exec 3< ${home}/Library/Keychains"
t read_own bash -c "exec 3< $0"
t write_folder bash -c "echo x > ./written-in-folder.txt"
t write_outside bash -c "echo x > $3"
t write_own_tmp bash -c 'echo x > "$TMPDIR/probe.txt"'
`,
        });
        expect(results).toEqual({
          read_secret: "blocked",
          read_other_plugin: "blocked",
          read_engine_home: "blocked",
          read_engine_data: "blocked",
          read_user_home: "blocked",
          read_ssh: "blocked",
          read_keychains: "blocked",
          read_own: "open",
          write_folder: "blocked",
          write_outside: "blocked",
          write_own_tmp: "open",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "tools after the widening: the system tools run by name and by path, the real git reads, and curl starts",
    async () => {
      const box = await openScriptBox();
      const gitPath = developerGit();
      mkdirSync(join(box.tree, "data"), { recursive: true });
      writeFileSync(join(box.tree, "data", "in.txt"), "alpha\nbeta\ngamma\n");
      if (gitPath !== undefined) seedGitRepo(box.tree, gitPath);
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [gitPath ?? "/nonexistent-git"],
          body: `x() { local label=$1; shift; "$@" >/dev/null 2>&1 </dev/null; if [ $? = 0 ]; then echo "$label=ok"; else echo "$label=fail"; fi; }
x path_lookup_cat command -v cat
x path_lookup_grep command -v grep
x path_lookup_git command -v git
x grep_own grep -q beta data/in.txt
x sed_own sed -n 1p data/in.txt
x awk_own awk 'END{ if (NR != 3) exit 1 }' data/in.txt
x cat_own bash -c "cat data/in.txt | grep -q gamma"
x find_own find data -name in.txt
x sort_own sort data/in.txt
x git_status_by_name git status --short
x git_log_by_name git log -1 --format=%s
x git_status "$1" status --short
x git_log "$1" log -1 --format=%s
x git_rev_parse "$1" rev-parse HEAD
x curl_starts curl --version
x jq_runs jq --version
`,
        });
        expect(results).toEqual({
          path_lookup_cat: "ok",
          path_lookup_grep: "ok",
          path_lookup_git: "ok",
          grep_own: "ok",
          sed_own: "ok",
          awk_own: "ok",
          cat_own: "ok",
          find_own: "ok",
          sort_own: "ok",
          git_status_by_name: gitPath === undefined ? "fail" : "ok",
          git_log_by_name: gitPath === undefined ? "fail" : "ok",
          git_status: gitPath === undefined ? "fail" : "ok",
          git_log: gitPath === undefined ? "fail" : "ok",
          git_rev_parse: gitPath === undefined ? "fail" : "ok",
          curl_starts: "ok",
          jq_runs: "ok",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the same lookup by name is blocked when the runner does not ask for system tools (the contrast with the widening)",
    async () => {
      const box = await openScriptBox();
      try {
        const without = await resultsOf(box, {
          runner: "bash",
          systemTools: false,
          body: `${PROBE_FN}t path_lookup_cat command -v cat\nt path_lookup_grep command -v grep\nt path_lookup_git command -v git\n`,
        });
        expect(without).toEqual({
          path_lookup_cat: "blocked",
          path_lookup_grep: "blocked",
          path_lookup_git: "blocked",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "reads and writes stay closed after the widening: home, ssh, keychain folder, other plugin, engine home, /etc, the tool folders themselves",
    async () => {
      const box = await openScriptBox();
      const otherTree = join(box.root, "other-plugin", "tree");
      mkdirSync(otherTree, { recursive: true });
      writeFileSync(join(otherTree, "x.js"), "other plugin file");
      writeFileSync(
        join(box.outside, "secret.txt"),
        "fake secret in a temp folder made by this test",
      );
      const home = homedir();
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [
            join(box.outside, "secret.txt"),
            join(otherTree, "x.js"),
            box.home,
            join(box.root, "data"),
          ],
          body: `${PROBE_FN}t read_secret bash -c "exec 3< $1"
t read_other_plugin bash -c "exec 3< $2"
t read_engine_home bash -c "exec 3< $3"
t read_engine_data bash -c "exec 3< $4"
t read_user_home bash -c "exec 3< ${home}"
t read_ssh bash -c "exec 3< ${home}/.ssh"
t read_keychains bash -c "exec 3< ${home}/Library/Keychains"
t read_etc_hosts bash -c "exec 3< /etc/hosts"
t read_etc_passwd bash -c "exec 3< /etc/passwd"
t read_var_folders bash -c "exec 3< /var/folders"
t read_var_db bash -c "exec 3< /private/var/db"
t read_library bash -c "exec 3< /Library/Preferences"
t read_usr_lib_dir bash -c "exec 3< /usr/lib"
t write_usr_bin bash -c "echo x > /usr/bin/fresnel-probe"
t write_bin bash -c "echo x > /bin/fresnel-probe"
t write_select bash -c "echo x > /private/var/select/fresnel-probe"
t write_etc_ssl bash -c "echo x > /private/etc/ssl/fresnel-probe"
t write_folder bash -c "echo x > ./written-in-folder.txt"
t write_outside bash -c "echo x > $1.new"
t write_own_tmp bash -c 'echo x > "$TMPDIR/probe.txt"'
t read_own bash -c "exec 3< $0"
t read_usr_bin bash -c "exec 3< /usr/bin/grep"
`,
        });
        expect(results).toEqual({
          read_secret: "blocked",
          read_other_plugin: "blocked",
          read_engine_home: "blocked",
          read_engine_data: "blocked",
          read_user_home: "blocked",
          read_ssh: "blocked",
          read_keychains: "blocked",
          read_etc_hosts: "blocked",
          read_etc_passwd: "blocked",
          read_var_folders: "blocked",
          read_var_db: "blocked",
          read_library: "blocked",
          read_usr_lib_dir: "blocked",
          write_usr_bin: "blocked",
          write_bin: "blocked",
          write_select: "blocked",
          write_etc_ssl: "blocked",
          write_folder: "blocked",
          write_outside: "blocked",
          write_own_tmp: "open",
          read_own: "open",
          read_usr_bin: "open",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "dangerous tools: each one is stopped before it runs (exit 126), so no clipboard, screen, keychain, AppleScript, launchd, Spotlight or process-list access comes from the tool folders",
    async () => {
      const box = await openScriptBox();
      const sleeper = Bun.spawn(["sleep", "60"]);
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [String(sleeper.pid), homedir()],
          // 인자는 모두 무해한 것이다(없는 이름 조회, 잘못된 옵션, 도움말). 도구가 막히지 않았을 때도 클립보드를 쓰거나 화면을 찍거나 다른 앱을 조작하지 않는다.
          // 결과는 126(실행 자체가 막힘)이면 stopped, 그 밖에는 ran이다
          body: `x() { local label=$1; shift; "$@" >/dev/null 2>&1 </dev/null; if [ $? = 126 ]; then echo "$label=stopped"; else echo "$label=ran"; fi; }
x launchctl_print /bin/launchctl print system
x launchctl_remove /bin/launchctl remove com.fresnel.probe.nonexistent
x open_scheme /usr/bin/open fresnel-probe-nonexistent-scheme://x
x osascript /usr/bin/osascript -e 'return 1'
x osacompile /usr/bin/osacompile --fresnel-probe
x security_find /usr/bin/security find-generic-password -s fresnel-probe-nonexistent-xyz "$2/Library/Keychains/login.keychain-db"
x defaults_read /usr/bin/defaults read fresnel.probe.nonexistent
x pbpaste /usr/bin/pbpaste --fresnel-probe
x pbcopy /usr/bin/pbcopy --fresnel-probe
x screencapture /usr/sbin/screencapture --fresnel-probe
x mdfind /usr/bin/mdfind -name fresnel-probe-nonexistent-xyz
x mdls /usr/bin/mdls --fresnel-probe
x log /usr/bin/log help
x ps /bin/ps -p $1
x top /usr/bin/top -l 1 -n 0
x lsof_other /usr/sbin/lsof -p $1
x sudo /usr/bin/sudo -n true
x su /usr/bin/su -m nobody -c true
x nc_loopback /usr/bin/nc -z -w 1 127.0.0.1 9
x sh_runs /bin/sh -c true
x grep_runs /usr/bin/grep -c x /dev/null
`,
        });
        const stopped = {
          launchctl_print: "stopped",
          launchctl_remove: "stopped",
          open_scheme: "stopped",
          osascript: "stopped",
          osacompile: "stopped",
          security_find: "stopped",
          defaults_read: "stopped",
          pbpaste: "stopped",
          pbcopy: "stopped",
          screencapture: "stopped",
          mdfind: "stopped",
          mdls: "stopped",
          log: "stopped",
          ps: "stopped",
          top: "stopped",
          lsof_other: "stopped",
          sudo: "stopped",
          su: "stopped",
        };
        expect(results).toEqual({
          ...stopped,
          // 막지 않은 것: 네트워크 도구는 네트워크가 결정대로 열려 있어 막지 않는다(시작은 하고 접속은 프록시 규칙을 따른다). 셸과 텍스트 도구는 돈다
          nc_loopback: "ran",
          sh_runs: "ran",
          grep_runs: "ran",
        });
        expect(sleeper.exitCode).toBeNull();
      } finally {
        sleeper.kill();
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hook-shaped script keeps its exit code, standard output and standard error: a block (2), an ask-like (1 with a reason) and a pass (0)",
    async () => {
      const box = await openScriptBox();
      try {
        const body = `input=$(cat)
if printf '%s' "$input" | grep -q 'rm -rf'; then
  echo "blocked: destructive command" >&2
  exit 2
fi
if printf '%s' "$input" | sed -n 's/.*"path":"\\([^"]*\\)".*/\\1/p' | grep -q '^/etc'; then
  echo '{"ask":"touches /etc"}'
  exit 1
fi
echo '{"ok":true}' | awk '{print}'
exit 0
`;
        const blocked = await box.run({
          runner: "bash",
          body,
          stdin: '{"command":"rm -rf /tmp/x"}',
        });
        const asked = await box.run({ runner: "bash", body, stdin: '{"path":"/etc/hosts"}' });
        const passed = await box.run({ runner: "bash", body, stdin: '{"path":"src/a.ts"}' });
        if (
          typeof blocked === "string" ||
          typeof asked === "string" ||
          typeof passed === "string"
        ) {
          throw new Error("a hook-shaped script did not run");
        }
        expect({ code: blocked.exitCode, out: blocked.stdout, err: blocked.stderr }).toEqual({
          code: 2,
          out: "",
          err: "blocked: destructive command\n",
        });
        expect({ code: asked.exitCode, out: asked.stdout, err: asked.stderr }).toEqual({
          code: 1,
          out: '{"ask":"touches /etc"}\n',
          err: "",
        });
        expect({ code: passed.exitCode, out: passed.stdout, err: passed.stderr }).toEqual({
          code: 0,
          out: '{"ok":true}\n',
          err: "",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the runtime runners still start after the Mach services were closed: bun runs a script and reads its own folder",
    async () => {
      const box = await openScriptBox();
      if (box.runner("bun") === undefined) {
        await box.close();
        return;
      }
      try {
        const outcome = await box.run({
          runner: "bun",
          body: `import { readFileSync } from "node:fs";
console.log(JSON.stringify({ own: readFileSync(process.argv[1], "utf8").length > 0 }));
`,
        });
        if (typeof outcome === "string") throw new Error(outcome);
        expect(JSON.parse(outcome.stdout)).toEqual({ own: true });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/** 선택한 개발자 폴더의 진짜 git. 없으면 undefined(그 시험 줄은 실패를 기대한다) */
function developerGit(): string | undefined {
  const link = "/var/select/developer_dir";
  if (!existsSync(link)) return undefined;
  const git = join(readlinkSync(link), "usr", "bin", "git");
  return existsSync(git) ? git : undefined;
}

/** 시험 폴더에 커밋 하나가 있는 저장소를 만든다(샌드박스 밖에서, 전역 설정을 쓰지 않는다) */
function seedGitRepo(dir: string, git: string): void {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  execFileSync(git, ["init", "-q"], { cwd: dir, env });
  execFileSync(
    git,
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first"],
    { cwd: dir, env },
  );
}

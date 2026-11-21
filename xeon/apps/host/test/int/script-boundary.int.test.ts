import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 스크립트 실행기(`g.runScript`)가 도는 샌드박스의 경계를 실제 샌드박스(macOS: sandbox-exec, srt)로 고정한다.
// 사용자 결정 2026-11-21(AGE-63): 승인된 플러그인의 스크립트는 열린 정책이다. 셸 도구와 같이 읽고 쓰고 시스템 도구를 쓴다.
// 막는 것은 사용자가 막은 경로(`protectedPaths.extra`, 읽기·쓰기), Fresnel 자신의 시크릿·데이터(읽기·쓰기)와 설정(쓰기), 차단 도메인뿐이다.
// 설정 `narrowDrafts`를 켠 승인 전 초안만 좁은 길(쓰기 없음, 자기 폴더 읽기)로 돈다. 네트워크는 2026-11-17 결정대로 차단 목록 밖 전체다.
// 시험이 쓰는 것은 시험이 만든 임시 폴더의 가짜 파일과 가짜 홈뿐이다. 실제 홈, `~/.ssh`, 키체인, 클립보드, 화면, AppleScript, launchd는 이 시험에서 실행하거나 열지 않는다.
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
    "files (open policy): a script reads and writes outside its folder like the shell tool; Fresnel's own data, secret and config are denied and the fake home is open",
    async () => {
      const box = await openScriptBox();
      const otherTree = join(box.root, "other-plugin", "tree");
      mkdirSync(otherTree, { recursive: true });
      writeFileSync(join(otherTree, "x.js"), "other plugin file");
      const secret = join(box.outside, "secret.txt");
      writeFileSync(secret, "fake secret in a temp folder made by this test");
      // 가짜 홈의 자격 자리. 실제 홈은 쓰지 않는다
      const fakeSsh = join(box.home, ".ssh", "id_fake");
      mkdirSync(join(box.home, ".ssh"), { recursive: true });
      writeFileSync(fakeSsh, "fake key");
      const fakeKeychain = join(box.home, "Library", "Keychains", "fake.keychain-db");
      mkdirSync(join(box.home, "Library", "Keychains"), { recursive: true });
      writeFileSync(fakeKeychain, "fake keychain");
      // Fresnel 자신의 것: 데이터(읽기·쓰기 거부), 시크릿(읽기·쓰기 거부), 설정(쓰기 거부)
      const freshnelData = join(box.root, "data", "fresnel.db");
      writeFileSync(freshnelData, "fake data");
      const freshnelSecret = join(box.root, "config", "secrets", "secret_key");
      mkdirSync(join(box.root, "config", "secrets"), { recursive: true });
      writeFileSync(freshnelSecret, "fake secret key");
      const freshnelConfig = join(box.root, "config", "settings.json");
      writeFileSync(freshnelConfig, "{}");
      const writtenOutside = join(box.outside, "written.txt");
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [
            secret,
            join(otherTree, "x.js"),
            writtenOutside,
            fakeSsh,
            fakeKeychain,
            freshnelData,
            freshnelSecret,
            freshnelConfig,
          ],
          body: `${PROBE_FN}t read_outside_secret bash -c "exec 3< $1"
t read_other_plugin bash -c "exec 3< $2"
t write_outside bash -c "echo x > $3"
t read_fake_ssh bash -c "exec 3< $4"
t read_fake_keychain bash -c "exec 3< $5"
t read_fresnel_data bash -c "exec 3< $6"
t write_fresnel_data bash -c "echo x >> $6"
t read_fresnel_secret bash -c "exec 3< $7"
t write_fresnel_secret bash -c "echo x >> $7"
t read_fresnel_config bash -c "exec 3< $8"
t write_fresnel_config bash -c "echo x >> $8"
t write_folder bash -c "echo x > ./written-in-folder.txt"
t write_own_tmp bash -c 'echo x > "$TMPDIR/probe.txt"'
t read_own bash -c "exec 3< $0"
`,
        });
        expect(results).toEqual({
          read_outside_secret: "open",
          read_other_plugin: "open",
          write_outside: "open",
          read_fake_ssh: "open",
          read_fake_keychain: "open",
          read_fresnel_data: "blocked",
          write_fresnel_data: "blocked",
          read_fresnel_secret: "blocked",
          write_fresnel_secret: "blocked",
          read_fresnel_config: "open",
          write_fresnel_config: "blocked",
          write_folder: "open",
          write_own_tmp: "open",
          read_own: "open",
        });
        // 막힌 쓰기는 파일을 바꾸지 않았고, 열린 쓰기는 파일을 만들었다(값으로 본다)
        expect(readFileSync(freshnelData, "utf8")).toBe("fake data");
        expect(readFileSync(freshnelSecret, "utf8")).toBe("fake secret key");
        expect(readFileSync(freshnelConfig, "utf8")).toBe("{}");
        expect(readFileSync(writtenOutside, "utf8")).toBe("x\n");
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
    "protectedPaths.extra (the user's own list) is denied for reads and writes under the open policy, and a sibling file next to it stays open",
    async () => {
      const extraRoot = realpathSync(mkdtempSync(join("/tmp", "fresnel-script-extra-")));
      const guarded = join(extraRoot, "guarded");
      mkdirSync(guarded, { recursive: true });
      writeFileSync(join(guarded, "fake.txt"), "fake guarded file");
      writeFileSync(join(extraRoot, "sibling.txt"), "fake sibling file");
      const box = await openScriptBox({ protectedPathsExtra: [guarded] });
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [
            join(guarded, "fake.txt"),
            join(extraRoot, "sibling.txt"),
            join(guarded, "new.txt"),
          ],
          body: `${PROBE_FN}t read_guarded bash -c "exec 3< $1"
t write_guarded bash -c "echo x > $3"
t read_sibling bash -c "exec 3< $2"
t write_sibling bash -c "echo x > $2"
`,
        });
        expect(results).toEqual({
          read_guarded: "blocked",
          write_guarded: "blocked",
          read_sibling: "open",
          write_sibling: "open",
        });
        expect(existsSync(join(guarded, "new.txt"))).toBe(false);
      } finally {
        await box.close();
        rmSync(extraRoot, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the narrow path (an unapproved draft with narrowDrafts on): the system tools are found by name only when the runner asks for them, and the draft reads and writes nothing outside its folder",
    async () => {
      const box = await openScriptBox();
      writeFileSync(
        join(box.outside, "secret.txt"),
        "fake secret in a temp folder made by this test",
      );
      const body = `${PROBE_FN}t path_lookup_cat command -v cat\nt path_lookup_grep command -v grep\nt path_lookup_git command -v git\nt read_outside bash -c "exec 3< $1"\nt write_outside bash -c "echo x > $2"\n`;
      const args = [join(box.outside, "secret.txt"), join(box.outside, "narrow-written.txt")];
      try {
        const asked = await resultsOf(box, {
          runner: "bash",
          body,
          args,
          narrowDrafts: true,
          draft: { gate: (call) => call.run(new AbortController().signal) },
        });
        expect(asked).toEqual({
          path_lookup_cat: "open",
          path_lookup_grep: "open",
          path_lookup_git: "open",
          read_outside: "blocked",
          write_outside: "blocked",
        });
        const without = await resultsOf(box, {
          runner: "bash",
          systemTools: false,
          body,
          args,
          narrowDrafts: true,
          draft: { gate: (call) => call.run(new AbortController().signal) },
        });
        expect(without).toEqual({
          path_lookup_cat: "blocked",
          path_lookup_grep: "blocked",
          path_lookup_git: "blocked",
          read_outside: "blocked",
          write_outside: "blocked",
        });
        expect(existsSync(join(box.outside, "narrow-written.txt"))).toBe(false);
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "system files under the open policy: the shell-tool folders and /etc/hosts are readable like the shell tool, and the sandbox adds no denial to them",
    async () => {
      const box = await openScriptBox();
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          body: `${PROBE_FN}t read_etc_hosts bash -c "exec 3< /etc/hosts"
t read_usr_bin bash -c "exec 3< /usr/bin/grep"
t read_bin_sh bash -c "exec 3< /bin/sh"
`,
        });
        expect(results).toEqual({
          read_etc_hosts: "open",
          read_usr_bin: "open",
          read_bin_sh: "open",
        });
      } finally {
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

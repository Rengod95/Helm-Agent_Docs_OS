import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 스크립트 실행기(`g.runScript`)가 도는 샌드박스의 경계를 실제 샌드박스(macOS: sandbox-exec, srt)로 고정한다(AGE-58, 사용자 결정 2026-11-19).
// 읽기 허용 목록을 `/bin`, `/usr/bin`으로 넓히기 전의 경계다. 넓히는 일은 네트워크가 막힌 것이 먼저 시험으로 고정될 때만 한다(결정에 붙은 조건).
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

suite("the script runner sandbox boundary before the /bin and /usr/bin widening (AGE-58)", () => {
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
    "network: KNOWN OPEN (AGE-58 open item): a client that uses the sandbox proxy credentials from its own environment reaches a loopback listener",
    async () => {
      // 막히지 않은 것을 고정한다. 프록시 주소와 인증 값이 자식의 환경 변수로 오고, 프록시는 전역 정책(차단 목록)이라 목록 밖 호스트를 모두 지나 보낸다.
      // 이것이 막히면(srt가 명령별 네트워크 차단을 주거나 프로필에서 막으면) 이 시험이 먼저 깨지고, 그때 `/bin`, `/usr/bin` 넓히기를 다시 본다.
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
    "processes: a signal to another process is blocked, and the dangerous system tools start by absolute path but get nothing out of the sandbox",
    async () => {
      const box = await openScriptBox();
      const sleeper = Bun.spawn(["sleep", "60"]);
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data() {}, open() {} },
      });
      writeFileSync(
        join(box.outside, "secret.txt"),
        "fake secret in a temp folder made by this test",
      );
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          args: [String(sleeper.pid), String(listener.port), join(box.outside, "secret.txt")],
          // 결과는 종료 코드가 0이면 ok, 아니면 fail이다. 126은 실행 자체를 막은 것이다(exec_denied)
          body: `x() { local label=$1; shift; "$@" >/dev/null 2>&1 </dev/null; local rc=$?; if [ $rc = 126 ]; then echo "$label=exec_denied"; elif [ $rc = 0 ]; then echo "$label=ok"; else echo "$label=fail"; fi; }
x path_lookup_cat command -v cat
x signal_other /bin/kill -TERM $1
x ps_other /bin/ps -p $1
x sudo /usr/bin/sudo -n true
x su /usr/bin/su -m nobody -c true
x nc_loopback /usr/bin/nc -z -w 2 127.0.0.1 $2
x ssh_loopback /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=3 -p $2 127.0.0.1 true
x osascript /usr/bin/osascript -e 'return 1'
x security_keychain /usr/bin/security list-keychains
x launchctl_list /bin/launchctl list
x pbpaste /usr/bin/pbpaste
x cat_secret /bin/cat $3
x log_show /usr/bin/log show --last 1s
x grep_run /usr/bin/grep -c "" $0
x awk_run /usr/bin/awk 'END{print NR}' /dev/null
x sh_run /bin/sh -c true
`,
        });
        expect(results).toEqual({
          // PATH 탐색은 안 된다(시스템 폴더를 읽을 수 없다). 절대 경로로는 시작된다: 실행은 읽기 허용 목록이 아니라 읽기 권한이 막는다
          path_lookup_cat: "fail",
          signal_other: "fail",
          // 실행 자체가 막히는 것: setuid 도구와 프로세스 목록
          ps_other: "exec_denied",
          sudo: "exec_denied",
          su: "exec_denied",
          // 시작은 되지만 샌드박스가 일을 막는 것
          nc_loopback: "fail",
          ssh_loopback: "fail",
          osascript: "fail",
          security_keychain: "fail",
          launchctl_list: "fail",
          pbpaste: "fail",
          cat_secret: "fail",
          log_show: "fail",
          // 시작되고 일도 하는 것(폴더 안과 표준 입력만 읽는다)
          grep_run: "ok",
          awk_run: "ok",
          sh_run: "ok",
        });
        expect(sleeper.exitCode).toBeNull();
      } finally {
        sleeper.kill();
        listener.stop();
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

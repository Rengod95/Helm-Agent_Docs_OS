import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOsRuntime } from "@fresnel/platform-os";
import { scriptRunnersOnPath } from "../../src/assembly/plugin-host.ts";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// `python3` 스크립트 실행기가 실제 샌드박스 안에서 돈다(AGE-58 마무리, 트랙 enK7, [결정: 2026-11-19, 사용자, "1-다 2-가"]).
// 설치 폴더(`sys.base_prefix`)만 읽기로 열고 쓰기와 폴더 밖 데이터 읽기는 계속 막혀 있는지 본다. 시험이 만든 가짜 값만 쓰고 얻은 값은 출력하지 않는다.
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
    "after opening the install folder: writes and reads outside the plugin folder stay blocked, and no bytecode is written",
    async () => {
      const box = await openScriptBox();
      try {
        const secret = join(box.outside, "secret.txt");
        writeFileSync(secret, "fake-secret-value");
        mkdirSync(join(box.home, ".ssh"), { recursive: true });
        writeFileSync(join(box.home, ".ssh", "id"), "fake-key");
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
check("read_outside", lambda: open(${JSON.stringify(secret)}).read())
check("read_home", lambda: open(${JSON.stringify(join(box.home, ".ssh", "id"))}).read())
check("list_home", lambda: os.listdir(${JSON.stringify(box.home)}))
check("write_tree", lambda: open(${JSON.stringify(join(box.tree, "w.txt"))}, "w").write("x"))
check("write_outside", lambda: open(${JSON.stringify(join(box.outside, "w.txt"))}, "w").write("x"))
check("write_install", lambda: open(os.path.join(sys.base_prefix, "lib", "w.txt"), "w").write("x"))
check("write_etc", lambda: open("/etc/w.txt", "w").write("x"))
check("read_etc_passwd", lambda: open("/etc/passwd").read())
check("read_tmp_write", lambda: open(os.environ["TMPDIR"] + "/ok", "w").write("x"))
out.append("dont_write_bytecode=" + str(sys.dont_write_bytecode))
print("\\n".join(out))
`,
        );
        expect(results).toEqual({
          read_outside: "blocked",
          read_home: "blocked",
          list_home: "blocked",
          write_tree: "blocked",
          write_outside: "blocked",
          write_install: "blocked",
          write_etc: "blocked",
          read_etc_passwd: "blocked",
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
    "ctypes: blocked Mach services stay blocked, other processes' info is unreadable, the keychain is unreachable",
    async () => {
      const box = await openScriptBox();
      try {
        const services = [
          "com.apple.SecurityServer",
          "com.apple.securityd.xpc",
          "com.apple.coreservices.launchservicesd",
          "com.apple.lsd.mapdb",
          "com.apple.pasteboard.1",
          "com.apple.windowserver.active",
          "com.apple.coreservices.appleevents",
          "com.apple.cfprefsd.daemon",
          "com.apple.tccd",
          "com.apple.PowerManagement.control",
          "com.apple.audio.systemsoundserver",
          "com.apple.distributed_notifications@Uv3",
        ];
        const results = await resultsOf(
          box,
          `import ctypes, ctypes.util, os
libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
out = []
bp = ctypes.c_uint32(0)
libc.mach_task_self.restype = ctypes.c_uint32
libc.task_get_special_port.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.POINTER(ctypes.c_uint32)]
libc.bootstrap_look_up.argtypes = [ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32)]
out.append("bootstrap_port=" + str(libc.task_get_special_port(libc.mach_task_self(), 4, ctypes.byref(bp))))
for name in ${JSON.stringify(services)}:
    port = ctypes.c_uint32(0)
    out.append("mach:" + name + "=" + str(libc.bootstrap_look_up(bp.value, name.encode(), ctypes.byref(port))))
OUTSIDE = ${String(process.pid)}
out.append("proc_listallpids=" + str(libc.proc_listallpids(None, 0)))
buf = ctypes.create_string_buffer(4096)
out.append("proc_pidpath_outside=" + str(libc.proc_pidpath(OUTSIDE, buf, 4096)))
out.append("proc_cwd_outside=" + str(libc.proc_pidinfo(OUTSIDE, 9, ctypes.c_uint64(0), buf, 4096)))
out.append("proc_fdlist_outside=" + str(libc.proc_pidinfo(OUTSIDE, 1, ctypes.c_uint64(0), buf, 4096)))
out.append("proc_bsdinfo_self=" + str(libc.proc_pidinfo(os.getpid(), 3, ctypes.c_uint64(0), buf, 512)))
sec = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
service = b"fresnel-bypass-probe-nonexistent"
n = ctypes.c_uint32(0)
out.append("keychain_lookup=" + str(sec.SecKeychainFindGenericPassword(None, len(service), service, 0, None, ctypes.byref(n), None, None)))
print("\\n".join(out))
`,
        );
        for (const name of services) {
          expect({ name, result: results[`mach:${name}`] }).toEqual({ name, result: "1100" });
        }
        expect(results["proc_listallpids"]).toBe("0");
        expect(results["proc_pidpath_outside"]).toBe("0");
        expect(results["proc_cwd_outside"]).toBe("0");
        expect(results["proc_fdlist_outside"]).toBe("0");
        expect(Number(results["proc_bsdinfo_self"])).toBeGreaterThan(0);
        expect(results["keychain_lookup"]).not.toBe("-25300");
        expect(results["keychain_lookup"]).not.toBe("0");
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the blocked tools do not run from python3 either (subprocess by name, absolute path and through env)",
    async () => {
      const box = await openScriptBox();
      try {
        const results = await resultsOf(
          box,
          `import subprocess
out = []
def x(label, argv):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=20)
        text = r.stdout + r.stderr
        out.append(label + "=" + ("ran" if "usage" in text.lower() else "blocked"))
    except OSError:
        out.append(label + "=blocked")
x("control_grep", ["grep", "--help"])
x("security", ["/usr/bin/security", "-h"])
x("launchctl", ["/bin/launchctl", "help"])
x("osascript", ["/usr/bin/osascript", "-h"])
x("pbpaste", ["/usr/bin/pbpaste", "-h"])
x("via_env", ["env", "security", "-h"])
x("via_sh", ["sh", "-c", "/usr/bin/security -h"])
print("\\n".join(out))
`,
        );
        expect(results).toEqual({
          control_grep: "ran",
          security: "blocked",
          launchctl: "blocked",
          osascript: "blocked",
          pbpaste: "blocked",
          via_env: "blocked",
          via_sh: "blocked",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // PATH의 `python3`가 Homebrew 링크여도 실제 인터프리터로 풀려 돈다
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
    "the install folder is readable (stdlib and its site-packages), but its parent folder and other installs are not",
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
          prefix_parent: "blocked",
        });
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

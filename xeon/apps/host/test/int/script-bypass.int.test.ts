import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 스크립트 실행기의 샌드박스를, 도구를 쓰지 않고 돌아가는 길(AGE-58 후속, 트랙 enK6)로 시험한다. 실제 샌드박스(macOS: sandbox-exec, srt)가 있어야 돈다.
// 실행기에서 `bun`의 네이티브 호출(`bun:ffi`)로 시스템 기능을 직접 부르거나, 막은 도구를 다른 경로로 실행하거나, 열린 도구로 폴더 밖 데이터를 읽어 본다.
// 시험은 "막혔다/열렸다"만 본다. 없는 이름의 키체인 항목 조회, 서비스 이름 조회, 시험 프로세스(샌드박스 밖)의 정보 조회 가능 여부만 쓰고 얻은 값은 읽지도 출력하지도 않는다.
// 실제 비밀을 읽지 않고, 화면을 찍지 않고, 클립보드 내용을 얻지 않고, 다른 앱을 조작하지 않고, 샌드박스 밖에 무엇을 등록·실행하지 않는다. 시험이 쓰는 파일은 시험이 만든 임시 폴더의 가짜 값이다.
// 샌드박스를 쓸 수 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.
// launchd에 직접 말하는 길은 프로필로 막을 수 없다: 이 시험은 그 길을 "열림"으로 문서화하지 않고, 막은 `launchctl` 실행 하나만 확인한다(스펙 L0/sandbox §4.9 "막지 못한 길").

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

/** 샌드박스가 막아야 하는 Mach 서비스(클립보드, 창 서버, 화면 녹화, 다른 앱 조작, 앱 실행, 키체인, 설정 데몬, Spotlight, 개인정보, 전원, 소리 …). 조회만 하고 메시지는 보내지 않는다 */
const BLOCKED_SERVICES: readonly string[] = [
  "com.apple.SecurityServer",
  "com.apple.securityd.xpc",
  "com.apple.security.agent",
  "com.apple.coreservices.launchservicesd",
  "com.apple.lsd.open",
  "com.apple.lsd.mapdb",
  "com.apple.lsd.modifydb",
  "com.apple.pasteboard.1",
  "com.apple.windowserver.active",
  "com.apple.CARenderServer",
  "com.apple.replayd",
  "com.apple.coreservices.appleevents",
  "com.apple.cfprefsd.daemon",
  "com.apple.cfprefsd.agent",
  "com.apple.metadata.mds",
  "com.apple.tccd",
  "com.apple.tccd.system",
  "com.apple.AddressBook.ContactsAccountsService",
  "com.apple.dock.server",
  "com.apple.sysmond",
  "com.apple.system.opendirectoryd.api",
  "com.apple.SystemConfiguration.configd",
  "com.apple.PowerManagement.control",
  "com.apple.audio.systemsoundserver",
  "com.apple.distributed_notifications@Uv3",
  "com.apple.diagnosticd",
  "com.apple.nsurlsessiond",
];

/** 네이티브 호출 시험. `bun:ffi`로 시스템 라이브러리를 직접 부른다(도구 실행 없음). 값은 출력하지 않고 결과 코드와 가능 여부만 낸다 */
function nativeProbe(names: readonly string[], outsidePid: number): string {
  return `import { dlopen, FFIType } from "bun:ffi";
const NAMES: string[] = ${JSON.stringify(names)};
const OUTSIDE_PID = ${String(outsidePid)};
const lib = dlopen("/usr/lib/libSystem.B.dylib", {
  mach_task_self: { args: [], returns: FFIType.u32 },
  task_get_special_port: { args: [FFIType.u32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  bootstrap_look_up: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  sysctl: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  proc_listallpids: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidpath: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
});
const s = lib.symbols;
const out: string[] = [];
const bp = new Uint32Array(1);
out.push("bootstrap_port=" + String(s.task_get_special_port(s.mach_task_self(), 4, bp)));
for (const name of NAMES) {
  const port = new Uint32Array(1);
  out.push("mach:" + name + "=" + String(s.bootstrap_look_up(bp[0], Buffer.from(name + "\\0"), port)));
}
out.push("proc_listallpids=" + String(s.proc_listallpids(null, 0)));
const size = new BigUint64Array(1);
out.push("sysctl_proc_table=" + String(s.sysctl(new Int32Array([1, 14, 0]), 3, null, size, null, 0n)));
const args = new Uint8Array(4096);
out.push("sysctl_procargs_outside=" + String(s.sysctl(new Int32Array([1, 49, OUTSIDE_PID]), 3, args, new BigUint64Array([4096n]), null, 0n)));
const kinfo = new Uint8Array(1024);
out.push("sysctl_kinfo_outside=" + String(s.sysctl(new Int32Array([1, 14, 1, OUTSIDE_PID]), 4, kinfo, new BigUint64Array([1024n]), null, 0n)));
out.push("proc_bsdinfo_outside=" + String(s.proc_pidinfo(OUTSIDE_PID, 3, 0n, new Uint8Array(512), 512)));
out.push("proc_cwd_outside=" + String(s.proc_pidinfo(OUTSIDE_PID, 9, 0n, new Uint8Array(4096), 4096)));
out.push("proc_fdlist_outside=" + String(s.proc_pidinfo(OUTSIDE_PID, 1, 0n, new Uint8Array(8192), 8192)));
out.push("proc_path_outside=" + String(s.proc_pidpath(OUTSIDE_PID, new Uint8Array(4096), 4096)));
out.push("proc_bsdinfo_self=" + String(s.proc_pidinfo(process.pid, 3, 0n, new Uint8Array(512), 512)));
const sec = dlopen("/System/Library/Frameworks/Security.framework/Security", {
  SecKeychainFindGenericPassword: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
});
const service = Buffer.from("fresnel-bypass-probe-nonexistent");
out.push("keychain_lookup=" + String(sec.symbols.SecKeychainFindGenericPassword(null, service.length, service, 0, null, new Uint32Array(1), new BigUint64Array(1), new BigUint64Array(1))));
const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
  CFStringCreateWithCString: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
});
const str = (text: string) => cf.symbols.CFStringCreateWithCString(null, Buffer.from(text + "\\0"), 0x08000100);
const hi = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", {
  PasteboardCreate: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
out.push("pasteboard_create=" + String(hi.symbols.PasteboardCreate(str("com.apple.pasteboard.clipboard"), new BigUint64Array(1))));
const io = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", {
  IOServiceMatching: { args: [FFIType.ptr], returns: FFIType.ptr },
  IORegistryGetRootEntry: { args: [FFIType.u32], returns: FFIType.u32 },
  IOServiceGetMatchingService: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.u32 },
  IOServiceOpen: { args: [FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  IORegistryEntryCreateCFProperty: { args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
});
const root = io.symbols.IORegistryGetRootEntry(0);
out.push("iokit_property=" + (root !== 0 && io.symbols.IORegistryEntryCreateCFProperty(root, str("IOKitBuildVersion"), null, 0) ? "readable" : "null"));
const power = io.symbols.IOServiceGetMatchingService(0, io.symbols.IOServiceMatching(Buffer.from("IOPMrootDomain\\0")));
out.push("iokit_power_open=" + (power === 0 ? "no_service" : String(io.symbols.IOServiceOpen(power, s.mach_task_self(), 0, new Uint32Array(1)))));
process.stdout.write(out.join("\\n") + "\\n");
`;
}

/** 막은 도구가 돌아가는지 본다: 실행되면 usage 문구가 나온다 */
const EXEC_FN = `x() { local label=$1; shift; local out; out=$("$@" 2>&1); if echo "$out" | grep -qi "usage"; then echo "$label=ran"; else echo "$label=blocked"; fi; }\n`;
const TOOL_FN = `t() { local label=$1; shift; local out; if out=$("$@" 2>/dev/null); then echo "$label=open:\${#out}"; else echo "$label=blocked"; fi; }\n`;

suite("script runner sandbox: bypass attempts without a tool (AGE-58 follow-up, enK6)", () => {
  test(
    "native calls from bun: the blocked Mach services stay blocked, the keychain is unreachable, other processes' info is not readable",
    async () => {
      const box = await openScriptBox();
      if (box.runner("bun") === undefined) {
        await box.close();
        return;
      }
      try {
        const results = await resultsOf(box, {
          runner: "bun",
          body: nativeProbe(BLOCKED_SERVICES, process.pid),
        });
        // 서비스 이름 조회: 1100은 샌드박스(또는 없음)로 조회가 막힌 것이다. 열린 서비스는 0이다
        for (const name of BLOCKED_SERVICES) {
          expect({ name, result: results[`mach:${name}`] }).toEqual({ name, result: "1100" });
        }
        // 키체인: 없는 항목 조회가 "항목 없음"(-25300)이면 데몬에 닿은 것이다. 막히면 다른 오류가 돌아온다
        expect(results["keychain_lookup"]).not.toBe("-25300");
        expect(results["keychain_lookup"]).not.toBe("0");
        // 다른 프로세스(이 시험 프로세스)의 정보: 목록, 인자와 환경 변수, 경로, 작업 폴더, 열린 파일, 프로세스 표 모두 막힘
        expect(results["proc_listallpids"]).toBe("0");
        expect(results["sysctl_proc_table"]).toBe("-1");
        expect(results["sysctl_procargs_outside"]).toBe("-1");
        expect(results["sysctl_kinfo_outside"]).toBe("-1");
        expect(results["proc_bsdinfo_outside"]).toBe("0");
        expect(results["proc_cwd_outside"]).toBe("0");
        expect(results["proc_fdlist_outside"]).toBe("0");
        expect(results["proc_path_outside"]).toBe("0");
        // 자기 프로세스 정보는 그대로 읽힌다(런타임이 쓴다)
        expect(Number(results["proc_bsdinfo_self"])).toBeGreaterThan(0);
        // 클립보드 만들기는 실패하고, 하드웨어 레지스트리 속성은 읽히지 않고, 전원 관리 연결은 열리지 않는다
        expect(results["pasteboard_create"]).not.toBe("0");
        expect(results["iokit_property"]).toBe("null");
        expect(results["iokit_power_open"]).not.toBe("0");
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "exec: the blocked tools do not run by name, absolute path, env, xcrun, sh -c, arch, find -exec, a symlink or a copy",
    async () => {
      const box = await openScriptBox();
      try {
        const results = await resultsOf(box, {
          runner: "bash",
          body:
            EXEC_FN +
            `x control_grep grep --help
x direct /usr/bin/security -h
x launchctl /bin/launchctl help
x osascript /usr/bin/osascript -h
x open /usr/bin/open -h
x pbpaste /usr/bin/pbpaste -h
x defaults /usr/bin/defaults help
x screencapture /usr/sbin/screencapture -h
x via_env env security -h
x via_env_abs /usr/bin/env /usr/bin/security -h
x via_xcrun xcrun security -h
x via_sh sh -c '/usr/bin/security -h'
x via_arch arch -arm64 /usr/bin/security -h
x via_dotdot /usr/bin/../bin/launchctl help
x via_exec_a bash -c 'exec -a x /usr/bin/security -h'
x via_xargs bash -c 'echo -h | xargs /usr/bin/security'
x via_find find / -maxdepth 0 -exec /usr/bin/security -h ';'
x via_script script -q /dev/null /usr/bin/security -h
ln -s /usr/bin/security "$TMPDIR/sec" 2>/dev/null
x via_symlink "$TMPDIR/sec" -h
cp /usr/bin/security "$TMPDIR/sec2" 2>/dev/null
x copy_cp "$TMPDIR/sec2" -h
cat /usr/bin/security > "$TMPDIR/sec3" 2>/dev/null; chmod +x "$TMPDIR/sec3" 2>/dev/null
echo "copy_cat_bytes=$(wc -c < "$TMPDIR/sec3" | tr -d " ")"
x copy_cat "$TMPDIR/sec3" -h
x via_dyld env DYLD_INSERT_LIBRARIES=/nonexistent /usr/bin/security -h
`,
        });
        // 대조: 막지 않은 도구는 같은 방식으로 "ran"으로 읽힌다
        expect(results["control_grep"]).toBe("ran");
        const ran = Object.entries(results).filter(
          ([name, value]) => name !== "control_grep" && value === "ran",
        );
        expect(ran).toEqual([]);
        expect(results["copy_cat_bytes"]).toBe("0");
        expect(Object.keys(results).length).toBeGreaterThanOrEqual(23);
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "open system tools cannot read data outside the plugin folder or list other processes, and the hardware registry hides its identifiers",
    async () => {
      const box = await openScriptBox();
      try {
        mkdirSync(box.outside, { recursive: true });
        writeFileSync(join(box.outside, "secret.txt"), "FIXTURE-OUTSIDE-VALUE\n");
        writeFileSync(
          join(box.outside, "x.plist"),
          '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>k</key><string>FIXTURE</string></dict></plist>',
        );
        const results = await resultsOf(box, {
          runner: "bash",
          args: [box.outside],
          body:
            TOOL_FN +
            `O=$1
t cat cat $O/secret.txt
t head head -c 5 $O/secret.txt
t find find $O -name secret.txt
t tar tar cf - -C $O secret.txt
t plutil plutil -p $O/x.plist
t grep grep -r FIXTURE $O
t dd dd if=$O/secret.txt bs=1 count=3
t strings strings $O/secret.txt
t xxd xxd $O/secret.txt
t ls ls $O
t stat stat $O/secret.txt
t curl_file curl -s file://$O/secret.txt
t awk awk '{print}' $O/secret.txt
t openssl openssl base64 -in $O/secret.txt
t ls_home ls "$HOME"
t ls_users ls /Users
t ls_apps ls /Applications
t cat_passwd cat /etc/passwd
t ls_keychains ls "$HOME/Library/Keychains"
t cat_utmpx cat /var/run/utmpx
t pgrep pgrep -fl .
echo "ioreg_serial=$(/usr/sbin/ioreg -c IOPlatformExpertDevice 2>/dev/null | grep -c IOPlatformSerialNumber)"
echo "ioreg_uuid=$(/usr/sbin/ioreg -l 2>/dev/null | grep -c IOPlatformUUID)"
`,
        });
        const open = Object.entries(results).filter(
          ([name, value]) =>
            name !== "ioreg_serial" && name !== "ioreg_uuid" && value !== "blocked",
        );
        expect(open).toEqual([]);
        expect(results["ioreg_serial"]).toBe("0");
        expect(results["ioreg_uuid"]).toBe("0");
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ScriptEnvDecl, ScriptRunResult } from "@fresnel/contracts/extensions";
import {
  listTree,
  openScriptEnvBox,
  processEnvCopy,
  sandboxGateOf,
  sha256Of,
  type EnvRunOutcome,
  type EnvRunSpec,
  type ScriptEnvBox,
} from "../support/script-env-box.ts";

// 환경 모드(가져온 훅, AGE-58 원칙 가)의 실제 샌드박스 행렬 시험(트랙 enK9). 실행기(`createScriptRunner`)가 환경 모드
// 선언(`env`)을 실제 띄우기 포트와 실제 샌드박스(srt, Seatbelt)로 돌린다. 샌드박스의 홈은 임시 가짜 홈이라 보호 경로
// (`~/.ssh`, `~/.claude`, `~/Library/Keychains`)가 가짜 홈에 있다. 자식의 사용자 환경은 이 프로세스 환경의 복사본이다
// (PATH의 버전 관리자 shim이 돌려면 실제 HOME이 필요하다). 행렬 20행(a/b 변형 포함), 막혀야 하는 행, 우회 재현, 닫힌 실패 행을 본다.
// 확인하는 것은 종료 코드, 정확한 표준 출력, 파일 생김 여부다. 가짜 비밀의 내용은 결과에 나오면 안 된다.
// 샌드박스를 쓸 수 없으면 건너뛴다(맥이 아니면 건너뛴다). FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;
const TEST_TIMEOUT_MS = 240_000;
const DISK_TMP = "/tmp";

const gate = await sandboxGateOf();
const runnable = process.platform === "darwin" && gate.runnable;
if (!runnable) {
  const reason = process.platform === "darwin" ? gate.reason : `not darwin (${process.platform})`;
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-env-matrix.int: ${reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED script-env-matrix.int: sandbox not runnable here\n");
}
const suite = runnable ? describe : describe.skip;

/** 행 하나의 결과. 실행됐는가(종료 0, 기대한 표준 출력, 확인 통과)와 종료 코드 */
interface Cell {
  readonly ran: boolean;
  readonly exit: number | null;
}

/** 이 기기에 도구가 없어 건너뛴 행 */
interface Skipped {
  readonly skipped: string;
}

/** 행렬이 돌 때 쓰는 상태(venv 경로, uv 실행 전후의 가짜 홈 목록) */
interface MatrixCtx {
  readonly box: ScriptEnvBox;
  venvPython: string;
  uvHomeBefore: readonly string[];
  uvHomeAfter: readonly string[] | undefined;
}

interface Row {
  readonly id: string;
  /** 이 기기에 있어야 하는 것: PATH의 실행 파일 이름, 또는 절대 경로 */
  readonly needs: readonly string[];
  readonly command: (ctx: MatrixCtx) => string;
  readonly shell?: "sh" | "bash";
  readonly refs?: (ctx: MatrixCtx) => ScriptEnvDecl["refs"];
  readonly extraEnv?: (ctx: MatrixCtx) => Readonly<Record<string, string>>;
  readonly setup?: (ctx: MatrixCtx) => void;
  /** 표준 출력(끝 줄바꿈을 뺀 값)이 이것과 같아야 실행된 것이다 */
  readonly stdout?: string;
  /** 표준 출력 모양 검사(버전 문구 등). 참이어야 실행된 것이다 */
  readonly check?: (stdout: string) => boolean;
  /** 실행 뒤 파일 상태 검사. 참이어야 실행된 것이다 */
  readonly after?: (ctx: MatrixCtx) => boolean;
  /** 실행 직후에 호출한다(행 판정 전) */
  readonly afterRun?: (ctx: MatrixCtx) => void;
}

function presentOnThisMac(need: string): boolean {
  return need.startsWith("/") ? existsSync(need) : Bun.which(need) !== null;
}

function requireBox(box: ScriptEnvBox | undefined): ScriptEnvBox {
  if (box === undefined) throw new Error("the script env box is not open");
  return box;
}

/** 실행 결과를 얻는다. 띄우지 못한 것(실행기 거절)은 시험 실패다 */
function resultOf(outcome: EnvRunOutcome): ScriptRunResult | undefined {
  expect(outcome.ok).toBe(true);
  return outcome.ok ? outcome.value : undefined;
}

/** `이름=값` 줄을 읽는다. 값에 `=`가 있어도 첫 `=`에서 나눈다 */
function resultsOf(stdout: string): Record<string, string> {
  const results: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) results[line.slice(0, at)] = line.slice(at + 1);
  }
  return results;
}

/** 거부 시험: 종료 코드가 0이 아니고, 출력에 가짜 비밀이나 금지 문구가 없다 */
function expectDenied(outcome: EnvRunOutcome, forbidden: readonly string[]): void {
  const result = resultOf(outcome);
  if (result === undefined) return;
  expect(result.exitCode).not.toBe(0);
  const seen = `${result.stdout}\n${result.stderr}`;
  for (const text of forbidden) expect(seen).not.toContain(text);
}

/** 진단용 첫 줄. 임시 폴더와 실제 홈 경로는 자리 표시로 바꾼다(값과 경로를 그대로 싣지 않는다) */
function firstLine(text: string, box: ScriptEnvBox): string {
  const realHome = process.env["HOME"];
  const line = text.split("\n")[0] ?? "";
  const masked = line.replaceAll(box.root, "<tmp>").replaceAll(realHome ?? "\u0000", "~");
  return masked.slice(0, 160);
}

/** 환경 모드 venv를 만든다(`--without-pip`, 설치 없음). 모듈 `mymod`를 site-packages에 둔다 */
function makeVenv(root: string): string {
  const dir = join(root, "venv");
  const made = Bun.spawnSync(["python3", "-m", "venv", "--without-pip", dir], {
    stdout: "pipe",
    stderr: "pipe",
    env: processEnvCopy(),
  });
  if (made.exitCode !== 0) throw new Error("the venv fixture could not be made");
  const lib = join(dir, "lib");
  const pythonDir = readdirSync(lib).find((entry) => entry.startsWith("python"));
  if (pythonDir === undefined) throw new Error("the venv has no python library folder");
  writeFileSync(join(lib, pythonDir, "site-packages", "mymod.py"), 'VALUE = "venv-module-ok"\n');
  return join(dir, "bin", "python");
}

/** 프로젝트 파일 하나를 쓴다(실행 권한은 따로 준다) */
function writeProject(box: ScriptEnvBox, name: string, text: string, executable = false): string {
  const path = join(box.project, name);
  writeFileSync(path, text);
  if (executable) chmodSync(path, 0o755);
  return path;
}

/** 행렬의 행. 순서가 중요하다: 프로젝트를 바꾸는 행(포매터, 훅, node_modules)은 git 상태를 보는 행(r08) 뒤에 둔다 */
const ROWS: readonly Row[] = [
  {
    id: "r01-python3",
    needs: ["python3"],
    command: () => `python3 -c "print(1+1)"`,
    stdout: "2",
  },
  {
    id: "r02-node",
    needs: ["node"],
    command: () => `node -e "console.log(2)"`,
    stdout: "2",
  },
  {
    id: "r03-bun",
    needs: ["bun"],
    command: () => `bun -e "console.log(3)"`,
    stdout: "3",
  },
  {
    id: "r04a-ruby-brew",
    needs: ["/opt/homebrew/bin/ruby"],
    command: () => `/opt/homebrew/bin/ruby -e 'print 4'`,
    stdout: "4",
  },
  {
    id: "r04b-ruby-system",
    needs: ["/usr/bin/ruby"],
    command: () => `/usr/bin/ruby -e 'print 4'`,
    stdout: "4",
  },
  {
    id: "r05-perl",
    needs: ["perl"],
    command: () => `perl -e 'print 5'`,
    stdout: "5",
  },
  {
    id: "r06-jq",
    needs: ["jq"],
    command: () => `jq -n '1+1'`,
    stdout: "2",
  },
  {
    id: "r07-rg",
    needs: ["rg"],
    command: () => `rg --version`,
    check: (stdout) => (stdout.split("\n")[0] ?? "").startsWith("ripgrep "),
  },
  {
    // 프로젝트는 커밋 하나뿐이라 깨끗해야 한다. 가짜 홈의 `.gitconfig`를 읽는다(HOME을 가짜 홈으로 바꾼다)
    id: "r08-git-status",
    needs: ["git"],
    command: () => `git status --porcelain`,
    extraEnv: (ctx) => ({ HOME: ctx.box.home }),
    stdout: "",
  },
  {
    id: "r09-gh",
    needs: ["gh"],
    command: () => `gh --version`,
    check: (stdout) => (stdout.split("\n")[0] ?? "").startsWith("gh version "),
  },
  {
    id: "r10-venv-module",
    needs: ["python3"],
    setup: (ctx) => {
      ctx.venvPython = makeVenv(ctx.box.root);
    },
    command: (ctx) => `${ctx.venvPython} -c "import mymod; print(mymod.VALUE)"`,
    stdout: "venv-module-ok",
  },
  {
    id: "r11-mise",
    needs: ["mise"],
    command: () => `mise --version`,
    check: (stdout) => /^\d+\.\d+\.\d+/.test(stdout.split("\n")[0] ?? ""),
  },
  {
    id: "r12-jq-pipe",
    needs: ["jq"],
    command: () => `f=$(echo '{"a":"b"}' | jq -r .a) && test "$f" = b && echo ok`,
    stdout: "ok",
  },
  {
    // 포매터 흉내: 프로젝트 파일을 읽어 같은 이름으로 다시 쓴다. 새 바이트를 확인한다
    id: "r13-formatter",
    needs: ["tr", "mv"],
    setup: (ctx) => {
      writeProject(ctx.box, "fmt.txt", "a  b   c\n");
    },
    command: () => `tr -s ' ' < fmt.txt > fmt.tmp && mv fmt.tmp fmt.txt && echo formatted`,
    stdout: "formatted",
    after: (ctx) => readFileSync(join(ctx.box.project, "fmt.txt"), "utf8") === "a b c\n",
  },
  {
    id: "r14a-shebang-sh",
    needs: ["sh"],
    setup: (ctx) => {
      writeProject(ctx.box, "hook.sh", "#!/bin/sh\necho sh-hook\n", true);
    },
    command: () => `./hook.sh`,
    stdout: "sh-hook",
  },
  {
    id: "r14b-shebang-py",
    needs: ["python3"],
    setup: (ctx) => {
      writeProject(ctx.box, "hook.py", '#!/usr/bin/env python3\nprint("py-hook")\n', true);
    },
    command: () => `./hook.py`,
    stdout: "py-hook",
  },
  {
    // 가짜 홈의 훅 `x.py`를 실행하고 옆 모듈 `helper`를 import한다. 참조 지문이 읽기 예외 폴더(`~/.claude/hooks`)를 정한다
    id: "r15-home-hook-sibling",
    needs: ["python3"],
    command: (ctx) => `python3 ${join(ctx.box.home, ".claude", "hooks", "x.py")}`,
    refs: (ctx) => {
      const hook = join(ctx.box.home, ".claude", "hooks", "x.py");
      return [{ path: hook, hash: sha256Of(hook) }];
    },
    stdout: "helper-ok",
  },
  {
    id: "r16a-uv-version",
    needs: ["uv"],
    command: () => `uv --version`,
    check: (stdout) => (stdout.split("\n")[0] ?? "").startsWith("uv "),
  },
  {
    // uv의 캐시 자리를 가짜 홈 아래로 준다. 캐시 쓰기는 샌드박스가 막는다: 실패하고 가짜 홈에는 아무것도 생기지 않는다
    id: "r16b-uv-run-offline",
    needs: ["uv"],
    setup: (ctx) => {
      ctx.uvHomeBefore = listTree(ctx.box.home);
    },
    command: () => `uv run --offline python3 -c "print(16)"`,
    extraEnv: (ctx) => ({ UV_CACHE_DIR: join(ctx.box.home, ".cache", "uv") }),
    afterRun: (ctx) => {
      ctx.uvHomeAfter = listTree(ctx.box.home);
    },
    stdout: "16",
  },
  {
    id: "r17-node-modules",
    needs: ["node"],
    setup: (ctx) => {
      const dir = join(ctx.box.project, "node_modules", "localpkg");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.js"), 'module.exports = "local-ok";\n');
    },
    command: () => `node -e "console.log(require('localpkg'))"`,
    stdout: "local-ok",
  },
];

/** 기대 표. 기기에 있는 도구의 행은 실행된 결과로 적는다. 없는 도구의 행은 건너뛴 이유로 적는다 */
const EXPECTED_TABLE = {
  "r01-python3": { ran: true, exit: 0 },
  "r02-node": { ran: true, exit: 0 },
  "r03-bun": { ran: true, exit: 0 },
  "r04a-ruby-brew": { ran: true, exit: 0 },
  "r04b-ruby-system": { ran: true, exit: 0 },
  "r05-perl": { ran: true, exit: 0 },
  "r06-jq": { ran: true, exit: 0 },
  "r07-rg": { ran: true, exit: 0 },
  "r08-git-status": { ran: true, exit: 0 },
  "r09-gh": { ran: true, exit: 0 },
  "r10-venv-module": { ran: true, exit: 0 },
  "r11-mise": { ran: true, exit: 0 },
  "r12-jq-pipe": { ran: true, exit: 0 },
  "r13-formatter": { ran: true, exit: 0 },
  "r14a-shebang-sh": { ran: true, exit: 0 },
  "r14b-shebang-py": { ran: true, exit: 0 },
  "r15-home-hook-sibling": { ran: true, exit: 0 },
  "r16a-uv-version": { ran: true, exit: 0 },
  "r16b-uv-run-offline": { ran: false, exit: 2 },
  "r17-node-modules": { ran: true, exit: 0 },
} satisfies Record<string, Cell>;

/** 샌드박스가 막아야 하는 Mach 서비스(enK6 `script-bypass.int.test.ts`와 같은 목록). 조회만 한다 */
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

/** enK6의 `bun:ffi` 시험과 같은 호출을 하는 파일 내용. 값은 출력하지 않고 결과 코드와 가능 여부만 낸다 */
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

/** 같은 Mach 서비스 목록을 `ctypes`로 조회하는 파이썬 파일(enK6의 `bun:ffi` 시험과 같은 호출을 다른 길로) */
function ctypesProbe(names: readonly string[]): string {
  return `import ctypes
NAMES = ${JSON.stringify(names)}
lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
lib.bootstrap_look_up.argtypes = [ctypes.c_uint, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint)]
lib.bootstrap_look_up.restype = ctypes.c_int
port = ctypes.c_uint.in_dll(lib, "bootstrap_port").value
out = []
for name in NAMES:
    found = ctypes.c_uint(0)
    rc = lib.bootstrap_look_up(port, name.encode("utf-8"), ctypes.byref(found))
    out.append("mach:%s=%d" % (name, rc))
print("\\n".join(out))
`;
}

/** 막힌 도구가 다른 경로로 도는지 본다(enK6 `EXEC_FN`과 같다): 실행되면 usage 문구가 나온다 */
const EXEC_PROBE = `x() { local label=$1; shift; local out; out=$("$@" 2>&1); if echo "$out" | grep -qi "usage"; then echo "$label=ran"; else echo "$label=blocked"; fi; }
x control_grep grep --help
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
`;

/** 보호 경로와 시스템 정보를 여는 도구 시험(enK6 TOOL 시험을 환경 모드에 맞췄다). 보호 경로(가짜 홈의 비밀)는 막혀야 한다 */
function protectedToolProbe(home: string): string {
  const ssh = join(home, ".ssh", "id_fake");
  const cred = join(home, ".claude", "credentials.json");
  const keychains = join(home, "Library", "Keychains");
  return `t() { local label=$1; shift; local out; if out=$("$@" 2>/dev/null); then echo "$label=open:\${#out}"; else echo "$label=blocked"; fi; }
t cat_ssh cat "${ssh}"
t head_ssh head -c 5 "${ssh}"
t tar tar cf - -C "${join(home, ".ssh")}" id_fake
t dd dd if="${ssh}" bs=1 count=3
t strings strings "${ssh}"
t xxd xxd "${ssh}"
t stat stat "${ssh}"
t awk awk '{print}' "${ssh}"
t openssl openssl base64 -in "${ssh}"
t curl_file curl -s "file://${ssh}"
t cat_cred cat "${cred}"
t ls_keychains ls "${keychains}"
t cat_keychain cat "${join(keychains, "fake.keychain")}"
t find find "${home}" -name id_fake
t pgrep pgrep -fl .
echo "ioreg_serial=$(/usr/sbin/ioreg -c IOPlatformExpertDevice 2>/dev/null | grep -c IOPlatformSerialNumber)"
echo "ioreg_uuid=$(/usr/sbin/ioreg -l 2>/dev/null | grep -c IOPlatformUUID)"
`;
}

/** 실제 샌드박스가 돌려준 값으로 행 하나를 판정한다 */
function cellOf(row: Row, outcome: EnvRunOutcome, ctx: MatrixCtx, notes: string[]): Cell {
  if (!outcome.ok) {
    notes.push(`ROW ${row.id} runner failure kind=${outcome.error.kind}`);
    return { ran: false, exit: null };
  }
  const result = outcome.value;
  const outputOk = row.stdout === undefined || result.stdout.trimEnd() === row.stdout;
  const shapeOk = row.check === undefined || row.check(result.stdout);
  const fileOk = row.after === undefined || row.after(ctx);
  const ran = result.exitCode === 0 && result.signal === null && outputOk && shapeOk && fileOk;
  if (!ran) {
    notes.push(
      `ROW ${row.id} exit=${String(result.exitCode)} signal=${String(result.signal)} stdout1="${firstLine(result.stdout, ctx.box)}" stderr1="${firstLine(result.stderr, ctx.box)}"`,
    );
  }
  return { ran, exit: result.exitCode };
}

function specOf(row: Row, ctx: MatrixCtx): EnvRunSpec {
  return {
    name: row.id,
    command: row.command(ctx),
    ...(row.shell === undefined ? {} : { shell: row.shell }),
    ...(row.refs === undefined ? {} : { refs: row.refs(ctx) }),
    ...(row.extraEnv === undefined ? {} : { extraEnv: row.extraEnv(ctx) }),
  };
}

suite("script runner in env mode: the real sandbox matrix (AGE-58 principle A)", () => {
  let slot: ScriptEnvBox | undefined;
  beforeAll(async () => {
    slot = await openScriptEnvBox();
  });
  afterAll(async () => {
    await slot?.close();
    slot = undefined;
  });

  test(
    "the matrix rows (20 entries, a/b variants) run in env mode: the exit code and the exact output of each tool, and the table matches the expected object",
    async () => {
      const box = requireBox(slot);
      const ctx: MatrixCtx = { box, venvPython: "", uvHomeBefore: [], uvHomeAfter: undefined };
      const notes: string[] = [];
      const table: Record<string, Cell | Skipped> = {};
      for (const row of ROWS) {
        const missing = row.needs.find((need) => !presentOnThisMac(need));
        if (missing !== undefined) {
          table[row.id] = { skipped: `${missing} is not on this Mac` };
          continue;
        }
        row.setup?.(ctx);
        // oxlint-disable-next-line no-await-in-loop -- 행은 같은 프로젝트 폴더를 쓰므로(순서가 있다: r08은 깨끗한 저장소를 본다) 하나씩 돈다 (eng.testing.guide TS-05)
        const outcome = await box.run(specOf(row, ctx));
        row.afterRun?.(ctx);
        table[row.id] = cellOf(row, outcome, ctx, notes);
      }
      if (notes.length > 0) process.stderr.write(`${notes.join("\n")}\n`);
      // 건너뛴 행은 건너뛴 이유가 그대로 기대값이다. 그 밖의 행은 기대 표와 정확히 같아야 한다
      const expected: Record<string, Cell | Skipped> = { ...EXPECTED_TABLE };
      for (const [id, value] of Object.entries(table)) {
        if ("skipped" in value) expected[id] = value;
      }
      expect(table).toEqual(expected);
      // uv가 실행된 뒤 가짜 홈에는 아무것도 생기지 않았다(캐시 쓰기가 막혔다)
      if (ctx.uvHomeAfter !== undefined) expect(ctx.uvHomeAfter).toEqual(ctx.uvHomeBefore);
    },
    TEST_TIMEOUT_MS,
  );
});

suite("script runner in env mode: negative rows (must be denied)", () => {
  let slot: ScriptEnvBox | undefined;
  beforeAll(async () => {
    slot = await openScriptEnvBox();
  });
  afterAll(async () => {
    await slot?.close();
    slot = undefined;
  });

  test(
    "N01 the fake ~/.ssh key cannot be read",
    async () => {
      const box = requireBox(slot);
      const key = join(box.home, ".ssh", "id_fake");
      expect(existsSync(key)).toBe(true);
      expectDenied(await box.run({ name: "n01-ssh-read", command: `cat "${key}"` }), [
        box.secrets.ssh,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N02 ~/.claude/credentials.json cannot be read while the hook x.py beside it is readable",
    async () => {
      const box = requireBox(slot);
      const hook = join(box.home, ".claude", "hooks", "x.py");
      const cred = join(box.home, ".claude", "credentials.json");
      const outcome = await box.run({
        name: "n02-cred-beside-hook",
        command: `if cat "${hook}" >/dev/null 2>&1; then echo x-readable; fi; cat "${cred}"`,
        refs: [{ path: hook, hash: sha256Of(hook) }],
      });
      const result = resultOf(outcome);
      if (result === undefined) return;
      // 대조: 훅 파일은 읽힌다(참조 지문이 폴더 예외를 만든다), 자격 파일은 같은 폴더 밖이라 읽히지 않는다
      expect(result.stdout).toBe("x-readable\n");
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(box.secrets.credentials);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N03 the fake keychain cannot be read, and its folder cannot be listed",
    async () => {
      const box = requireBox(slot);
      const keychains = join(box.home, "Library", "Keychains");
      const file = join(keychains, "fake.keychain");
      expect(existsSync(file)).toBe(true);
      expectDenied(await box.run({ name: "n03-keychain-read", command: `cat "${file}"` }), [
        box.secrets.keychain,
      ]);
      expectDenied(await box.run({ name: "n03-keychain-list", command: `ls "${keychains}"` }), [
        "fake.keychain",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N04 the project .env cannot be read",
    async () => {
      const box = requireBox(slot);
      writeFileSync(join(box.project, ".env"), `${box.secrets.env}\n`);
      expectDenied(await box.run({ name: "n04-project-env", command: `cat .env` }), [
        box.secrets.env,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N05 writes into the fake home, into /tmp outside the sandbox folders, and beside the project are denied",
    async () => {
      const box = requireBox(slot);
      const inHome = join(box.home, "x");
      const outside = join(DISK_TMP, `outside-${randomUUID()}`);
      try {
        expectDenied(
          await box.run({ name: "n05-home-write", command: `printf x > "${inHome}"` }),
          [],
        );
        expect(existsSync(inHome)).toBe(false);
        expectDenied(
          await box.run({ name: "n05-tmp-write", command: `printf x > "${outside}"` }),
          [],
        );
        expect(existsSync(outside)).toBe(false);
      } finally {
        rmSync(outside, { force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N06 the project's .git/hooks/pre-commit cannot be created and .git/config cannot be changed",
    async () => {
      const box = requireBox(slot);
      const hookFile = join(box.project, ".git", "hooks", "pre-commit");
      expect(existsSync(hookFile)).toBe(false);
      expectDenied(
        await box.run({
          name: "n06-git-hook-write",
          command: `printf x > .git/hooks/pre-commit`,
        }),
        [],
      );
      expect(existsSync(hookFile)).toBe(false);
      const configFile = join(box.project, ".git", "config");
      const before = readFileSync(configFile, "utf8");
      expectDenied(
        await box.run({
          name: "n06-git-config-write",
          command: `printf '[x]\\n' >> .git/config`,
        }),
        [],
      );
      expect(readFileSync(configFile, "utf8")).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N07 the blocked tools do not run: osascript, security, launchctl, open",
    async () => {
      const box = requireBox(slot);
      const osa = resultOf(
        await box.run({ name: "n07-osascript", command: `osascript -e 'return 1'` }),
      );
      if (osa !== undefined) {
        expect(osa.exitCode).not.toBe(0);
        expect(osa.stdout.trim()).not.toBe("1");
      }
      const sec = resultOf(await box.run({ name: "n07-security", command: `security -h` }));
      if (sec !== undefined) {
        expect(sec.exitCode).not.toBe(0);
        expect(`${sec.stdout}\n${sec.stderr}`).not.toMatch(/usage/i);
      }
      const launch = resultOf(await box.run({ name: "n07-launchctl", command: `launchctl list` }));
      if (launch !== undefined) {
        expect(launch.exitCode).not.toBe(0);
        expect(launch.stdout).not.toContain("Label");
      }
      // `open`은 실행이 막혀야 한다(화면에 아무것도 뜨지 않는다)
      const opened = resultOf(await box.run({ name: "n07-open", command: `open -a Finder` }));
      if (opened !== undefined) expect(opened.exitCode).not.toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "N08 the network to a closed local port fails with connection refused, not with a sandbox block",
    async () => {
      const box = requireBox(slot);
      const result = resultOf(
        await box.run({
          name: "n08-network",
          command: `curl -sS --max-time 3 http://127.0.0.1:9`,
        }),
      );
      if (result === undefined) return;
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toMatch(/refused|Couldn't connect|Failed to connect/);
      expect(result.stderr).not.toMatch(/not permitted/i);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "C1 controls: TMPDIR and the project folder are writable, and a plain file outside both is readable (wide reads by design)",
    async () => {
      const box = requireBox(slot);
      const tmpRun = resultOf(
        await box.run({
          name: "c1-tmpdir",
          command: `printf t > "$TMPDIR/t.txt" && cat "$TMPDIR/t.txt"`,
        }),
      );
      if (tmpRun !== undefined) expect(tmpRun.stdout).toBe("t");
      const projectRun = resultOf(
        await box.run({
          name: "c1-project",
          command: `printf w > written.txt && cat written.txt`,
        }),
      );
      if (projectRun !== undefined) expect(projectRun.stdout).toBe("w");
      const plain = join(box.outside, "plain.txt");
      mkdirSync(box.outside, { recursive: true });
      writeFileSync(plain, "plain-value\n");
      const plainRun = resultOf(
        await box.run({ name: "c1-plain-outside", command: `cat "${plain}"` }),
      );
      if (plainRun !== undefined) expect(plainRun.stdout).toBe("plain-value\n");
    },
    TEST_TIMEOUT_MS,
  );
});

suite("script runner in env mode: bypass replays (enK6 cases, same denied outcomes)", () => {
  let slot: ScriptEnvBox | undefined;
  beforeAll(async () => {
    slot = await openScriptEnvBox();
  });
  afterAll(async () => {
    await slot?.close();
    slot = undefined;
  });

  test(
    "ffi from bun: the blocked Mach services stay blocked, the keychain is unreachable, other processes' info is hidden",
    async () => {
      const box = requireBox(slot);
      writeProject(box, "probe-native.ts", nativeProbe(BLOCKED_SERVICES, process.pid));
      const result = resultOf(
        await box.run({ name: "b1-native-ffi", command: "bun probe-native.ts" }),
      );
      if (result === undefined) return;
      expect(result.exitCode).toBe(0);
      const results = resultsOf(result.stdout);
      for (const name of BLOCKED_SERVICES) {
        expect({ name, result: results[`mach:${name}`] }).toEqual({ name, result: "1100" });
      }
      expect(results["keychain_lookup"]).not.toBe("-25300");
      expect(results["keychain_lookup"]).not.toBe("0");
      expect(results["proc_listallpids"]).toBe("0");
      expect(results["sysctl_proc_table"]).toBe("-1");
      expect(results["sysctl_procargs_outside"]).toBe("-1");
      expect(results["sysctl_kinfo_outside"]).toBe("-1");
      expect(results["proc_bsdinfo_outside"]).toBe("0");
      expect(results["proc_cwd_outside"]).toBe("0");
      expect(results["proc_fdlist_outside"]).toBe("0");
      expect(results["proc_path_outside"]).toBe("0");
      expect(Number(results["proc_bsdinfo_self"])).toBeGreaterThan(0);
      expect(results["pasteboard_create"]).not.toBe("0");
      expect(results["iokit_property"]).toBe("null");
      expect(results["iokit_power_open"]).not.toBe("0");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "ctypes from python3: the same Mach services (launchd, launch services, notifications) stay blocked",
    async () => {
      const box = requireBox(slot);
      writeProject(box, "probe-ctypes.py", ctypesProbe(BLOCKED_SERVICES));
      const result = resultOf(
        await box.run({ name: "b4-ctypes-mach", command: "python3 probe-ctypes.py" }),
      );
      if (result === undefined) return;
      expect(result.exitCode).toBe(0);
      const results = resultsOf(result.stdout);
      for (const name of BLOCKED_SERVICES) {
        expect({ name, result: results[`mach:${name}`] }).toEqual({ name, result: "1100" });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "exec by other paths: the blocked tools do not run by name, absolute path, env, xcrun, sh -c, a symlink, or a copy",
    async () => {
      const box = requireBox(slot);
      const result = resultOf(
        await box.run({ name: "b2-exec-paths", shell: "bash", command: EXEC_PROBE }),
      );
      if (result === undefined) return;
      const results = resultsOf(result.stdout);
      expect(results["control_grep"]).toBe("ran");
      const ran = Object.entries(results).filter(
        ([name, value]) => name !== "control_grep" && value === "ran",
      );
      expect(ran).toEqual([]);
      // 막힌 도구의 복사본은 읽기부터 막힌다(도구 거부 목록이 읽기도 막는다): 복사본이 0바이트다(enK6과 같다)
      expect(results["copy_cat_bytes"]).toBe("0");
      expect(Object.keys(results).length).toBeGreaterThanOrEqual(23);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "system tools cannot read the protected fake-home secrets, list the keychain folder, or read the hardware identifiers",
    async () => {
      const box = requireBox(slot);
      const result = resultOf(
        await box.run({
          name: "b3-protected-tools",
          shell: "bash",
          command: protectedToolProbe(box.home),
        }),
      );
      if (result === undefined) return;
      const results = resultsOf(result.stdout);
      const open = Object.entries(results).filter(
        ([name, value]) => name !== "ioreg_serial" && name !== "ioreg_uuid" && value !== "blocked",
      );
      expect(open).toEqual([]);
      expect(results["ioreg_serial"]).toBe("0");
      expect(results["ioreg_uuid"]).toBe("0");
      expect(result.stdout).not.toContain(box.secrets.ssh);
      expect(result.stdout).not.toContain(box.secrets.credentials);
      expect(result.stdout).not.toContain(box.secrets.keychain);
    },
    TEST_TIMEOUT_MS,
  );
});

suite("script runner in env mode: fail-closed rows", () => {
  let slot: ScriptEnvBox | undefined;
  beforeAll(async () => {
    slot = await openScriptEnvBox();
  });
  afterAll(async () => {
    await slot?.close();
    slot = undefined;
  });

  test(
    "F0 control: with a grant and unchanged refs the command runs in the sandbox and its marker appears",
    async () => {
      const box = requireBox(slot);
      const result = resultOf(
        await box.run({ name: "f0-control", command: `printf ran > marker-f0.txt && echo fc-ok` }),
      );
      if (result === undefined) return;
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("fc-ok\n");
      expect(readFileSync(join(box.project, "marker-f0.txt"), "utf8")).toBe("ran");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Fa no envGrant: script_env_not_granted, no process is spawned, no marker",
    async () => {
      const box = requireBox(slot);
      const before = box.spawns();
      const outcome = await box.run({
        name: "fa-no-grant",
        command: `printf ran > marker-fa.txt`,
        grant: "none",
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toEqual({ kind: "script_env_not_granted" });
      expect(box.spawns()).toBe(before);
      expect(existsSync(join(box.project, "marker-fa.txt"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Fb a reference file changed after the fingerprint: script_ref_changed(changed), no process, no marker",
    async () => {
      const box = requireBox(slot);
      const refPath = join(box.project, "ref-fb.txt");
      writeFileSync(refPath, "v1\n");
      const hash = sha256Of(refPath);
      writeFileSync(refPath, "v2\n");
      const before = box.spawns();
      const outcome = await box.run({
        name: "fb-changed",
        command: `printf ran > marker-fb.txt`,
        refs: [{ path: refPath, hash }],
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toEqual({
        kind: "script_ref_changed",
        path: refPath,
        reason: "changed",
      });
      expect(box.spawns()).toBe(before);
      expect(existsSync(join(box.project, "marker-fb.txt"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Fc a reference file removed: script_ref_changed(missing), no process, no marker",
    async () => {
      const box = requireBox(slot);
      const refPath = join(box.project, "ref-fc.txt");
      writeFileSync(refPath, "v1\n");
      const hash = sha256Of(refPath);
      rmSync(refPath);
      const before = box.spawns();
      const outcome = await box.run({
        name: "fc-missing",
        command: `printf ran > marker-fc.txt`,
        refs: [{ path: refPath, hash }],
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toEqual({
        kind: "script_ref_changed",
        path: refPath,
        reason: "missing",
      });
      expect(box.spawns()).toBe(before);
      expect(existsSync(join(box.project, "marker-fc.txt"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "Fd sandbox unavailable: sandbox_unavailable, nothing ran, no marker",
    async () => {
      const box = requireBox(slot);
      const before = box.spawns();
      const outcome = await box.run({
        name: "fd-no-sandbox",
        command: `printf ran > marker-fd.txt`,
        sandboxAvailable: () => false,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toEqual({ kind: "sandbox_unavailable", reason: "sandbox_off" });
      expect(box.spawns()).toBe(before);
      expect(existsSync(join(box.project, "marker-fd.txt"))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

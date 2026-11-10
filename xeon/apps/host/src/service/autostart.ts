import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { assertNever, attempt } from "@fresnel/contracts";
import { readOsRuntime } from "@fresnel/platform-os";
import type { ServiceCommand } from "./ensure.ts";

// L4.host-service.spec §3.2, L4.remote.spec §4.2(방식 D). 로그인 자동 시작 등록·해제·상태: macOS launchd 사용자 에이전트, Linux systemd 사용자 유닛.
// 사용자 영역만 쓴다. 등록 파일이 상태의 근거이고 설정 키는 없다. 동의는 호출하는 쪽(CLI 확인, 데스크톱 확인 대화 상자)이 받는다.
// 이 모듈의 함수는 던지지 않는다. 실패는 `kind`가 있는 값으로 돌려준다.

const LABEL = "com.fresnel.service";
const UNIT = "fresnel.service";

/** 파일 입출력. 만들기와 쓰기, 지우기는 실패하면 던진다(호출하는 쪽이 `attempt`로 받는다). 읽기는 없으면 null이다 */
interface AutostartFs {
  mkdir(path: string): void;
  writeFile(path: string, text: string): void;
  readFile(path: string): string | null;
  remove(path: string): void;
  exists(path: string): boolean;
}

export interface AutostartRunResult {
  readonly exitCode: number;
  readonly stdout: string;
}

export interface AutostartDeps {
  /** `process.platform` 값. darwin과 linux만 지원한다 */
  readonly platform: string;
  /** 사용자 홈. 등록 파일의 위치를 정한다 */
  readonly home: string;
  /** 사용자 uid. launchd의 `gui/<uid>` 도메인과 `loginctl`에 쓴다 */
  readonly uid: number;
  /** 서비스를 띄우는 명령(`... service run`). 등록 파일에 그대로 적힌다 */
  readonly command: ServiceCommand;
  readonly fs: AutostartFs;
  run(cmd: string, args: readonly string[]): Promise<AutostartRunResult>;
}

type AutostartPlatform = "darwin" | "linux";

type AutostartFailureReason =
  | "write_failed"
  | "launchctl_failed"
  | "systemctl_failed"
  | "remove_failed";

export type AutostartInstallResult =
  | {
      readonly kind: "installed";
      readonly platform: AutostartPlatform;
      readonly path: string;
      /** 등록이 올라가 있다(macOS는 적재됨, Linux는 enable됨) */
      readonly active: boolean;
      /** Linux에서 linger가 켜져 있지 않다. 로그아웃 뒤에도 돌리려면 `loginctl enable-linger`가 필요하다(이 명령은 실행하지 않는다) */
      readonly lingerAdvice?: boolean;
    }
  | { readonly kind: "unsupported_platform" }
  | { readonly kind: "failed"; readonly reason: AutostartFailureReason };

export type AutostartUninstallResult =
  | { readonly kind: "removed"; readonly platform: AutostartPlatform; readonly path: string }
  | { readonly kind: "not_registered"; readonly platform: AutostartPlatform; readonly path: string }
  | { readonly kind: "unsupported_platform" }
  | { readonly kind: "failed"; readonly reason: AutostartFailureReason };

/** 자동 시작 상태. `--json`의 `autostart` 객체와 같은 모양이다 */
export interface AutostartStatus {
  readonly platform: string;
  readonly supported: boolean;
  /** 등록 파일이 있다 */
  readonly registered: boolean;
  /** macOS는 `launchctl print`가 성공함(적재됨), Linux는 `is-enabled`가 `enabled`임 */
  readonly active: boolean;
  readonly path: string | null;
  /** Linux만 본다: `Linger=yes`면 true, `Linger=no`면 false, 확인하지 못하면 null. macOS는 null */
  readonly linger: boolean | null;
}

type RemoveOutcome = "removed" | "not_registered" | "remove_failed";

const xmlReplacements: readonly (readonly [string, string])[] = [
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&apos;"],
];

function xmlEscape(text: string): string {
  return xmlReplacements.reduce((value, [from, to]) => value.replaceAll(from, () => to), text);
}

/** launchd 사용자 에이전트 plist 본문. 값은 모두 XML 이스케이프한다. RunAtLoad로 로그인 때 뜬다 */
export function launchdPlistOf(command: ServiceCommand): string {
  const args = [command.command, ...command.args].map(
    (arg) => `    <string>${xmlEscape(arg)}</string>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/**
 * systemd ExecStart의 한 토큰. 큰따옴표로 감싸고 `\`와 `"`를 이스케이프한다. systemd가 특별히 보는 `%`(지정자)와 `$`(변수)는 두 번 써서 글자 그대로 넘긴다.
 * `$`는 replaceAll의 문자열 치환에서 `$$`가 `$` 하나가 되므로 함수로 준다
 */
export function systemdQuote(token: string): string {
  const escaped = token
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")
    .replaceAll("$", () => "$$");
  return `"${escaped}"`;
}

/** systemd 사용자 유닛 본문. 로그인 때 default.target이 이 유닛을 끌어온다 */
export function systemdUnitOf(command: ServiceCommand): string {
  const execStart = [command.command, ...command.args].map(systemdQuote).join(" ");
  return [
    "[Unit]",
    "Description=Fresnel service",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execStart}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function plistPathOf(home: string): string {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

function unitPathOf(home: string): string {
  return join(home, ".config", "systemd", "user", UNIT);
}

function domainOf(uid: number): string {
  return `gui/${String(uid)}`;
}

/** 만든 디렉터리와 함께 파일을 쓴다. 실패하면 false */
function writeUnit(deps: AutostartDeps, path: string, text: string): boolean {
  return attempt(() => {
    deps.fs.mkdir(dirname(path));
    deps.fs.writeFile(path, text);
  }).ok;
}

/** 등록 파일을 지운다. 없으면 `not_registered`다 */
function removeUnit(deps: AutostartDeps, path: string): RemoveOutcome {
  if (!deps.fs.exists(path)) return "not_registered";
  return attempt(() => {
    deps.fs.remove(path);
  }).ok
    ? "removed"
    : "remove_failed";
}

/** `loginctl show-user`의 Linger. 명령이 실패하거나 모르는 값이면 null */
async function lingerOf(deps: AutostartDeps): Promise<boolean | null> {
  const shown = await deps.run("loginctl", ["show-user", String(deps.uid), "-p", "Linger"]);
  if (shown.exitCode !== 0) return null;
  const line = shown.stdout.trim();
  if (line === "Linger=yes") return true;
  if (line === "Linger=no") return false;
  return null;
}

async function installLaunchd(deps: AutostartDeps): Promise<AutostartInstallResult> {
  const path = plistPathOf(deps.home);
  if (!writeUnit(deps, path, launchdPlistOf(deps.command))) {
    return { kind: "failed", reason: "write_failed" };
  }
  // 같은 이름의 항목이 이미 올라가 있으면 내린다. 올라간 것이 없으면 실패해도 괜찮다
  await deps.run("launchctl", ["bootout", `${domainOf(deps.uid)}/${LABEL}`]);
  const bootstrapped = await deps.run("launchctl", ["bootstrap", domainOf(deps.uid), path]);
  if (bootstrapped.exitCode !== 0) {
    // 올리지 못한 등록 파일은 남기지 않는다. 지우기가 실패해도 보고는 올리기 실패다
    removeUnit(deps, path);
    return { kind: "failed", reason: "launchctl_failed" };
  }
  return { kind: "installed", platform: "darwin", path, active: true };
}

async function installSystemd(deps: AutostartDeps): Promise<AutostartInstallResult> {
  const path = unitPathOf(deps.home);
  if (!writeUnit(deps, path, systemdUnitOf(deps.command))) {
    return { kind: "failed", reason: "write_failed" };
  }
  const reloaded = await deps.run("systemctl", ["--user", "daemon-reload"]);
  if (reloaded.exitCode !== 0) {
    removeUnit(deps, path);
    return { kind: "failed", reason: "systemctl_failed" };
  }
  const enabled = await deps.run("systemctl", ["--user", "enable", UNIT]);
  if (enabled.exitCode !== 0) {
    removeUnit(deps, path);
    await deps.run("systemctl", ["--user", "daemon-reload"]);
    return { kind: "failed", reason: "systemctl_failed" };
  }
  const linger = await lingerOf(deps);
  if (linger === true) return { kind: "installed", platform: "linux", path, active: true };
  return { kind: "installed", platform: "linux", path, active: true, lingerAdvice: true };
}

/** 로그인 자동 시작을 등록한다. 같은 이름이 있으면 바꿔 올린다. 올리기나 활성화가 실패하면 방금 쓴 등록 파일을 지운다 */
export async function installAutostart(deps: AutostartDeps): Promise<AutostartInstallResult> {
  if (deps.platform === "darwin") return installLaunchd(deps);
  if (deps.platform === "linux") return installSystemd(deps);
  return { kind: "unsupported_platform" };
}

async function uninstallLaunchd(deps: AutostartDeps): Promise<AutostartUninstallResult> {
  const path = plistPathOf(deps.home);
  // 내리기는 올라간 것이 없어도 실패한다. 그 결과는 보지 않고 파일을 지운다
  await deps.run("launchctl", ["bootout", `${domainOf(deps.uid)}/${LABEL}`]);
  return uninstallResult("darwin", path, removeUnit(deps, path));
}

async function uninstallSystemd(deps: AutostartDeps): Promise<AutostartUninstallResult> {
  const path = unitPathOf(deps.home);
  await deps.run("systemctl", ["--user", "disable", UNIT]);
  const outcome = removeUnit(deps, path);
  await deps.run("systemctl", ["--user", "daemon-reload"]);
  return uninstallResult("linux", path, outcome);
}

function uninstallResult(
  platform: AutostartPlatform,
  path: string,
  outcome: RemoveOutcome,
): AutostartUninstallResult {
  if (outcome === "remove_failed") return { kind: "failed", reason: "remove_failed" };
  return { kind: outcome, platform, path };
}

/** 로그인 자동 시작을 해제하고 등록 파일을 지운다. 등록이 없었으면 `not_registered`다 */
export async function uninstallAutostart(deps: AutostartDeps): Promise<AutostartUninstallResult> {
  if (deps.platform === "darwin") return uninstallLaunchd(deps);
  if (deps.platform === "linux") return uninstallSystemd(deps);
  return { kind: "unsupported_platform" };
}

/** 자동 시작 상태. 등록 파일의 유무와 OS에 올라가 있는지를 본다. 지원하지 않는 기기는 아무것도 묻지 않는다 */
export async function autostartStatus(deps: AutostartDeps): Promise<AutostartStatus> {
  if (deps.platform === "darwin") {
    const path = plistPathOf(deps.home);
    const loaded = await deps.run("launchctl", ["print", `${domainOf(deps.uid)}/${LABEL}`]);
    return {
      platform: "darwin",
      supported: true,
      registered: deps.fs.exists(path),
      active: loaded.exitCode === 0,
      path,
      linger: null,
    };
  }
  if (deps.platform === "linux") {
    const path = unitPathOf(deps.home);
    const enabled = await deps.run("systemctl", ["--user", "is-enabled", UNIT]);
    return {
      platform: "linux",
      supported: true,
      registered: deps.fs.exists(path),
      active: enabled.stdout.trim() === "enabled",
      path,
      linger: await lingerOf(deps),
    };
  }
  return {
    platform: deps.platform,
    supported: false,
    registered: false,
    active: false,
    path: null,
    linger: null,
  };
}

const nodeFs: AutostartFs = {
  mkdir(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFile(path, text) {
    writeFileSync(path, text);
  },
  readFile(path) {
    const read = attempt(() => readFileSync(path, "utf8"));
    return read.ok ? read.value : null;
  },
  remove(path) {
    rmSync(path, { force: true });
  },
  exists(path) {
    return existsSync(path);
  },
};

const COMMAND_TIMEOUT_MS = 10_000;

/** 실행하지 못한 명령의 종료 코드. 셸과 같다: 시한 124, 찾지 못하거나 시작하지 못함 127, 중단 130. 결과는 실패로만 쓰인다 */
function exitCodeOfFailure(kind: "spawn_failed" | "timeout" | "cancelled"): number {
  switch (kind) {
    case "timeout":
      return 124;
    case "spawn_failed":
      return 127;
    case "cancelled":
      return 130;
    default:
      return assertNever(kind, "AutostartCommandFailure");
  }
}

/**
 * 실제 기기의 deps. `command`는 호출하는 쪽이 정한다(`defaultServiceCommand`는 commands.ts에 있고, 여기서 불러오면 두 모듈이 서로를 가리킨다).
 * 홈은 `os.homedir()`, uid는 `process.getuid`다. getuid가 없는 플랫폼은 지원 밖이라 값을 쓰지 않는다.
 * 외부 명령은 L0.os의 `run`으로 실행한다(DR-07: 자식 프로세스는 L0 소유 패키지만 띄운다)
 */
export function systemAutostartDeps(command: ServiceCommand): AutostartDeps {
  const runtime = readOsRuntime();
  return {
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? -1,
    command,
    fs: nodeFs,
    async run(cmd, args) {
      const ran = await runtime.run([cmd, ...args], {
        signal: new AbortController().signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return ran.ok ? ran.value : { exitCode: exitCodeOfFailure(ran.error.kind), stdout: "" };
    },
  };
}

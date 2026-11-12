// 서비스 모드. 이 컴퓨터의 로컬 대상을 띄울 때 백그라운드 서비스가 켜져 있으면 그 소켓에 브리지로 붙고,
// 아니면 이 컴퓨터의 사이드카 엔진을 띄운다. 서비스 명령 세 개(상태, 켜기, 끄기)와 로그인 자동 시작 켜기·끄기를 셸 명령으로 노출한다.
// electron을 쓰지 않는다. 운영 연결은 `service-mode-shell.ts`가 하고, 시험은 가짜 launcher로 이 파일을 돌린다.
import path from "node:path";
import { ok, parseJson } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import type { Launched, Launcher, OnceOutput } from "./engine/launcher.ts";
import type { SafeMode } from "./engine/policy.ts";
import type { AppLog } from "./lib/applog.ts";
import { ownField } from "./lib/narrow.ts";
import { fail } from "./engine/state.ts";

const LOG_PREFIX = "service-mode:";

/**
 * 서비스를 쓰려다 앱 안 엔진으로 돌아간 사유 코드(L4.host-service.spec HS-38). 화면이 코드를 번역 문구(원인과 고치는 법)로 바꾼다.
 * 코드 값은 저장 문자열이다. 새 사유는 더하기만 한다.
 */
export type ServiceStartFailureCode =
  | "launch_mode_unrunnable"
  | "launch_mode_failed"
  | "launch_mode_unreadable"
  | "ensure_unrunnable"
  | "ensure_failed"
  | "ensure_unusable"
  | "bridge_failed";

/** 마지막 서비스 시작 실패. `detail`은 사람이 읽는 기술 원인 한 줄이다(종료 코드, 오류 이름). 주소·토큰·경로는 넣지 않는다 */
export interface ServiceStartFailure {
  readonly code: ServiceStartFailureCode;
  readonly detail: string;
}

/** 마지막 시작 실패를 들고 있는 칸. 성공하거나 서비스 모드가 꺼지면 비운다 */
export interface StartFailureSlot {
  get(): ServiceStartFailure | null;
  set(failure: ServiceStartFailure | null): void;
}

export function createStartFailureSlot(): StartFailureSlot {
  const state: { current: ServiceStartFailure | null } = { current: null };
  return {
    get: () => state.current,
    set(failure) {
      state.current = failure;
    },
  };
}

/** 엔진 launcher와 서비스 명령 모듈이 같은 프로세스에서 나눠 쓰는 칸 */
export const sharedStartFailure: StartFailureSlot = createStartFailureSlot();

/** 서비스 모드 로그 한 줄을 남기고 사유를 칸에 적고 사이드카로 돌아간다. 주소와 토큰은 로그에 넣지 않는다 */
function fallbackTo(
  log: AppLog,
  slot: StartFailureSlot,
  code: ServiceStartFailureCode,
  detail: string,
): null {
  log.line(`${LOG_PREFIX} ${code} (${detail}), using the in-process engine`);
  slot.set({ code, detail });
  return null;
}

/** `service launch-mode`의 모드 이름. 읽을 수 없으면 null이다 */
function modeNameOf(stdout: string): string | null {
  const parsed = parseJson(stdout);
  if (!parsed.ok) return null;
  const mode = ownField(parsed.value, "mode");
  return typeof mode === "string" ? mode : null;
}

/** `service ensure --json`의 답. 성공 표시가 있고 소켓이 절대 경로여야 쓸 수 있다. 아니면 null이다 */
function ensureOf(stdout: string): { socket: string; version: string; action: string } | null {
  const parsed = parseJson(stdout);
  if (!parsed.ok) return null;
  const good = ownField(parsed.value, "ok") === true;
  const socket = ownField(parsed.value, "socket");
  const version = ownField(parsed.value, "version");
  const action = ownField(parsed.value, "action");
  if (!good || typeof socket !== "string" || !path.isAbsolute(socket)) return null;
  if (typeof version !== "string" || typeof action !== "string") return null;
  return { socket, version, action };
}

/**
 * 서비스 모드이고 서비스 소켓을 얻었으면 그 경로를 돌려준다. 아니면 null이다(사이드카로 띄운다).
 * 서비스 모드가 꺼져 있으면 조용히 null이다. 단계가 실패하면 한 줄을 남기고 null이다.
 */
async function serviceSocketOf(
  inner: Launcher,
  safeMode: SafeMode,
  log: AppLog,
  slot: StartFailureSlot,
): Promise<string | null> {
  const mode = await inner.runOnce(["service", "launch-mode"]);
  if (!mode.ok) return fallbackTo(log, slot, "launch_mode_unrunnable", mode.error.message);
  if (mode.value.exitCode !== 0) {
    return fallbackTo(log, slot, "launch_mode_failed", `exit ${String(mode.value.exitCode)}`);
  }
  const name = modeNameOf(mode.value.stdout);
  if (name === "in-process") {
    slot.set(null);
    return null;
  }
  if (name !== "service")
    return fallbackTo(log, slot, "launch_mode_unreadable", "unreadable output");

  const args =
    safeMode === "on"
      ? ["service", "ensure", "--json", "--safe-mode"]
      : ["service", "ensure", "--json"];
  const ensured = await inner.runOnce(args);
  if (!ensured.ok) return fallbackTo(log, slot, "ensure_unrunnable", ensured.error.message);
  if (ensured.value.exitCode !== 0) {
    return fallbackTo(log, slot, "ensure_failed", `exit ${String(ensured.value.exitCode)}`);
  }
  const answer = ensureOf(ensured.value.stdout);
  if (answer === null) return fallbackTo(log, slot, "ensure_unusable", "unusable output");
  return answer.socket;
}

/** 브리지 자식을 감싼다. 서비스 브리지 표시를 더하고 나머지 값과 메서드는 그대로 넘긴다 */
function viaServiceOf(child: Launched): Launched {
  return {
    pid: child.pid,
    events: child.events,
    stdin: child.stdin,
    killGroup: () => {
      child.killGroup();
    },
    viaService: true,
  };
}

/**
 * 로컬 대상을 띄울 때 서비스 모드면 백그라운드 서비스에 브리지로 붙는 launcher. 서비스 모드가 아니거나 어느 단계든
 * 실패하면 `inner.launch(target)`으로 이 컴퓨터의 사이드카를 띄운다. 원격 대상과 `runOnce`는 `inner`에 그대로 넘긴다.
 */
export function serviceAwareLauncher(
  inner: Launcher,
  log: AppLog,
  slot: StartFailureSlot = sharedStartFailure,
): Launcher {
  return {
    async launch(target, safeMode) {
      if (target.kind === "remote") return inner.launch(target, safeMode);
      const socket = await serviceSocketOf(inner, safeMode, log, slot);
      if (socket === null) return inner.launch(target, safeMode);
      const bridged = await inner.launch({ kind: "remote", address: `unix:${socket}` }, safeMode);
      if (!bridged.ok) {
        fallbackTo(log, slot, "bridge_failed", bridged.error.message);
        return inner.launch(target, safeMode);
      }
      slot.set(null);
      return ok(viaServiceOf(bridged.value));
    },
    runOnce(args) {
      return inner.runOnce(args);
    },
  };
}

/** 로그인 자동 시작 상태. `service status --json`의 `autostart`를 옮긴 값이다. 등록 파일의 경로는 싣지 않는다 */
export interface ServiceAutostart {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly active: boolean;
  /** Linux만 본다. 확인하지 못했거나 macOS면 null이다 */
  readonly linger: boolean | null;
  readonly platform: string;
}

/** `autostart`가 없는 `service status --json`(이전 버전 호스트)을 읽은 값. 지원하지 않는 것으로 본다 */
const NO_AUTOSTART: ServiceAutostart = {
  supported: false,
  registered: false,
  active: false,
  linger: null,
  platform: "unknown",
};

/**
 * `service status --json`의 `autostart`를 읽는다. 키가 없으면 이전 버전 호스트이므로 `NO_AUTOSTART`다.
 * 키는 있는데 모양이 틀리면 읽을 수 없는 답이다(`storage-failed`).
 */
function autostartOf(parsed: unknown): ServiceAutostart {
  const field = ownField(parsed, "autostart");
  if (field === undefined) return NO_AUTOSTART;
  const platform = ownField(field, "platform");
  const supported = ownField(field, "supported");
  const registered = ownField(field, "registered");
  const active = ownField(field, "active");
  const linger = ownField(field, "linger");
  if (
    typeof platform !== "string" ||
    typeof supported !== "boolean" ||
    typeof registered !== "boolean" ||
    typeof active !== "boolean" ||
    !(typeof linger === "boolean" || linger === null)
  ) {
    fail("storage-failed");
  }
  return { supported, registered, active, linger, platform };
}

/** 서비스 상태 답. 실행 중이면 등록 정보의 일부만 싣고, 아니면 이유만 싣는다. 두 경우 모두 자동 시작 상태를 싣는다. 토큰은 어느 쪽에도 없다. `startFailure`는 마지막 서비스 시작 실패가 있을 때만 있다 */
export type ServiceStatusReply =
  | {
      readonly running: false;
      readonly reason: string;
      readonly autostart: ServiceAutostart;
      readonly startFailure?: ServiceStartFailure;
    }
  | {
      readonly running: true;
      readonly socket: string;
      readonly pid: number;
      readonly version: string;
      readonly startedAt: number;
      readonly autostart: ServiceAutostart;
      readonly startFailure?: ServiceStartFailure;
    };

/** `service status --json`을 읽는다. 실행 중(종료 0)과 실행 아님(종료 1)만 정상이고, 나머지는 읽을 수 없는 답이다 */
function statusReplyOf(output: OnceOutput): ServiceStatusReply {
  const parsed = parseJson(output.stdout);
  if (!parsed.ok) fail("storage-failed");
  const running = ownField(parsed.value, "running");
  const autostart = autostartOf(parsed.value);
  if (output.exitCode === 0 && running === true) {
    const registration = ownField(parsed.value, "registration");
    const socket = ownField(registration, "socket");
    const pid = ownField(registration, "pid");
    const version = ownField(registration, "version");
    const startedAt = ownField(registration, "startedAt");
    if (
      typeof socket !== "string" ||
      typeof pid !== "number" ||
      typeof version !== "string" ||
      typeof startedAt !== "number"
    ) {
      fail("storage-failed");
    }
    return { running: true, socket, pid, version, startedAt, autostart };
  }
  const reason = ownField(parsed.value, "reason");
  if (output.exitCode === 1 && running === false && typeof reason === "string") {
    return { running: false, reason, autostart };
  }
  return fail("storage-failed");
}

/** 호스트가 Linux에서 linger가 꺼져 있다고 낸 안내 줄의 글. 호스트의 `LINGER_ADVICE`와 같은 줄에 든다 */
const LINGER_MARK = "loginctl enable-linger";

/** 설치 한 번의 출력에 linger 안내가 있는가. 안내는 stderr로 나오지만 stdout도 함께 본다 */
function lingerAdviceOf(output: OnceOutput): boolean {
  return output.stdout.includes(LINGER_MARK) || output.stderr.includes(LINGER_MARK);
}

/** 한 번 돌리고 끝나기를 기다린다. 돌리지 못하면 `onFailure`로 거절한다 */
async function runOnce(
  launcher: Launcher,
  args: readonly string[],
  onFailure: string,
): Promise<OnceOutput> {
  const ran = await launcher.runOnce(args);
  if (!ran.ok) throw new ShellError(onFailure);
  return ran.value;
}

/** 서비스 명령 모듈. 운영은 `service-mode-shell.ts`가 `pipedLauncher`로 엮고, 시험은 가짜 launcher로 엮는다 */
export interface ServiceModuleDeps {
  /** 이 ctx에서 한 번 돌리는 수단 */
  readonly launcherOf: (ctx: ShellContext) => Launcher;
  /** 마지막 서비스 시작 실패 칸. 기본은 엔진 launcher와 나눠 쓰는 `sharedStartFailure`다 */
  readonly failures?: StartFailureSlot;
}

export function createServiceModule(deps: ServiceModuleDeps): ShellModule {
  return {
    name: "service",
    register(ctx) {
      const launcher = deps.launcherOf(ctx);
      const failures = deps.failures ?? sharedStartFailure;

      ctx.handle("service_status", async () => {
        const output = await runOnce(launcher, ["service", "status", "--json"], "storage-failed");
        const reply = statusReplyOf(output);
        const failure = failures.get();
        return failure === null ? reply : { ...reply, startFailure: failure };
      });

      ctx.handle("service_ensure", async () => {
        const output = await runOnce(launcher, ["service", "ensure", "--json"], "start_failed");
        if (output.exitCode !== 0) throw new ShellError("start_failed");
        const answer = ensureOf(output.stdout);
        if (answer === null) throw new ShellError("start_failed");
        return answer;
      });

      ctx.handle("service_stop", async () => {
        const output = await runOnce(launcher, ["service", "stop"], "service_failed");
        if (output.exitCode !== 0) throw new ShellError("service_failed");
        return { stopped: true };
      });

      // 켜기는 `install --yes`, 끄기는 `uninstall`이다. 동의는 호출하는 화면이 받는다(확인 대화 상자). 이 명령은 그 동의를 받았다고 가정한다
      ctx.handle("service_autostart_set", async (_caller, args) => {
        const enabled = ownField(args, "enabled");
        if (typeof enabled !== "boolean") fail("bad-request");
        const output = await runOnce(
          launcher,
          enabled ? ["service", "install", "--yes"] : ["service", "uninstall"],
          "autostart_failed",
        );
        if (output.exitCode !== 0) throw new ShellError("autostart_failed");
        return { enabled, lingerAdvice: enabled && lingerAdviceOf(output) };
      });
    },
  };
}

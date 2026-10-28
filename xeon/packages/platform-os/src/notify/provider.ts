import { assertNever, err, ok, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { NotifyError, OsInfo, OsNotification } from "@xeon/contracts/services";
import type { RunCommand } from "../proc.ts";
import { PRODUCT } from "../product.ts";

// L0.os.spec §3.7. 사용자 알림 전달 수단. macOS는 osascript, Linux는 notify-send를 셸 없이 argv로 부른다.
// WSL은 Linux 경로를 그대로 쓰며 Windows 토스트(powershell.exe)는 쓰지 않는다 [결정: M3-REQ-50].

/** 제목 상한(글자) */
export const NOTIFY_TITLE_MAX = 80;
/** 본문 상한(글자) */
export const NOTIFY_BODY_MAX = 400;
/** 같은 threadId·kind 알림을 하나로 합치는 시간(ms). L0.os.spec §3.7 */
const NOTIFY_DEDUP_MS = 1000;

export interface NotifierProvider {
  /** 예: "os.os.notify/linux" */
  readonly id: string;
  available(signal: AbortSignal): Promise<boolean>;
  send(n: OsNotification, signal: AbortSignal): Promise<Result<void, NotifyError>>;
}

/** AppleScript 문자열 리터럴 안에서 뜻이 있는 두 글자를 이스케이프한다. 셸을 거치지 않으므로 이것으로 충분하다 */
function escapeAppleScript(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * 순수 함수. 실행할 argv를 만든다. 지원하지 않는 OS(win32)는 undefined다.
 * `command`는 notify-send 실행 파일 이름 또는 경로이고 기본은 PATH 탐색이다(테스트는 가짜 바이너리를 넘긴다).
 * `--` 뒤에 제목과 본문을 두어 `-`로 시작하는 문자열이 옵션으로 읽히지 않게 한다.
 */
export function buildNotifyCommand(
  info: OsInfo,
  n: OsNotification,
  command: string = "notify-send",
): readonly string[] | undefined {
  switch (info.platform) {
    case "linux":
      return [command, `--app-name=${PRODUCT.displayName}`, "--", n.title, n.body];
    case "darwin":
      return [
        "osascript",
        "-e",
        `display notification "${escapeAppleScript(n.body)}" with title "${escapeAppleScript(n.title)}"`,
      ];
    case "win32":
      return undefined;
    default:
      return assertNever(info.platform, "OsPlatform");
  }
}

export interface CommandNotifierDeps {
  readonly info: OsInfo;
  readonly run: RunCommand;
  readonly logger: Logger;
  /** notify-send 경로. 기본 PATH 탐색 */
  readonly linuxCommand?: string;
}

/** OS 알림 provider. win32는 M3 범위 밖이라 undefined다 */
export function createOsNotifierProvider(deps: CommandNotifierDeps): NotifierProvider | undefined {
  const id = `os.os.notify/${deps.info.platform}`;
  let warned = false;
  if (deps.info.platform === "win32") return undefined;
  return {
    id,
    async available(signal) {
      if (deps.info.platform === "darwin") return true;
      const ran = await deps.run([deps.linuxCommand ?? "notify-send", "--version"], { signal });
      return ran.ok && ran.value.exitCode === 0;
    },
    async send(n, signal) {
      const argv = buildNotifyCommand(deps.info, n, deps.linuxCommand);
      if (argv === undefined) return err({ kind: "disabled" });
      const ran = await deps.run(argv, { signal });
      if (ran.ok) {
        if (ran.value.exitCode === 0) return ok(undefined);
        return err({ kind: "failed", provider: id, code: `exit_${String(ran.value.exitCode)}` });
      }
      if (ran.error.kind === "cancelled") return err({ kind: "cancelled" });
      if (ran.error.kind === "timeout")
        return err({ kind: "failed", provider: id, code: "timeout" });
      // 첫 실패 때만 진단 로그 한 번(spec §5). 호출자는 알림 실패로 작업을 멈추지 않는다
      if (!warned) {
        warned = true;
        deps.logger.warn("notify.unavailable", { provider: id, code: ran.error.code });
      }
      return err({ kind: "unavailable", provider: id, reason: ran.error.code });
    },
  };
}

export interface NotifyDeps {
  /** 없으면 항상 disabled(provider none) */
  readonly provider: NotifierProvider | undefined;
  readonly clock: Clock;
  /** 로거와 같은 마스킹 함수. 제목과 본문에 한 번 더 적용한다 */
  readonly redact: (text: string) => string;
}

/**
 * OsService.notify의 구현. 글자 수 상한으로 자르고, 마스킹을 적용하고, 같은 threadId·kind 알림이 1초 안에
 * 반복되면 하나만 보낸다(둘째부터는 ok로 건너뛴다).
 */
export function createNotify(
  deps: NotifyDeps,
): (n: OsNotification, signal: AbortSignal) => Promise<Result<void, NotifyError>> {
  const lastSent = new Map<string, number>();
  return async (n, signal) => {
    const provider = deps.provider;
    if (provider === undefined) return err({ kind: "disabled" });
    if (signal.aborted) return err({ kind: "cancelled" });
    const key = `${n.kind}:${n.threadId ?? ""}`;
    const now = deps.clock.now();
    const previous = lastSent.get(key);
    if (previous !== undefined && now - previous < NOTIFY_DEDUP_MS) return ok(undefined);
    for (const [k, at] of lastSent) if (now - at >= NOTIFY_DEDUP_MS) lastSent.delete(k);
    lastSent.set(key, now);
    const sent = await provider.send(
      {
        ...n,
        title: deps.redact(n.title).slice(0, NOTIFY_TITLE_MAX),
        body: deps.redact(n.body).slice(0, NOTIFY_BODY_MAX),
      },
      signal,
    );
    if (!sent.ok) lastSent.delete(key);
    return sent;
  };
}

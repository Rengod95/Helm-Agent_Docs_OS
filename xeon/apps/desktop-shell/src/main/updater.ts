// 앱 업데이트 명령의 본체(B-10). Rust `updater.rs`의 명령과 상태 규칙을 옮긴다.
// electron과 electron-updater는 값으로 가져오지 않는다. 실제 엔진은 `updater-shell.ts`가 `UpdaterBackend`로 넘긴다.
// 서명 검증은 electron-updater가 한다. 이 모듈에는 검증을 건너뛰는 길이 없다.
import { attempt, attemptAsync, parseJson, type Result, type Thrown } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellChannel, ShellModule } from "./context.ts";

/** 확인 한 번을 기다리는 상한(밀리초). 응답이 멈춰도 busy가 풀리지 않게 한다. 넘으면 연결 불가로 본다 */
export const CHECK_TIMEOUT_MS = 30_000;

/** 찾은 새 버전 정보. 내려받기 전에 알 수 있는 것만 든다 */
export interface UpdateCandidate {
  readonly version: string;
  /** 바뀐 점. 없으면 `null` */
  readonly notes: string | null;
}

/** 업데이트 엔진의 자리. 운영은 electron-updater를, 시험은 가짜를 넣는다 */
export interface UpdaterBackend {
  /** 새 버전을 찾는다. 새 버전이 없으면 `null`. 연결이나 릴리스 문제는 던진다 */
  checkForUpdates(): Promise<UpdateCandidate | null>;
  /** 찾은 업데이트를 내려받는다. 진행은 지금까지 받은 누적 바이트와 전체 크기(모르면 `null`)로 알린다. 서명 검증 실패는 던진다 */
  download(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
  /** 내려받은 것을 설치하고 앱을 끝낸다. 실패는 던진다 */
  quitAndInstall(): void;
}

export interface UpdaterPorts {
  readonly backend: UpdaterBackend;
  /** 설정이 쓸 만한지. 거짓이면 확인은 `notConfigured`로 끝나고 백엔드를 부르지 않는다 */
  readonly configured: boolean;
  readonly currentVersion: string;
  /** 앱 로그 한 줄. 주소, 키, 파일 경로는 넣지 않는다 */
  readonly log: (line: string) => void;
  /** 확인 상한(밀리초). 생략하면 `CHECK_TIMEOUT_MS`. 시험은 짧게 준다 */
  readonly checkTimeoutMs?: number;
}

/** 실패 이유 코드. UI의 `UPDATE_REASONS`와 같은 값이다. `network`는 연결은 됐는데 서버가 오류 상태로 답한 경우(404 제외)다 */
export type UpdateFailReason =
  | "signature"
  | "no_release"
  | "network"
  | "busy"
  | "nothing_to_download"
  | "nothing_to_install"
  | "config"
  | "other";

/** 명령의 답. WebView는 `kind`로 가른다. 설치가 성공하면 앱이 끝나므로 `update_install_restart`는 답하지 않는다 */
export type UpdateReply =
  | { readonly kind: "notConfigured" }
  | { readonly kind: "upToDate" }
  | { readonly kind: "available"; readonly version: string; readonly notes: string | null }
  | { readonly kind: "offline" }
  | { readonly kind: "failed"; readonly reason: UpdateFailReason }
  | { readonly kind: "ready" };

/** 내려받는 동안 채널로 보내는 진행 알림 */
export type DownloadEvent = {
  readonly kind: "progress";
  readonly downloaded: number;
  readonly total: number | null;
};

/** 오류를 나눈 결과. 연결 문제는 `offline`, 나머지는 이유 코드다 */
export type ErrorClass =
  | { readonly kind: "offline" }
  | {
      readonly kind: "failed";
      readonly reason: "signature" | "no_release" | "network" | "config" | "other";
    };

/**
 * 설정 파일(`update-feed.json`)의 모양. 배포 주소 하나를 가진 `generic`이거나, GitHub Releases 저장소를 가리키는 `github`이다
 * (피드는 GitHub Releases로 정했다. 저장소가 비공개면 앱이 읽지 못한다)
 */
export type UpdateFeed =
  | { readonly provider: "generic"; readonly url: string }
  | { readonly provider: "github"; readonly owner: string; readonly repo: string };

/** GitHub 소유자·저장소 이름으로 쓸 수 있는 글자만 허용한다(주소 조각이라 `/`와 공백을 막는다) */
const GITHUB_NAME = /^[A-Za-z0-9._-]{1,100}$/u;

/** 설정 객체를 읽는다. 알려진 제공자(`generic`, `github`)의 필수 값이 모두 있을 때만 피드를 돌려준다. 그 밖의 모양은 모두 `null`이다 */
export function feedOf(config: unknown): UpdateFeed | null {
  const provider: unknown = fieldOf(config, "provider");
  if (provider === "github") {
    const owner: unknown = fieldOf(config, "owner");
    const repo: unknown = fieldOf(config, "repo");
    if (typeof owner !== "string" || typeof repo !== "string") return null;
    const o = owner.trim();
    const r = repo.trim();
    return GITHUB_NAME.test(o) && GITHUB_NAME.test(r)
      ? { provider: "github", owner: o, repo: r }
      : null;
  }
  const url: unknown = fieldOf(config, "url");
  if (provider !== "generic" || typeof url !== "string") return null;
  const trimmed = url.trim();
  return trimmed === "" ? null : { provider: "generic", url: trimmed };
}

/** 설정이 쓸 만한가. 없음, `null`, 형식이 다른 값, 빈 값은 모두 거짓이다 */
export function isConfigured(config: unknown): boolean {
  return feedOf(config) !== null;
}

/** 설정 파일의 글을 읽는다. JSON이 깨졌거나 설정 모양이 아니면 `null`이다 */
export function feedFromText(text: string): UpdateFeed | null {
  const parsed = parseJson(text);
  return parsed.ok ? feedOf(parsed.value) : null;
}

/** 연결 불가로 볼 오류 코드. 이 밖의 코드는 연결 문제로 보지 않는다 */
const OFFLINE_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
]);

/**
 * 플러그인 오류를 나눈다. 순서가 중요하다: 연결 코드가 먼저, 그다음 서명, 그다음 릴리스 없음이다.
 * 이유 문자열에는 주소, 키, 파일 경로를 넣지 않는다. 원문 메시지는 판정에만 쓰고 밖으로 내지 않는다.
 */
export function classifyError(error: unknown): ErrorClass {
  const code = codeOf(error);
  if (code !== null && OFFLINE_CODES.has(code)) return { kind: "offline" };
  // "code signature"는 "signature"에 이미 포함되므로 따로 보지 않는다
  const message = messageOf(error).toLowerCase();
  if (message.includes("sha512") || message.includes("signature")) {
    return { kind: "failed", reason: "signature" };
  }
  if (
    code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" ||
    message.includes("404") ||
    message.includes("cannot find latest")
  ) {
    return { kind: "failed", reason: "no_release" };
  }
  // 앱에 업데이트 설정 파일(`app-update.yml`)이 없는 것처럼 로컬 파일이 없다. 묶는 쪽의 문제라 따로 알린다
  if (code === "ENOENT") return { kind: "failed", reason: "config" };
  // 서버가 답은 했지만 오류 상태(5xx, 403 등)다. electron-updater의 HttpError는 숫자 `statusCode`를 가진다
  if (statusOf(error) !== null) return { kind: "failed", reason: "network" };
  return { kind: "failed", reason: "other" };
}

/** 응답 하나. 시간 안에 답했거나(결과는 `Result`로 받는다), 시간이 넘었다 */
type Answer<T> =
  | { readonly kind: "answered"; readonly result: Result<T, Thrown> }
  | { readonly kind: "timedOut" };

/** 일을 시간 안에 기다린다. 시간이 넘으면 `timedOut`이고, 늦게 온 답은 버린다 */
async function within<T>(ms: number, work: () => Promise<T>): Promise<Answer<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Answer<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "timedOut" });
    }, ms);
  });
  const answered = attemptAsync(work).then((result): Answer<T> => ({ kind: "answered", result }));
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** 로그에 남겨도 되는 오류 코드(`ENOENT` 같은 식별자). 모양이 다르면 `null`이다 */
export function logCodeOf(error: unknown): string | null {
  const code = codeOf(error);
  return code !== null && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null;
}

/** 실패를 답으로 바꾸고, 로그에는 단계, 이유 코드, 오류 코드(있으면)만 남긴다 */
function failureReply(
  stage: "check" | "download" | "install",
  failure: ErrorClass,
  log: (line: string) => void,
  cause: unknown,
): UpdateReply {
  if (failure.kind === "offline") {
    log(`updater: ${stage} stopped (offline)`);
    return { kind: "offline" };
  }
  const code = logCodeOf(cause);
  log(
    `updater: ${stage} failed (reason: ${failure.reason}${code === null ? "" : `, code: ${code}`})`,
  );
  return { kind: "failed", reason: failure.reason };
}

/**
 * 업데이트 명령 네 개를 등록하는 모듈. `busy` 플래그가 확인, 내려받기, 설치를 한 번에 하나로 줄인다.
 * 찾은 업데이트와 내려받기 완료 여부는 모듈 안에만 둔다. 설치가 쓰는 바이트는 백엔드(electron-updater)가 쥔다.
 */
export function createUpdaterModule(ports: UpdaterPorts): ShellModule {
  const timeoutMs = ports.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  // 확인, 내려받기, 설치 가운데 하나가 도는 동안 참이다. 겹치면 `busy`로 돌려보낸다
  let busy = false;
  // 찾은 업데이트. 새 확인이 버린다
  let found: UpdateCandidate | null = null;
  // 내려받기가 끝나 설치할 수 있는가. 내려받기를 다시 시작하면 거짓이 된다
  let staged = false;

  // 플래그를 쥔 채 일을 돌리고, 끝나면(성공이든 실패든) finally에서 내린다
  const whileBusy = async (
    work: () => UpdateReply | Promise<UpdateReply>,
  ): Promise<UpdateReply> => {
    if (busy) return { kind: "failed", reason: "busy" };
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  };

  const check = async (): Promise<UpdateReply> => {
    // 새 확인은 이전 결과와 내려받은 상태를 버린다
    found = null;
    staged = false;
    // 설정이 없으면 백엔드를 부르지 않는다
    if (!ports.configured) return { kind: "notConfigured" };
    const answer = await within(timeoutMs, () => ports.backend.checkForUpdates());
    if (answer.kind === "timedOut") {
      return failureReply("check", { kind: "offline" }, ports.log, null);
    }
    const result = answer.result;
    if (!result.ok)
      return failureReply(
        "check",
        classifyError(result.error.cause),
        ports.log,
        result.error.cause,
      );
    const candidate = result.value;
    if (candidate === null) return { kind: "upToDate" };
    found = candidate;
    return { kind: "available", version: candidate.version, notes: candidate.notes };
  };

  const download = async (channel: ShellChannel): Promise<UpdateReply> => {
    if (found === null) return { kind: "failed", reason: "nothing_to_download" };
    staged = false;
    const onProgress = (downloaded: number, total: number | null): void => {
      channel.send({ kind: "progress", downloaded, total });
    };
    const result = await attemptAsync(() => ports.backend.download(onProgress));
    if (!result.ok)
      return failureReply(
        "download",
        classifyError(result.error.cause),
        ports.log,
        result.error.cause,
      );
    staged = true;
    return { kind: "ready" };
  };

  const install = (): UpdateReply | Promise<UpdateReply> => {
    if (!staged) return { kind: "failed", reason: "nothing_to_install" };
    const result = attempt(() => ports.backend.quitAndInstall());
    if (!result.ok)
      return failureReply(
        "install",
        classifyError(result.error.cause),
        ports.log,
        result.error.cause,
      );
    // 설치가 앱 종료를 시작한다. 엔진을 내리는 일은 ecore가 ctx.onQuit에 건 정리가 before-quit에서 맡는다(Rust의 supervisor.shutdown 자리).
    // UI는 성공 답이 오지 않는다고 본다(installing에 머문다). 그래서 답하지 않고 앱이 끝나기를 기다린다
    return new Promise<UpdateReply>(() => undefined);
  };

  return {
    name: "updater",
    register(ctx) {
      ctx.handle("update_status", () => ({
        configured: ports.configured,
        currentVersion: ports.currentVersion,
      }));
      ctx.handle("update_check", () => whileBusy(check));
      ctx.handle("update_download", (caller, args) => {
        // 진행 통로가 없으면 잘못된 호출이다. busy를 잡기 전에 거절한다
        const channel = ctx.channel(caller, fieldOf(args, "onEvent"));
        if (channel === null) throw new ShellError("bad-request");
        return whileBusy(() => download(channel));
      });
      ctx.handle("update_install_restart", () => whileBusy(install));
    },
  };
}

/** 오류 값의 `code`. `Error`이면서 문자열 코드를 가질 때만 읽는다 */
function codeOf(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/** 오류 값의 HTTP 상태. `Error`이면서 숫자 `statusCode`를 가질 때만 읽는다 */
function statusOf(error: unknown): number | null {
  if (!(error instanceof Error) || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

/** 오류 값의 메시지. `Error`가 아니면 빈 글이다 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** 객체의 한 칸. 객체가 아니거나 칸이 없으면 `undefined`다. 상속 칸은 읽지 않는다 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  return field;
}

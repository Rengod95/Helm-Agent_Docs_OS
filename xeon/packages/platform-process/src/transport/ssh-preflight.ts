import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import {
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  type Clock,
  type Result,
} from "@fresnel/contracts";

// L0.process.spec §4.4.8 원격 연결 사전 점검. 원격 기기에서 `ssh` 명령만 써서 연결, 설치, 서비스, 소켓 순서로 확인한다.
// 터널과 hello 연결 시험은 이 모듈 밖에서 한다. 사람이 읽는 문장은 만들지 않는다: 단계, 원인 코드, 값만 낸다.
// 원격 명령은 전부 고정 문자열이다. 사용자 입력은 `--` 뒤의 대상 하나와 `-p` 값(정수)으로만 들어간다.

export const PREFLIGHT_CODES = [
  "running",
  "ok",
  "invalid_target",
  "invalid_port",
  "ssh_missing",
  "timeout",
  "dns",
  "refused",
  "no_route",
  "unknown",
  "auth_denied",
  "auth_password_only",
  "host_key_new",
  "host_key_changed",
  "host_key_proxy",
  "host_key_scan_failed",
  "host_key_mismatch_scan",
  "host_key_unresolved",
  "known_hosts_write_failed",
  "known_hosts_remove_failed",
  "not_installed",
  "version_unreadable",
  "version_mismatch",
  "service_status_unreadable",
  "service_start_failed",
  "socket_unreadable",
] as const;
export type PreflightCode = (typeof PREFLIGHT_CODES)[number];

export type PreflightStep = "resolve" | "connect" | "install" | "service" | "socket";

export type PreflightAction =
  | "retry"
  | "trust_host_key"
  | "replace_host_key"
  | "copy_command"
  | "upgrade_remote"
  | "upgrade_local";

export type PreflightFixHint =
  | "path_noninteractive"
  | "upgrade_remote"
  | "upgrade_local"
  | "run_once_in_terminal";

export interface PreflightFix {
  /** 복사해서 터미널에서 실행할 한 줄들. 앱이 비밀번호를 받지 않는다 */
  readonly commands: readonly string[];
  readonly hint?: PreflightFixHint;
  /** 설치 경로가 확정되지 않았다는 뜻이다. 가짜 경로를 넣지 않는다 */
  readonly installPath?: null;
}

export interface PreflightHostKey {
  /** 새 줄 중 우선 키(ED25519, ECDSA, RSA 순)의 지문 */
  readonly fingerprint: string;
  readonly keyType: string;
  readonly hostname: string;
  readonly port: number;
  /** known_hosts에 넣을 줄들. 사용자가 확인한 지문과 같은 줄 하나만 실제로 더한다 */
  readonly scanned: readonly string[];
}

export interface PreflightDetail {
  readonly hostname?: string;
  readonly port?: number;
  readonly user?: string;
  readonly proxyJump?: boolean;
  readonly hostKey?: PreflightHostKey;
  readonly local?: string;
  readonly remote?: string;
  readonly lower?: "local" | "remote";
  readonly cliDiffers?: boolean;
  readonly action?: "started_service";
  readonly reason?: string;
  readonly socket?: string;
  /** 알 수 없는 ssh 오류의 첫 줄(최대 200자) */
  readonly stderr?: string;
}

export interface PreflightEvent {
  readonly step: PreflightStep;
  readonly status: "running" | "pass" | "fail" | "action";
  readonly code: PreflightCode;
  readonly durationMs: number;
  readonly actions: readonly PreflightAction[];
  readonly detail?: PreflightDetail;
  readonly fix?: PreflightFix;
}

export interface PreflightStop {
  readonly ok: false;
  readonly step: PreflightStep;
  /** "action"은 사용자가 정해야 다음으로 갈 수 있다(예: 새 호스트 키 신뢰) */
  readonly status: "fail" | "action";
  readonly code: PreflightCode;
  readonly actions: readonly PreflightAction[];
  readonly detail?: PreflightDetail;
  readonly fix?: PreflightFix;
}

export type PreflightResult =
  | {
      readonly ok: true;
      /** `ssh://[user@]host[:port]/<절대 소켓 경로>`. packages/client의 `parseServiceEndpoint`가 읽는 모양이다 */
      readonly address: string;
      readonly socket: string;
      readonly remoteVersion: { readonly cli: string; readonly contract: string };
      readonly serviceVersion: string;
    }
  | PreflightStop;

export interface ExecOptions {
  readonly timeoutMs: number;
  readonly stdin?: string;
}

export interface ExecResult {
  readonly code: number | null;
  readonly signal: string | null;
  /** 최대 64KB */
  readonly stdout: string;
  /** 최대 64KB */
  readonly stderr: string;
  /** 실행 파일을 띄우지 못한 오류 코드(예: ENOENT). 띄웠으면 null */
  readonly spawnError: string | null;
  readonly timedOut: boolean;
}

export type ExecFn = (
  command: string,
  args: readonly string[],
  opts: ExecOptions,
) => Promise<ExecResult>;

export interface SshPreflightDeps {
  /** 홈 디렉터리. 기본 known_hosts는 `<home>/.ssh/known_hosts` */
  readonly home: string;
  readonly clock: Clock;
  readonly sshPath?: string;
  readonly keyscanPath?: string;
  readonly keygenPath?: string;
  readonly knownHostsPath?: string;
  /** 기본은 `spawnExec`(node:child_process) */
  readonly exec?: ExecFn;
}

export interface SshPreflightInput {
  /** `user@host[:port]` 또는 ssh config 별칭 */
  readonly target: string;
  readonly local: { readonly cli: string; readonly contract: string };
  /** 사용자가 화면에서 확인한 지문. 있으면 known_hosts에 더하고 다시 시도한다 */
  readonly trustHostKey?: { readonly fingerprint: string };
  /** 키가 바뀐 것을 사용자가 확인하고, 옛 줄을 지우고 새 줄을 더하는 허락. `trustHostKey`와 함께 있어야 한다 */
  readonly replaceChangedHostKey?: boolean;
}

export interface SshTarget {
  /** `[user@]host`. ssh 선택지로 읽히지 않는다 */
  readonly target: string;
  readonly port: number | null;
}

export type SshTargetError =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid_target" }
  | { readonly kind: "invalid_port" };

const KILL_GRACE_MS = 1000;
const OUTPUT_CAP_BYTES = 64 * 1024;
const CONNECT_TIMEOUT_MS = 20_000;
const RESOLVE_TIMEOUT_MS = 15_000;
const REMOTE_TIMEOUT_MS = 30_000;
const ENSURE_TIMEOUT_MS = 60_000;
const SCAN_TIMEOUT_MS = 15_000;
const KEYGEN_TIMEOUT_MS = 10_000;
const MESSAGE_CHARS = 200;

/** 실행 파일을 띄운다. 입력은 `stdin`이 있을 때만 파이프로 넘긴다. 부모 환경은 그대로 상속한다(ssh-agent 소켓 때문에) */
export function spawnExec(
  command: string,
  args: readonly string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const stdout = outputCollector();
    const stderr = outputCollector();
    let exit: { readonly code: number | null; readonly signal: string | null } | undefined;
    let timedOut = false;
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (spawnError: string | null): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolve({
        code: exit?.code ?? null,
        signal: exit?.signal ?? null,
        stdout: stdout.text(),
        stderr: stderr.text(),
        spawnError,
        timedOut,
      });
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (caught: Error) => {
      finish(errnoCode(caught));
    });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      // 손자 프로세스가 파이프를 쥐고 있으면 close가 늦는다. 잠깐 기다려도 닫히지 않으면 모은 만큼으로 끝낸다
      timers.push(
        setTimeout(() => {
          finish(null);
        }, KILL_GRACE_MS),
      );
    });
    child.on("close", (code, signal) => {
      exit ??= { code, signal };
      finish(null);
    });
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs),
    );
    const stdin = child.stdin;
    if (stdin !== null) {
      // 자식이 입력을 다 읽기 전에 끝나면 EPIPE가 온다. 결과는 종료 코드와 spawnError로 판단하므로 이 오류는 따로 다루지 않는다
      stdin.on("error", () => undefined);
      stdin.end(opts.stdin ?? "");
    }
  });
}

/** 출력을 앞에서부터 64KB까지만 모은다 */
function outputCollector(): { push(chunk: Buffer): void; text(): string } {
  const parts: Buffer[] = [];
  let size = 0;
  return {
    push(chunk) {
      if (size >= OUTPUT_CAP_BYTES) return;
      const piece = chunk.subarray(0, OUTPUT_CAP_BYTES - size);
      parts.push(piece);
      size += piece.length;
    },
    text() {
      return Buffer.concat(parts).toString("utf8");
    },
  };
}

function errnoCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

const TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._@%-]*$/;
/** `ssh://` 주소 문법(packages/client)이 받는 사용자 이름과 호스트 이름 모양 */
const USER_PART = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const HOST_PART = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const PORT_SUFFIX = /^(.+):(\d+)$/;
const PORT_TEXT = /^\d{1,5}$/;
/** `ssh -G`가 알려 준 호스트 이름이 keyscan·keygen 인자로 선택지처럼 읽히지 않는지 본다(`-`로 시작하지 않는다) */
const SAFE_HOSTNAME = /^[A-Za-z0-9_][A-Za-z0-9._:%-]*$/;

function portOf(text: string): number | null {
  if (!PORT_TEXT.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

function isSafeTarget(target: string): boolean {
  if (!TARGET_PATTERN.test(target)) return false;
  const at = target.lastIndexOf("@");
  const user = at < 0 ? null : target.slice(0, at);
  const host = target.slice(at + 1);
  return (user === null || USER_PART.test(user)) && HOST_PART.test(host);
}

/** `[user@]host[:port]` 또는 ssh 별칭을 나눈다. IPv6 대괄호 형식과 `-`로 시작하는 값은 거부한다 */
export function parseSshTarget(text: string): Result<SshTarget, SshTargetError> {
  const trimmed = text.trim();
  if (trimmed === "") return err({ kind: "empty" });
  const suffix = PORT_SUFFIX.exec(trimmed);
  const hostPart = suffix === null ? trimmed : (suffix[1] ?? "");
  let port: number | null = null;
  if (suffix !== null) {
    const parsed = portOf(suffix[2] ?? "");
    if (parsed === null) return err({ kind: "invalid_port" });
    port = parsed;
  }
  if (!isSafeTarget(hostPart)) return err({ kind: "invalid_target" });
  return ok({ target: hostPart, port });
}

function hostOf(target: string): string {
  return target.slice(target.lastIndexOf("@") + 1);
}

function isSocketPath(path: string): boolean {
  const controlChars = Array.from(path).some(
    (char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f,
  );
  return /^\/[^\s:]*$/.test(path) && !controlChars;
}

/** `ssh` 옵션 공통 부분. 대상 앞에 `--`를 두는 것은 호출부가 한다 */
function sshOptions(port: number | null): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "NumberOfPasswordPrompts=0",
    ...(port === null ? [] : ["-p", String(port)]),
  ];
}

const ACTIONS: Readonly<Record<PreflightCode, readonly PreflightAction[]>> = {
  running: [],
  ok: [],
  invalid_target: [],
  invalid_port: [],
  ssh_missing: ["retry"],
  timeout: ["retry"],
  dns: ["retry"],
  refused: ["retry"],
  no_route: ["retry"],
  unknown: ["retry"],
  auth_denied: ["retry"],
  auth_password_only: ["copy_command", "retry"],
  host_key_new: ["trust_host_key"],
  host_key_changed: ["replace_host_key"],
  host_key_proxy: ["copy_command", "retry"],
  host_key_scan_failed: ["retry"],
  host_key_mismatch_scan: ["retry"],
  host_key_unresolved: ["retry"],
  known_hosts_write_failed: ["retry"],
  known_hosts_remove_failed: ["retry"],
  not_installed: ["retry"],
  version_unreadable: ["retry"],
  version_mismatch: ["upgrade_remote"],
  service_status_unreadable: ["retry"],
  service_start_failed: ["retry"],
  socket_unreadable: ["retry"],
};

interface Classified {
  readonly code: PreflightCode;
  readonly stderr?: string;
}

function firstStderrLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  return line.trim().slice(0, MESSAGE_CHARS);
}

/** ssh가 낸 실패를 원인 코드로 나눈다. 원격 명령의 실패(ssh 종료 코드 255가 아닌 것)에는 쓰지 않는다 */
function classifyFailure(run: ExecResult): Classified {
  if (run.spawnError !== null) {
    return run.spawnError === "ENOENT"
      ? { code: "ssh_missing" }
      : { code: "unknown", stderr: run.spawnError };
  }
  if (run.timedOut) return { code: "timeout" };
  const text = run.stderr;
  if (text.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) return { code: "host_key_changed" };
  if (/No \S+ host key is known|Host key verification failed/.test(text)) {
    return { code: "host_key_new" };
  }
  if (text.includes("Permission denied")) {
    const methods = /Permission denied \(([^)]*)\)/.exec(text)?.[1] ?? "";
    return /password|keyboard-interactive/.test(methods)
      ? { code: "auth_password_only" }
      : { code: "auth_denied" };
  }
  if (text.includes("Could not resolve hostname")) return { code: "dns" };
  if (text.includes("Connection refused")) return { code: "refused" };
  if (/timed out/.test(text)) return { code: "timeout" };
  if (/No route to host|Network is unreachable/.test(text)) return { code: "no_route" };
  return { code: "unknown", stderr: firstStderrLine(text) };
}

function isSuccess(run: ExecResult): boolean {
  return run.spawnError === null && !run.timedOut && run.code === 0;
}

/** ssh 자체의 실패(연결, 인증, 종료 코드 255)이거나 실행 파일이 없거나 시한을 넘긴 경우 */
function isTransportFailure(run: ExecResult): boolean {
  return run.spawnError !== null || run.timedOut || run.code === 255;
}

function fixFor(code: PreflightCode, target: SshTarget): PreflightFix | undefined {
  const portFlag = target.port === null ? "" : `-p ${String(target.port)} `;
  if (code === "auth_password_only") {
    return { commands: [`ssh-copy-id ${portFlag}${target.target}`] };
  }
  if (code === "host_key_proxy") {
    return { commands: [`ssh ${portFlag}${target.target}`], hint: "run_once_in_terminal" };
  }
  if (code === "not_installed") {
    return { commands: [], installPath: null, hint: "path_noninteractive" };
  }
  return undefined;
}

interface Body {
  readonly code: PreflightCode;
  readonly actions?: readonly PreflightAction[];
  readonly detail?: PreflightDetail;
  readonly fix?: PreflightFix;
}

function bodyFor(code: PreflightCode, target: SshTarget, stderr?: string): Body {
  const fix = fixFor(code, target);
  return {
    code,
    actions: ACTIONS[code],
    ...(fix === undefined ? {} : { fix }),
    ...(stderr === undefined ? {} : { detail: { stderr } }),
  };
}

function simple(code: PreflightCode): Body {
  return { code, actions: ACTIONS[code] };
}

interface Ctx {
  readonly input: SshPreflightInput;
  readonly clock: Clock;
  readonly exec: ExecFn;
  readonly ssh: string;
  readonly keyscan: string;
  readonly keygen: string;
  readonly knownHostsPath: string;
  readonly onEvent: (event: PreflightEvent) => void;
}

function begin(ctx: Ctx, step: PreflightStep): number {
  ctx.onEvent({ step, status: "running", code: "running", durationMs: 0, actions: [] });
  return ctx.clock.now();
}

function elapsed(ctx: Ctx, startedAt: number): number {
  return ctx.clock.now() - startedAt;
}

function passed(ctx: Ctx, step: PreflightStep, startedAt: number, detail?: PreflightDetail): void {
  ctx.onEvent({
    step,
    status: "pass",
    code: "ok",
    durationMs: elapsed(ctx, startedAt),
    actions: [],
    ...(detail === undefined ? {} : { detail }),
  });
}

function optionalParts(body: Body): { detail?: PreflightDetail; fix?: PreflightFix } {
  const parts: { detail?: PreflightDetail; fix?: PreflightFix } = {};
  if (body.detail !== undefined) parts.detail = body.detail;
  if (body.fix !== undefined) parts.fix = body.fix;
  return parts;
}

/** 실패 이벤트를 내고 멈춤 사유를 돌려준다. 멈추지 않는 실패(resolve)는 반환값을 버린다 */
function failed(
  ctx: Ctx,
  step: PreflightStep,
  startedAt: number,
  status: "fail" | "action",
  body: Body,
): PreflightStop {
  const actions = body.actions ?? [];
  const parts = optionalParts(body);
  ctx.onEvent({
    step,
    status,
    code: body.code,
    durationMs: elapsed(ctx, startedAt),
    actions,
    ...parts,
  });
  return { ok: false, step, status, code: body.code, actions, ...parts };
}

function failedWith(
  ctx: Ctx,
  step: PreflightStep,
  startedAt: number,
  classified: Classified,
  target: SshTarget,
): PreflightStop {
  return failed(ctx, step, startedAt, "fail", bodyFor(classified.code, target, classified.stderr));
}

function sshCall(
  ctx: Ctx,
  target: SshTarget,
  remote: readonly string[],
  timeoutMs: number,
): Promise<ExecResult> {
  return ctx.exec(ctx.ssh, [...sshOptions(target.port), "--", target.target, ...remote], {
    timeoutMs,
  });
}

function connectOnce(ctx: Ctx, target: SshTarget): Promise<ExecResult> {
  return sshCall(ctx, target, ["true"], CONNECT_TIMEOUT_MS);
}

// ---- 읽은 JSON의 모양(TypeBox). 경계 값이므로 parse로 검증한다 ----

const VersionOutput = Type.Object({ cli: Type.String(), contract: Type.String() });
const StatusOutput = Type.Object({
  running: Type.Boolean(),
  registration: Type.Optional(
    Type.Object({
      socket: Type.Optional(Type.String()),
      version: Type.Optional(Type.String()),
    }),
  ),
});
const EnsureOutput = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    socket: Type.Optional(Type.String()),
    version: Type.String(),
  }),
  Type.Object({ ok: Type.Literal(false), reason: Type.Optional(Type.String()) }),
]);

/** 출력의 마지막 비어 있지 않은 줄을 JSON으로 읽는다(셸 시작 메시지가 앞에 붙어도 된다) */
function readJson<S extends TSchema>(
  text: string,
  schema: S,
): Result<Static<S>, { readonly kind: "unreadable" }> {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const json = parseJson(lines.at(-1) ?? "");
  if (!json.ok) return err({ kind: "unreadable" });
  const checked = parse(schema, json.value);
  return checked.ok ? ok(checked.value) : err({ kind: "unreadable" });
}

/** `MAJOR.MINOR.PATCH` 정수만 받는다. 맞지 않으면 null */
function semverParts(text: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (match === null) return null;
  const [, major = "0", minor = "0", patch = "0"] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/** 음수면 a가 낮다, 0이면 같다, 양수면 a가 높다. 맞지 않는 버전이면 null */
function compareContracts(a: string, b: string): number | null {
  const left = semverParts(a);
  const right = semverParts(b);
  if (left === null || right === null) return null;
  const diff = left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  return Math.sign(diff);
}

// ---- known_hosts와 호스트 키 ----

interface Resolved {
  readonly hostname: string;
  /** 실제 포트(명시 값 > ssh 설정 > 22) */
  readonly port: number;
  readonly proxyJump: boolean;
}

interface ScannedKey {
  readonly line: string;
  readonly fingerprint: string;
  readonly keyType: string;
}

interface Scan {
  readonly keys: readonly ScannedKey[];
  readonly preferred: ScannedKey;
}

const KEY_RANK: readonly string[] = ["ED25519", "ECDSA", "RSA"];

function rankOf(key: ScannedKey): number {
  const index = KEY_RANK.indexOf(key.keyType);
  return index === -1 ? KEY_RANK.length : index;
}

function knownHostName(host: Resolved): string {
  return host.port === 22 ? host.hostname : `[${host.hostname}]:${String(host.port)}`;
}

function hostKeyInfo(scan: Scan, host: Resolved): PreflightHostKey {
  return {
    fingerprint: scan.preferred.fingerprint,
    keyType: scan.preferred.keyType,
    hostname: host.hostname,
    port: host.port,
    scanned: scan.keys.map((key) => key.line),
  };
}

/** 한 줄의 지문과 키 종류를 `ssh-keygen -lf -`로 계산한다 */
async function fingerprintOf(ctx: Ctx, line: string): Promise<ScannedKey | null> {
  const run = await ctx.exec(ctx.keygen, ["-lf", "-"], {
    timeoutMs: KEYGEN_TIMEOUT_MS,
    stdin: `${line}\n`,
  });
  if (run.spawnError !== null || run.timedOut || run.code !== 0) return null;
  const first = run.stdout.split("\n")[0] ?? "";
  const fingerprint = /SHA256:\S+/.exec(first)?.[0];
  const keyType = /\(([^)]+)\)\s*$/.exec(first)?.[1];
  if (fingerprint === undefined || keyType === undefined) return null;
  return { line, fingerprint, keyType };
}

async function scanHostKeys(
  ctx: Ctx,
  host: Resolved,
): Promise<Result<Scan, { readonly kind: "scan_failed" }>> {
  const run = await ctx.exec(
    ctx.keyscan,
    ["-p", String(host.port), "-T", "5", "--", host.hostname],
    { timeoutMs: SCAN_TIMEOUT_MS },
  );
  if (run.spawnError !== null || run.timedOut || run.code !== 0) {
    return err({ kind: "scan_failed" });
  }
  const lines = run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const fingerprints = await Promise.all(lines.map((line) => fingerprintOf(ctx, line)));
  const keys: ScannedKey[] = [];
  for (const key of fingerprints) {
    if (key === null) return err({ kind: "scan_failed" });
    keys.push(key);
  }
  let preferred: ScannedKey | undefined;
  for (const key of keys) {
    if (preferred === undefined || rankOf(key) < rankOf(preferred)) preferred = key;
  }
  if (preferred === undefined) return err({ kind: "scan_failed" });
  return ok({ keys, preferred });
}

/** 줄을 known_hosts에 더한다. 이미 같은 줄이 있으면 아무것도 하지 않는다. 파일은 0600, 새 디렉터리는 0700 */
async function appendKnownHost(
  path: string,
  line: string,
): Promise<Result<void, { readonly kind: "write_failed"; readonly cause: unknown }>> {
  const existing = await attemptAsync(() => readFile(path, "utf8"));
  let text = "";
  if (existing.ok) {
    text = existing.value;
  } else if (errnoCode(existing.error.cause) !== "ENOENT") {
    return err({ kind: "write_failed", cause: existing.error.cause });
  }
  if (text.split("\n").includes(line)) return ok(undefined);
  const dir = dirname(path);
  const made = await attemptAsync(() => mkdir(dir, { recursive: true, mode: 0o700 }));
  if (!made.ok) return err({ kind: "write_failed", cause: made.error.cause });
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  const written = await attemptAsync(() =>
    appendFile(path, `${separator}${line}\n`, { mode: 0o600 }),
  );
  return written.ok ? ok(undefined) : err({ kind: "write_failed", cause: written.error.cause });
}

/** 옛 호스트 키 줄을 `ssh-keygen -R`로 지운다 */
async function removeKnownHost(ctx: Ctx, host: Resolved): Promise<boolean> {
  const run = await ctx.exec(ctx.keygen, ["-R", knownHostName(host), "-f", ctx.knownHostsPath], {
    timeoutMs: KEYGEN_TIMEOUT_MS,
  });
  return run.spawnError === null && !run.timedOut && run.code === 0;
}

// ---- 단계 ----

/** 실제 hostname, port, user, proxyjump를 `ssh -G`로 읽는다. 실패해도 연결 단계로 간다 */
async function stepResolve(ctx: Ctx, target: SshTarget): Promise<Resolved> {
  const started = begin(ctx, "resolve");
  const fallback: Resolved = {
    hostname: hostOf(target.target),
    port: target.port ?? 22,
    proxyJump: false,
  };
  const run = await ctx.exec(ctx.ssh, [...sshOptions(target.port), "-G", "--", target.target], {
    timeoutMs: RESOLVE_TIMEOUT_MS,
  });
  if (run.spawnError !== null || run.timedOut || run.code !== 0) {
    failedWith(ctx, "resolve", started, classifyFailure(run), target);
    return fallback;
  }
  const fields = parseSshG(run.stdout);
  const hostname = fields.hostname ?? hostOf(target.target);
  if (!SAFE_HOSTNAME.test(hostname)) {
    failed(ctx, "resolve", started, "fail", {
      code: "unknown",
      actions: ACTIONS.unknown,
      detail: { reason: "unsafe_hostname" },
    });
    return fallback;
  }
  const configPort = fields.port ?? 22;
  passed(ctx, "resolve", started, {
    hostname,
    port: configPort,
    proxyJump: fields.proxyJump,
    ...(fields.user === undefined ? {} : { user: fields.user }),
  });
  return { hostname, port: target.port ?? configPort, proxyJump: fields.proxyJump };
}

interface SshGFields {
  readonly hostname: string | undefined;
  readonly port: number | undefined;
  readonly user: string | undefined;
  readonly proxyJump: boolean;
}

/** ProxyJump·ProxyCommand 값이 있고 `none`이 아니면 중계 기기를 거친다 */
function usesProxy(value: string | undefined): boolean {
  return value !== undefined && value.toLowerCase() !== "none";
}

/** `ssh -G` 출력은 `키 값` 줄들이다. 같은 키가 두 번 나오면 처음 값을 쓴다 */
function parseSshG(text: string): SshGFields {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const key = line.slice(0, space).toLowerCase();
    if (!fields.has(key)) fields.set(key, line.slice(space + 1).trim());
  }
  const port = fields.get("port");
  return {
    hostname: fields.get("hostname"),
    port: port === undefined ? undefined : (portOf(port) ?? undefined),
    user: fields.get("user"),
    proxyJump: usesProxy(fields.get("proxyjump")) || usesProxy(fields.get("proxycommand")),
  };
}

async function stepConnect(
  ctx: Ctx,
  target: SshTarget,
  host: Resolved,
): Promise<Result<void, PreflightStop>> {
  const started = begin(ctx, "connect");
  const first = await connectOnce(ctx, target);
  if (isSuccess(first)) {
    passed(ctx, "connect", started);
    return ok(undefined);
  }
  const classified = classifyFailure(first);
  if (classified.code === "host_key_changed") {
    return changedKeyFlow(ctx, target, host, started);
  }
  if (classified.code === "host_key_new") {
    return newKeyFlow(ctx, target, host, started);
  }
  return err(failedWith(ctx, "connect", started, classified, target));
}

/** 처음 보는 호스트 키. 신뢰 입력이 없으면 지문을 보여 주고 `action`으로 멈춘다 */
async function newKeyFlow(
  ctx: Ctx,
  target: SshTarget,
  host: Resolved,
  started: number,
): Promise<Result<void, PreflightStop>> {
  if (host.proxyJump) {
    return err(failed(ctx, "connect", started, "fail", bodyFor("host_key_proxy", target)));
  }
  const scanned = await scanHostKeys(ctx, host);
  if (!scanned.ok) {
    return err(failed(ctx, "connect", started, "fail", bodyFor("host_key_scan_failed", target)));
  }
  const trust = ctx.input.trustHostKey;
  if (trust === undefined) {
    return err(
      failed(ctx, "connect", started, "action", {
        code: "host_key_new",
        actions: ACTIONS.host_key_new,
        detail: { hostKey: hostKeyInfo(scanned.value, host) },
      }),
    );
  }
  return trustAndRetry(ctx, target, started, scanned.value, host, trust.fingerprint);
}

/** 키가 바뀌었다. 허락이 없으면 새 지문을 보여 주고 `fail`로 멈춘다. 허락이 있으면 옛 줄을 지우고 새 줄을 더한다 */
async function changedKeyFlow(
  ctx: Ctx,
  target: SshTarget,
  host: Resolved,
  started: number,
): Promise<Result<void, PreflightStop>> {
  if (host.proxyJump) {
    return err(failed(ctx, "connect", started, "fail", { code: "host_key_changed", actions: [] }));
  }
  const trust = ctx.input.trustHostKey;
  const scanned = await scanHostKeys(ctx, host);
  if (trust === undefined || ctx.input.replaceChangedHostKey !== true) {
    if (!scanned.ok) {
      return err(
        failed(ctx, "connect", started, "fail", {
          code: "host_key_changed",
          actions: ["retry"],
        }),
      );
    }
    return err(
      failed(ctx, "connect", started, "fail", {
        code: "host_key_changed",
        actions: ACTIONS.host_key_changed,
        detail: { hostKey: hostKeyInfo(scanned.value, host) },
      }),
    );
  }
  if (!scanned.ok) {
    return err(failed(ctx, "connect", started, "fail", bodyFor("host_key_scan_failed", target)));
  }
  const removed = await removeKnownHost(ctx, host);
  if (!removed) {
    return err(
      failed(ctx, "connect", started, "fail", bodyFor("known_hosts_remove_failed", target)),
    );
  }
  return trustAndRetry(ctx, target, started, scanned.value, host, trust.fingerprint);
}

/** 사용자가 확인한 지문과 같은 줄 하나를 known_hosts에 더하고 연결을 한 번 다시 한다 */
async function trustAndRetry(
  ctx: Ctx,
  target: SshTarget,
  started: number,
  scan: Scan,
  host: Resolved,
  fingerprint: string,
): Promise<Result<void, PreflightStop>> {
  const match = scan.keys.find((key) => key.fingerprint === fingerprint);
  if (match === undefined) {
    return err(failed(ctx, "connect", started, "fail", bodyFor("host_key_mismatch_scan", target)));
  }
  const written = await appendKnownHost(ctx.knownHostsPath, match.line);
  if (!written.ok) {
    return err(
      failed(ctx, "connect", started, "fail", bodyFor("known_hosts_write_failed", target)),
    );
  }
  const again = await connectOnce(ctx, target);
  if (isSuccess(again)) {
    passed(ctx, "connect", started, { hostKey: hostKeyInfo(scan, host) });
    return ok(undefined);
  }
  const classified = classifyFailure(again);
  if (classified.code === "host_key_new" || classified.code === "host_key_changed") {
    return err(
      failed(ctx, "connect", started, "fail", {
        code: "host_key_unresolved",
        actions: ACTIONS.host_key_unresolved,
      }),
    );
  }
  return err(failedWith(ctx, "connect", started, classified, target));
}

/** 원격에서 `fresnel version --json`을 읽어 계약 버전을 비교한다. 설치되어 있지 않으면 `not_installed`다 */
async function stepInstall(
  ctx: Ctx,
  target: SshTarget,
): Promise<Result<{ readonly cli: string; readonly contract: string }, PreflightStop>> {
  const started = begin(ctx, "install");
  const run = await sshCall(ctx, target, ["fresnel", "version", "--json"], REMOTE_TIMEOUT_MS);
  if (isTransportFailure(run)) {
    return err(failedWith(ctx, "install", started, classifyFailure(run), target));
  }
  if (run.code === 127 || (run.code !== 0 && /command not found|not found/.test(run.stderr))) {
    return err(failed(ctx, "install", started, "fail", bodyFor("not_installed", target)));
  }
  const read = readJson(run.stdout, VersionOutput);
  if (!read.ok) {
    return err(failed(ctx, "install", started, "fail", bodyFor("version_unreadable", target)));
  }
  const remote = read.value;
  const local = ctx.input.local;
  if (remote.contract !== local.contract) {
    const order = compareContracts(local.contract, remote.contract);
    if (order === null) {
      return err(failed(ctx, "install", started, "fail", bodyFor("version_unreadable", target)));
    }
    if (order !== 0) {
      const lower = order < 0 ? "local" : "remote";
      return err(
        failed(ctx, "install", started, "fail", {
          code: "version_mismatch",
          actions: [lower === "local" ? "upgrade_local" : "upgrade_remote"],
          fix: { commands: [], hint: lower === "local" ? "upgrade_local" : "upgrade_remote" },
          detail: { local: local.contract, remote: remote.contract, lower },
        }),
      );
    }
  }
  passed(ctx, "install", started, remote.cli === local.cli ? undefined : { cliDiffers: true });
  return ok({ cli: remote.cli, contract: remote.contract });
}

interface ServiceFacts {
  readonly serviceVersion: string;
  /** 소켓 경로 후보. 검증은 소켓 단계가 한다 */
  readonly socketCandidate: string | undefined;
}

/** `fresnel service status --json`을 읽고, 돌고 있지 않으면 `fresnel service ensure --json`으로 띄운다 */
async function stepService(
  ctx: Ctx,
  target: SshTarget,
): Promise<Result<ServiceFacts, PreflightStop>> {
  const started = begin(ctx, "service");
  const status = await sshCall(
    ctx,
    target,
    ["fresnel", "service", "status", "--json"],
    REMOTE_TIMEOUT_MS,
  );
  if (isTransportFailure(status)) {
    return err(failedWith(ctx, "service", started, classifyFailure(status), target));
  }
  const read = readJson(status.stdout, StatusOutput);
  if (!read.ok) {
    return err(failed(ctx, "service", started, "fail", simple("service_status_unreadable")));
  }
  if (read.value.running) {
    const version = read.value.registration?.version;
    if (version === undefined) {
      return err(failed(ctx, "service", started, "fail", simple("service_status_unreadable")));
    }
    passed(ctx, "service", started);
    return ok({ serviceVersion: version, socketCandidate: read.value.registration?.socket });
  }
  const ensure = await sshCall(
    ctx,
    target,
    ["fresnel", "service", "ensure", "--json"],
    ENSURE_TIMEOUT_MS,
  );
  if (isTransportFailure(ensure)) {
    return err(failedWith(ctx, "service", started, classifyFailure(ensure), target));
  }
  const ensured = readJson(ensure.stdout, EnsureOutput);
  if (!ensured.ok) {
    return err(
      failed(ctx, "service", started, "fail", {
        code: "service_start_failed",
        actions: ACTIONS.service_start_failed,
        detail: { reason: "unreadable" },
      }),
    );
  }
  const value = ensured.value;
  if (!value.ok) {
    return err(
      failed(ctx, "service", started, "fail", {
        code: "service_start_failed",
        actions: ACTIONS.service_start_failed,
        detail: { reason: value.reason ?? "unknown" },
      }),
    );
  }
  passed(ctx, "service", started, { action: "started_service" });
  return ok({ serviceVersion: value.version, socketCandidate: value.socket });
}

function stepSocket(ctx: Ctx, candidate: string | undefined): Result<string, PreflightStop> {
  const started = begin(ctx, "socket");
  if (candidate === undefined || !isSocketPath(candidate)) {
    return err(failed(ctx, "socket", started, "fail", simple("socket_unreadable")));
  }
  passed(ctx, "socket", started, { socket: candidate });
  return ok(candidate);
}

/**
 * 사전 점검을 돌린다. 단계마다 `running`과 끝 이벤트(`pass`, `fail`, `action`)를 `onEvent`로 흘린다.
 * ssh를 부르기 전에 대상 문자열을 먼저 검사한다. 대상이 잘못되면 ssh는 한 번도 불리지 않는다.
 */
export async function runSshPreflight(
  input: SshPreflightInput,
  deps: SshPreflightDeps,
  onEvent: (event: PreflightEvent) => void,
): Promise<PreflightResult> {
  const ctx: Ctx = {
    input,
    clock: deps.clock,
    exec: deps.exec ?? spawnExec,
    ssh: deps.sshPath ?? "ssh",
    keyscan: deps.keyscanPath ?? "ssh-keyscan",
    keygen: deps.keygenPath ?? "ssh-keygen",
    knownHostsPath: deps.knownHostsPath ?? join(deps.home, ".ssh", "known_hosts"),
    onEvent,
  };
  const parsed = parseSshTarget(input.target);
  if (!parsed.ok) {
    const started = begin(ctx, "resolve");
    return failed(
      ctx,
      "resolve",
      started,
      "fail",
      simple(parsed.error.kind === "invalid_port" ? "invalid_port" : "invalid_target"),
    );
  }
  const target = parsed.value;
  const host = await stepResolve(ctx, target);
  const connected = await stepConnect(ctx, target, host);
  if (!connected.ok) return connected.error;
  const remote = await stepInstall(ctx, target);
  if (!remote.ok) return remote.error;
  const service = await stepService(ctx, target);
  if (!service.ok) return service.error;
  const socket = stepSocket(ctx, service.value.socketCandidate);
  if (!socket.ok) return socket.error;
  const port = target.port === null ? "" : `:${String(target.port)}`;
  return {
    ok: true,
    address: `ssh://${target.target}${port}${socket.value}`,
    socket: socket.value,
    remoteVersion: remote.value,
    serviceVersion: service.value.serviceVersion,
  };
}

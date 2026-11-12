// 원격 연결 명령 모듈(L4.remote.spec §3.3). ssh config 읽기, ssh 사전 점검(마지막 단계는 연결 시험), 연결 시험 한 번,
// `wss` 지문 재기와 연결 코드로 기기 페어링, 끊긴 SSH 대상의 서비스 살아 있음 읽기를 셸 명령으로 노출한다.
// 운영은 `remote-shell.ts`가 실제 의존으로 엮고, 시험은 가짜 launcher, 가짜 ssh 경로, 가짜 vault, 가짜 pair로 돌린다.
// 토큰은 응답, 로그, 오류에 넣지 않는다. 주소도 로그에 남기지 않는다.
import { assertNever, attemptAsync, parse, parseJson, repeatAsync } from "@fresnel/contracts";
import {
  checkEnvelope,
  encodeFrame,
  WIRE_ERRORS,
  WIRE_METHODS,
  WIRE_PROTOCOL_VERSION,
} from "@fresnel/contracts/wire";
import {
  readSshConfig,
  runSshPreflight,
  type pairWithGateway,
  type probeTlsFingerprint,
  type PreflightAction,
  type PreflightEvent,
  type SshPreflightDeps,
  type SshPreflightInput,
} from "@fresnel/platform-process";
import type { TokenVault } from "@fresnel/platform-secrets/vault";
import type { ShellContext, ShellModule } from "./context.ts";
import type { EngineEvents, Launcher } from "./engine/launcher.ts";
import { remoteTokenAccount } from "./engine/remote-token.ts";
import { fail } from "./engine/state.ts";
import { withTimeout, type EngineClock } from "./engine/wait.ts";
import { ownField } from "./lib/narrow.ts";

/** 연결 시험의 단계 코드. `running`은 시작 이벤트에만 쓴다 */
type TunnelCode =
  | "running"
  | "ok"
  | "tunnel_failed"
  | "hello_failed"
  | "auth_failed"
  | "protocol_mismatch"
  | "timeout";

type TunnelFailCode = Exclude<TunnelCode, "running" | "ok">;

/**
 * 연결 시험의 상세. `reason`은 `tunnel_failed`면 엔진 stderr 첫 줄의 분류(`host_key`, `socket_missing`, `refused`, `unknown`),
 * `hello_failed`면 응답 오류의 종류다. `local`과 `remote`는 프로토콜 계약 버전이다. 주소와 토큰은 싣지 않는다.
 */
interface TunnelDetail {
  readonly serverVersion?: string;
  readonly reason?: string;
  readonly local?: string;
  readonly remote?: string;
}

interface TunnelEvent {
  readonly step: "tunnel";
  readonly status: "running" | "pass" | "fail";
  readonly code: TunnelCode;
  readonly durationMs: number;
  readonly actions: readonly PreflightAction[];
  readonly detail?: TunnelDetail;
}

/** 채널로 흘러 가는 단계 이벤트. 사전 점검 단계와 연결 시험 단계가 같은 모양을 쓴다 */
type StepEvent = PreflightEvent | TunnelEvent;

type Emit = (event: StepEvent) => void;

/** 이 컴퓨터의 버전. `cli`는 사이드카 CLI 버전, `contract`는 계약 버전이다 */
export interface LocalVersion {
  readonly cli: string;
  readonly contract: string;
}

type TunnelOutcome =
  | { readonly ok: true; readonly durationMs: number; readonly serverVersion: string }
  | {
      readonly ok: false;
      readonly durationMs: number;
      readonly code: TunnelFailCode;
      readonly actions: readonly PreflightAction[];
      readonly detail?: TunnelDetail;
    };

/** 입력 상한. 문자 수이고 제어 문자는 어디서든 거절한다 */
const TARGET_MAX = 256;
const ADDRESS_MAX = 256;
const HOST_MAX = 253;
const PIN_MAX = 128;
const CODE_MAX = 64;
const DEVICE_NAME_MAX = 64;
const FINGERPRINT_MAX = 256;

/** 연결 시험의 시한. 엔진을 띄우고 hello 응답을 받기까지 기다리는 시간이다 */
const TUNNEL_TIMEOUT_MS = 15_000;
/** hello 요청 id. 응답이 이 요청에 대한 것인지 본다 */
const HELLO_ID = "r1";
const CLIENT_NAME = "fresnel-desktop-preflight";
/** 한 줄 응답의 상한. 넘으면 읽을 수 없는 응답이다 */
const LINE_CAP = 64 * 1024;
/** stderr는 첫 줄만 쓰므로 앞부분만 모은다 */
const STDERR_CAP = 4 * 1024;

const TUNNEL_ACTIONS: Readonly<Record<TunnelFailCode, readonly PreflightAction[]>> = {
  tunnel_failed: ["retry"],
  hello_failed: ["retry"],
  auth_failed: [],
  protocol_mismatch: [],
  timeout: ["retry"],
};

function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 빈 문자열, 상한 초과, 제어 문자가 있으면 `bad-request`다 */
function textOf(value: unknown, max: number): string {
  if (typeof value !== "string" || value === "" || value.length > max || hasControl(value)) {
    fail("bad-request");
  }
  return value;
}

/** 호스트 이름. 공백과 `/`를 더 막는다(주소 모양을 깨므로) */
function hostOf(value: unknown): string {
  const host = textOf(value, HOST_MAX);
  if (/[\s/]/u.test(host)) fail("bad-request");
  return host;
}

function portOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    fail("bad-request");
  }
  return value;
}

/** 호스트와 포트로 `wss` 주소를 만든다. IPv6는 대괄호로 감싼다(보안 저장소 항목 이름과 같은 모양) */
function wssAddressOf(host: string, port: number): string {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const shown = bare.includes(":") ? `[${bare}]` : bare;
  return `wss://${shown}:${String(port)}`;
}

/** 첫 비어 있지 않은 줄(앞뒤 공백 뺀 것) */
function firstLineOf(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** 엔진 stderr 첫 줄로 원인을 가른다. 맞는 것이 없으면 `unknown`이다 */
function reasonOf(stderr: string): string {
  const line = firstLineOf(stderr).toLowerCase();
  if (line.includes("host key verification failed")) return "host_key";
  if (line.includes("socket does not exist")) return "socket_missing";
  if (line.includes("refused")) return "refused";
  return "unknown";
}

/** 계약 버전 `MAJOR.MINOR.PATCH`를 비교한다. 음수면 a가 낮다. 형식이 틀리면 null */
function compareVersions(a: string, b: string): number | null {
  const left = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const right = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (left === null || right === null) return null;
  const [, la = "0", lb = "0", lc = "0"] = left;
  const [, ra = "0", rb = "0", rc = "0"] = right;
  const diff = Number(la) - Number(ra) || Number(lb) - Number(rb) || Number(lc) - Number(rc);
  return Math.sign(diff);
}

// ---- 연결 시험: 엔진 자식을 띄우고 host.hello 한 줄을 왕복한다 ----

function helloRequestOf(clientVersion: string): unknown {
  return {
    jsonrpc: "2.0",
    id: HELLO_ID,
    method: "host.hello",
    params: {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: CLIENT_NAME, version: clientVersion, kind: "desktop" },
    },
  };
}

/** 엔진 출력을 읽는 결과. 첫 줄이 오거나, 자식이 끝났거나, 이벤트 오류가 났다 */
type ReadEnd =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "exited"; readonly stderr: string }
  | { readonly kind: "error" };

/** stdout의 첫 줄과 stderr를 모은다. 자식이 끝나면 그때까지 모은 stderr와 함께 끝난다 */
function readFirstLine(events: EngineEvents): Promise<ReadEnd> {
  let stdout = "";
  let stderr = "";
  const outDecoder = new TextDecoder();
  const errDecoder = new TextDecoder();
  return repeatAsync<ReadEnd>(async () => {
    const event = await events.next();
    if (event === null) return { value: { kind: "exited", stderr } };
    switch (event.kind) {
      case "stdout": {
        stdout += outDecoder.decode(event.bytes, { stream: true });
        const newline = stdout.indexOf("\n");
        if (newline >= 0) return { value: { kind: "line", line: stdout.slice(0, newline) } };
        if (stdout.length > LINE_CAP) return { value: { kind: "line", line: stdout } };
        return undefined;
      }
      case "stderr":
        if (stderr.length < STDERR_CAP) {
          stderr = (stderr + errDecoder.decode(event.bytes, { stream: true })).slice(0, STDERR_CAP);
        }
        return undefined;
      case "terminated":
        return { value: { kind: "exited", stderr } };
      case "error":
        return { value: { kind: "error" } };
      default:
        return assertNever(event, "remote tunnel event");
    }
  });
}

/** 한 번의 연결 시험이 끝난 모양. 판정은 `outcomeOf`가 한다 */
type TunnelRaw =
  | { readonly kind: "launch_failed" }
  | { readonly kind: "timeout" }
  | { readonly kind: "ended"; readonly end: ReadEnd };

interface TunnelDeps {
  readonly launcher: Launcher;
  readonly clock: EngineClock;
  /** hello의 `client.version`. 이 컴퓨터의 CLI 버전이다 */
  readonly clientVersion: string;
}

/** 엔진 자식을 같은 길(`--remote <주소>`)로 띄워 hello를 한 번 왕복하고, 어느 경우든 자식 그룹을 끝낸다 */
async function runTunnel(deps: TunnelDeps, address: string): Promise<TunnelRaw> {
  const launched = await deps.launcher.launch({ kind: "remote", address }, "default");
  if (!launched.ok) return { kind: "launch_failed" };
  const child = launched.value;
  try {
    const frame = encodeFrame(helloRequestOf(deps.clientVersion));
    if (!frame.ok) return { kind: "ended", end: { kind: "error" } };
    // 쓰기 실패는 자식이 이미 끝났다는 뜻이다. 원인은 아래에서 읽는 stderr로 본다
    await attemptAsync(() => child.stdin.write(frame.value));
    const timed = await withTimeout(
      readFirstLine(child.events),
      TUNNEL_TIMEOUT_MS,
      deps.clock.scheduler,
    );
    if (timed.timedOut) return { kind: "timeout" };
    return { kind: "ended", end: timed.value };
  } finally {
    child.killGroup();
  }
}

/** hello 응답 한 줄을 읽은 결과 */
type HelloReply =
  | { readonly kind: "result"; readonly serverVersion: string }
  | { readonly kind: "auth_failed" }
  | { readonly kind: "protocol_mismatch"; readonly remote?: string }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "unreadable" };

/** 응답 오류 코드로 인증 거절과 프로토콜 불일치를 가른다. 나머지는 `error`다 */
function errorReplyOf(code: number, data: unknown): HelloReply {
  if (code === WIRE_ERRORS["host.authFailed"].code) return { kind: "auth_failed" };
  if (code === WIRE_ERRORS["protocol.unsupported"].code) {
    const remote = ownField(ownField(data, "details"), "serverVersion");
    return typeof remote === "string"
      ? { kind: "protocol_mismatch", remote }
      : { kind: "protocol_mismatch" };
  }
  const kind = ownField(data, "kind");
  return { kind: "error", reason: typeof kind === "string" ? kind : "unknown" };
}

function helloReplyOf(line: string): HelloReply {
  const parsed = parseJson(line);
  if (!parsed.ok) return { kind: "unreadable" };
  const checked = checkEnvelope(parsed.value);
  if (!checked.ok) return { kind: "unreadable" };
  const message = checked.message;
  if (!("id" in message) || message.id !== HELLO_ID) return { kind: "unreadable" };
  if ("result" in message) {
    const result = parse(WIRE_METHODS["host.hello"].result, message.result);
    if (!result.ok) return { kind: "unreadable" };
    return { kind: "result", serverVersion: result.value.server.version };
  }
  if ("error" in message) return errorReplyOf(message.error.code, message.error.data);
  return { kind: "unreadable" };
}

function failure(
  code: TunnelFailCode,
  durationMs: number,
  detail?: TunnelDetail,
  actions?: readonly PreflightAction[],
): TunnelOutcome {
  return {
    ok: false,
    durationMs,
    code,
    actions: actions ?? TUNNEL_ACTIONS[code],
    ...(detail === undefined ? {} : { detail }),
  };
}

/** 프로토콜이 다르면 낮은 쪽을 맞추게 한다. 어느 쪽이 낮은지 모르면 줄 것이 없다 */
function protocolActionsOf(remote: string | undefined): readonly PreflightAction[] {
  if (remote === undefined) return [];
  const order = compareVersions(WIRE_PROTOCOL_VERSION, remote);
  if (order === null || order === 0) return [];
  return [order < 0 ? "upgrade_local" : "upgrade_remote"];
}

function replyOutcome(reply: HelloReply, durationMs: number): TunnelOutcome {
  switch (reply.kind) {
    case "result":
      return { ok: true, durationMs, serverVersion: reply.serverVersion };
    case "auth_failed":
      return failure("auth_failed", durationMs);
    case "protocol_mismatch":
      return failure(
        "protocol_mismatch",
        durationMs,
        {
          local: WIRE_PROTOCOL_VERSION,
          ...(reply.remote === undefined ? {} : { remote: reply.remote }),
        },
        protocolActionsOf(reply.remote),
      );
    case "error":
      return failure("hello_failed", durationMs, { reason: reply.reason });
    case "unreadable":
      return failure("hello_failed", durationMs, { reason: "unreadable" });
    default:
      return assertNever(reply, "remote hello reply");
  }
}

function outcomeOf(raw: TunnelRaw, durationMs: number): TunnelOutcome {
  switch (raw.kind) {
    case "launch_failed":
      return failure("tunnel_failed", durationMs, { reason: "unknown" });
    case "timeout":
      return failure("timeout", durationMs);
    case "ended": {
      const end = raw.end;
      switch (end.kind) {
        case "line":
          return replyOutcome(helloReplyOf(end.line), durationMs);
        case "exited":
          return failure("tunnel_failed", durationMs, { reason: reasonOf(end.stderr) });
        case "error":
          return failure("tunnel_failed", durationMs, { reason: "unknown" });
        default:
          return assertNever(end, "remote read end");
      }
    }
    default:
      return assertNever(raw, "remote tunnel raw");
  }
}

function eventOf(outcome: TunnelOutcome): TunnelEvent {
  if (outcome.ok) {
    return {
      step: "tunnel",
      status: "pass",
      code: "ok",
      durationMs: outcome.durationMs,
      actions: [],
      detail: { serverVersion: outcome.serverVersion },
    };
  }
  return {
    step: "tunnel",
    status: "fail",
    code: outcome.code,
    durationMs: outcome.durationMs,
    actions: outcome.actions,
    ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
  };
}

/**
 * 연결 시험 단계. 시작 이벤트를 내고, 엔진을 띄워 hello를 왕복하고, 끝 이벤트를 낸다.
 * 점검일 뿐이라 엔진 대상은 바꾸지 않는다.
 */
async function runTunnelStep(
  deps: TunnelDeps,
  address: string,
  emit: Emit,
): Promise<TunnelOutcome> {
  const started = deps.clock.now();
  emit({ step: "tunnel", status: "running", code: "running", durationMs: 0, actions: [] });
  const raw = await runTunnel(deps, address);
  const outcome = outcomeOf(raw, deps.clock.now() - started);
  emit(eventOf(outcome));
  return outcome;
}

// ---- 명령 모듈 ----

/** 명령 모듈의 실제 의존. 운영은 `remote-shell.ts`가, 시험은 가짜가 채운다 */
export interface RemoteModuleDeps {
  /** 홈 디렉터리. ssh config와 known_hosts가 여기 있다 */
  readonly home: string;
  readonly clock: EngineClock;
  /** 이 ctx에서 엔진을 띄우고 한 번 돌리는 수단 */
  readonly launcherOf: (ctx: ShellContext) => Launcher;
  /** 이 ctx의 기기 토큰 보관소 */
  readonly vaultOf: (ctx: ShellContext) => TokenVault;
  /** ssh 사전 점검 의존의 덮어쓰기. 시험은 가짜 ssh 경로를 넣는다. 운영은 빈 값이다 */
  readonly ssh: Partial<SshPreflightDeps>;
  /** `pairWithGateway`의 대역 */
  readonly pair: typeof pairWithGateway;
  /** `probeTlsFingerprint`의 대역 */
  readonly probeFingerprint: typeof probeTlsFingerprint;
  /** 이 컴퓨터의 버전. 운영은 사이드카의 `version --json`을 읽는다 */
  readonly appVersion: (launcher: Launcher) => Promise<LocalVersion>;
}

function targetOf(value: unknown): string {
  return textOf(value, TARGET_MAX);
}

function trustOf(value: unknown): { readonly fingerprint: string } | undefined {
  if (value === undefined) return undefined;
  return { fingerprint: textOf(ownField(value, "fingerprint"), FINGERPRINT_MAX) };
}

export function createRemoteModule(deps: RemoteModuleDeps): ShellModule {
  return {
    name: "remote",
    register(ctx) {
      const launcher = deps.launcherOf(ctx);
      const vault = deps.vaultOf(ctx);
      const sshDeps = (): SshPreflightDeps => ({
        home: deps.home,
        clock: deps.clock,
        ...deps.ssh,
      });

      ctx.handle("ssh_hosts", async () => readSshConfig({ home: deps.home }));

      ctx.handle("ssh_preflight", async (caller, args) => {
        const target = targetOf(ownField(args, "target"));
        const trust = trustOf(ownField(args, "trustHostKey"));
        const replace = ownField(args, "replaceChangedHostKey");
        if (replace !== undefined && typeof replace !== "boolean") fail("bad-request");
        const channel = ctx.channel(caller, ownField(args, "events"));
        const emit: Emit = (event) => {
          channel?.send({ type: "step", event });
        };
        const local = await deps.appVersion(launcher);
        const input: SshPreflightInput = {
          target,
          local,
          ...(trust === undefined ? {} : { trustHostKey: trust }),
          ...(replace === true ? { replaceChangedHostKey: true } : {}),
        };
        const pre = await runSshPreflight(input, sshDeps(), (event) => {
          emit(event);
        });
        if (!pre.ok) return pre;
        const tunnel = await runTunnelStep(
          { launcher, clock: deps.clock, clientVersion: local.cli },
          pre.address,
          emit,
        );
        if (!tunnel.ok) {
          return {
            ok: false,
            step: "tunnel",
            status: "fail",
            code: tunnel.code,
            actions: tunnel.actions,
            ...(tunnel.detail === undefined ? {} : { detail: tunnel.detail }),
          };
        }
        return {
          ok: true,
          address: pre.address,
          socket: pre.socket,
          remoteVersion: pre.remoteVersion,
          serviceVersion: pre.serviceVersion,
          tunnelMs: tunnel.durationMs,
        };
      });

      ctx.handle("remote_test", async (_caller, args) => {
        const address = textOf(ownField(args, "address"), ADDRESS_MAX);
        const local = await deps.appVersion(launcher);
        const outcome = await runTunnelStep(
          { launcher, clock: deps.clock, clientVersion: local.cli },
          address,
          () => undefined,
        );
        if (outcome.ok) {
          return {
            ok: true,
            code: "ok",
            durationMs: outcome.durationMs,
            detail: { serverVersion: outcome.serverVersion },
          };
        }
        return {
          ok: false,
          code: outcome.code,
          durationMs: outcome.durationMs,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        };
      });

      ctx.handle("remote_fingerprint", async (_caller, args) => {
        const host = hostOf(ownField(args, "host"));
        const port = portOf(ownField(args, "port"));
        const probed = await deps.probeFingerprint({ host, port });
        if (!probed.ok) return { ok: false, code: probed.error.kind };
        return { ok: true, fingerprint: probed.value.fingerprint };
      });

      ctx.handle("remote_pair", async (_caller, args) => {
        const host = hostOf(ownField(args, "host"));
        const port = portOf(ownField(args, "port"));
        const pin = textOf(ownField(args, "pin"), PIN_MAX);
        const code = textOf(ownField(args, "code"), CODE_MAX);
        const deviceName = textOf(ownField(args, "deviceName"), DEVICE_NAME_MAX);
        // 계정을 먼저 정한다. 계정이 안 맞으면 연결 코드를 쓰지 않는다
        const account = remoteTokenAccount(wssAddressOf(host, port));
        if (account === null) fail("bad-request");
        const paired = await deps.pair({ host, port, pin, code, deviceName });
        if (!paired.ok) {
          const error = paired.error;
          if (error.kind === "locked") {
            return { ok: false, code: "locked", retryAfterSeconds: error.retryAfterSeconds };
          }
          return { ok: false, code: error.kind };
        }
        const stored = await vault.set(account, paired.value.token);
        if (!stored.ok) return { ok: false, code: "vault_failed" };
        return { ok: true, deviceName: paired.value.deviceName };
      });

      ctx.handle("ssh_service_alive", async (_caller, args) => {
        const target = targetOf(ownField(args, "target"));
        const local = await deps.appVersion(launcher);
        const seen: PreflightEvent[] = [];
        const pre = await runSshPreflight(
          { target, local, observeOnly: true },
          sshDeps(),
          (event) => {
            seen.push(event);
          },
        );
        if (pre.ok) return { alive: true, version: pre.serviceVersion, code: "ok" };
        const alive =
          seen.some((event) => event.step === "connect" && event.status === "pass") &&
          seen.some((event) => event.step === "service" && event.status === "pass");
        return { alive, code: pre.code };
      });
    },
  };
}

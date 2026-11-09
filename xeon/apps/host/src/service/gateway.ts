// 웹 게이트웨이 감독자(L4.remote). 서비스가 `l4.remote.web.enabled`일 때 게이트웨이(`fresnel-web`)를 자식 프로세스로 띄우고 감독한다.
// 호스트는 게이트웨이 코드를 import하지 않는다. 자식과는 표준 입력·출력의 JSON 줄로만 말한다.
// 응답에는 요청 id가 없으므로 요청은 한 번에 하나씩 보내고, 시한 안에 답이 없으면 자식을 죽인다(늦은 답이 다음 요청의 답으로 읽히지 않게).
// 자식이 죽으면 백오프 뒤 다시 띄운다. `restartWindowMs` 안에 `maxRestarts`를 넘으면 실패로 두고 더 띄우지 않는다.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptAsync,
  detach,
  err,
  ok,
  repeatAsync,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
} from "@fresnel/contracts";
import {
  bunGatewayLauncher,
  type GatewayChild,
  type GatewayExit,
  type GatewayLauncher,
} from "./gateway-launch.ts";
import { parseReady, parseReply, type DeviceReply, type ReplyEvent } from "./gateway-protocol.ts";

export interface GatewayConfig {
  /** `l4.remote.web.listen`. 예 "127.0.0.1:8480". 빈 문자열이면 게이트웨이 기본값을 쓴다 */
  readonly listen: string;
  /** `l4.remote.web.listenTls`. 빈 문자열이면 null(외부 리스너를 열지 않는다) */
  readonly listenTls: string | null;
  readonly hosts: readonly string[];
  readonly tlsCert: string | null;
  readonly tlsKey: string | null;
}

export interface RemoteStatusView {
  readonly enabled: boolean;
  readonly state: "off" | "starting" | "running" | "failed";
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly hosts: readonly string[];
  readonly fingerprint: string | null;
  readonly certSource: "self-signed" | "user" | null;
  readonly pushAvailable: boolean;
  readonly error: { readonly kind: string; readonly message: string } | null;
}

export type RemoteFailure =
  | { readonly kind: "remote-off" }
  | { readonly kind: "gateway-timeout" }
  | { readonly kind: "gateway-protocol"; readonly message: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "store-failed" };

export interface RemoteDevice {
  readonly id: string;
  readonly name: string;
  readonly kind: "web" | "desktop";
  readonly createdAt: number;
  /** 한 번도 접속하지 않았으면 null */
  readonly lastSeenAt: number | null;
  /** 주소를 모르면 null */
  readonly address: string | null;
}

export interface GatewaySupervisor {
  status(): RemoteStatusView;
  /** enabled=true로 시작한다(이미 running이나 starting이면 같은 상태). 시작 결과(ready 또는 실패)까지 기다려 status를 돌려준다 */
  start(config: GatewayConfig): Promise<RemoteStatusView>;
  /** 정상 종료(stdin stop → 시한 → SIGTERM → 시한 → SIGKILL). state는 "off" */
  stop(): Promise<RemoteStatusView>;
  pair(): Promise<Result<{ code: string; expiresAt: number }, RemoteFailure>>;
  devices(): Promise<Result<readonly RemoteDevice[], RemoteFailure>>;
  revoke(
    target: { readonly id: string } | { readonly all: true },
  ): Promise<Result<{ revoked: number }, RemoteFailure>>;
  /** 서비스 종료 때: stop과 같되 이미 off면 아무것도 안 한다 */
  dispose(): Promise<void>;
}

export interface GatewaySupervisorDeps {
  /** 서비스 소켓의 절대 경로 */
  readonly socketPath: string;
  /** 상태 폴더의 절대 경로(게이트웨이가 `<dir>/remote`에 쓴다) */
  readonly stateDir: string;
  /** 자식 기동. 기본은 `bunGatewayLauncher`(L0 spawnPiped로 띄운다) */
  readonly launch?: GatewayLauncher;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly log: Logger;
  /** 시작 뒤 첫 줄(ready)을 기다리는 시간. 기본 15000 */
  readonly readyTimeoutMs?: number;
  /** 요청 한 개의 답을 기다리는 시간. 기본 5000 */
  readonly requestTimeoutMs?: number;
  /** 정지 단계마다 기다리는 시간. 기본 3000 */
  readonly stopGraceMs?: number;
  /** `restartWindowMs` 안에 다시 띄울 수 있는 횟수. 기본 3 */
  readonly maxRestarts?: number;
  /** 재기동 횟수를 세는 창. 기본 60000 */
  readonly restartWindowMs?: number;
  /** 재기동 전 기다림(ms). 횟수마다 다음 값을 쓰고 넘치면 마지막 값을 쓴다. 기본 [500, 2000, 5000] */
  readonly backoffMs?: readonly number[];
}

type GatewayState = RemoteStatusView["state"];
type ErrorKind = "gateway-binary-missing" | "gateway-environment" | "gateway-down";

interface Policy {
  readonly readyTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly stopGraceMs: number;
  readonly maxRestarts: number;
  readonly restartWindowMs: number;
  readonly backoffMs: readonly number[];
}

interface Ports {
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly fingerprint: string | null;
}

/** 지금 살아 있는 자식 하나와 그 표준 입출력 읽기 상태 */
interface Live {
  readonly child: GatewayChild;
  readonly lines: AsyncIterator<string>;
  readonly stderr: { lastLine: string | null; errorLine: string | null };
}

interface Core {
  enabled: boolean;
  state: GatewayState;
  error: RemoteStatusView["error"];
  config: GatewayConfig | null;
  ports: Ports | null;
  live: Live | null;
  /** 재기동 횟수를 세는 시각들(창 안의 것만) */
  deaths: number[];
  driver: Promise<void> | null;
  /** 정지가 시작됐다. 감독 루프는 재기동하지 않고 끝난다 */
  stopping: boolean;
  stopped: Promise<RemoteStatusView> | null;
  /** 재기동 대기를 끊는 함수 */
  wake: (() => void) | null;
  /** start가 시작 결과를 기다리는 자리 */
  waiters: (() => void)[];
  /** 요청 직렬화의 꼬리 */
  queue: Promise<void>;
}

type GatewayCommand =
  | { readonly cmd: "pair" }
  | { readonly cmd: "devices" }
  | { readonly cmd: "revoke"; readonly id: string }
  | { readonly cmd: "revoke-all" };

type LineRead =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "closed" }
  | { readonly kind: "timeout" }
  | { readonly kind: "broken" };

type Waited<T> = { readonly timedOut: false; readonly value: T } | { readonly timedOut: true };

type Boot =
  | { readonly kind: "ready"; readonly ports: Ports }
  | { readonly kind: "exited"; readonly exit: GatewayExit };

/** 게이트웨이가 환경 문제로 끝날 때의 종료코드(`main.ts` 머리 주석) */
const ENVIRONMENT_EXIT = 2;
const DRAIN_MS = 2_000;
const MESSAGE_MAX = 300;
const DEFAULT_BACKOFF_MS: readonly number[] = [500, 2_000, 5_000];
const WILDCARD_HOSTS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);
/** 게이트웨이의 `--listen-tls` 모양과 같은 정규식(게이트웨이 코드를 import하지 않으려고 여기에 옮긴다) */
const HOST_PORT: RegExp = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/u;

function textOf(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

function bareHost(name: string): string {
  return name.startsWith("[") && name.endsWith("]") ? name.slice(1, -1) : name;
}

function normalizeConfig(config: GatewayConfig): GatewayConfig {
  return {
    listen: config.listen,
    listenTls: textOf(config.listenTls),
    hosts: config.hosts.filter((name) => name !== ""),
    tlsCert: textOf(config.tlsCert),
    tlsKey: textOf(config.tlsKey),
  };
}

/**
 * 게이트웨이에 넘기는 인자. TLS 항목(`--listen-tls`, `--hosts`, 인증서, 키)은 외부 리스너를 쓸 때만 넘긴다.
 * 인증서만 있고 외부 리스너가 없으면 무시한다(외부 리스너를 열지 않는다는 뜻이다).
 */
function gatewayArgsOf(
  paths: { readonly socketPath: string; readonly stateDir: string },
  config: GatewayConfig,
): string[] {
  const c = normalizeConfig(config);
  const args = ["--socket", paths.socketPath, "--state-dir", paths.stateDir];
  const listen = textOf(c.listen);
  if (listen !== null) args.push("--listen", listen);
  if (c.listenTls === null) return args;
  args.push("--listen-tls", c.listenTls);
  if (c.hosts.length > 0) args.push("--hosts", c.hosts.join(","));
  if (c.tlsCert !== null) args.push("--tls-cert", c.tlsCert);
  if (c.tlsKey !== null) args.push("--tls-key", c.tlsKey);
  return args;
}

/** 게이트웨이가 실제로 받는 `Host` 이름 목록: 외부 리스너 호스트(모든 주소가 아닐 때)와 `hosts`를 합쳐 중복을 뺀다 */
function effectiveHostsOf(config: GatewayConfig): readonly string[] {
  const c = normalizeConfig(config);
  if (c.listenTls === null) return [];
  const match = HOST_PORT.exec(c.listenTls);
  const bound = match === null ? null : bareHost(match[1] ?? "");
  const names: string[] = bound === null || WILDCARD_HOSTS.has(bound) ? [] : [bound];
  for (const name of c.hosts) names.push(bareHost(name));
  return [...new Set(names)];
}

function certSourceOf(
  tlsPort: number | null,
  tlsCert: string | null,
): RemoteStatusView["certSource"] {
  if (tlsPort === null) return null;
  return tlsCert === null ? "self-signed" : "user";
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.name : "non_error";
}

function failure(value: RemoteFailure): Result<never, RemoteFailure> {
  return err(value);
}

function failureOfReply(reply: ReplyEvent): RemoteFailure {
  if (reply.event !== "error")
    return { kind: "gateway-protocol", message: `unexpected reply: ${reply.event}` };
  if (reply.error === "not_found") return { kind: "not-found" };
  if (reply.error === "store_failed") return { kind: "store-failed" };
  return { kind: "gateway-protocol", message: "the gateway rejected the command" };
}

function deviceOf(device: DeviceReply): RemoteDevice {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt === 0 ? null : device.lastSeenAt,
    address: device.lastAddress === "" ? null : device.lastAddress,
  };
}

/** stderr 줄을 다 읽는다. 읽기가 실패하면 기록하고 끝낸다 */
async function drainLines(
  lines: AsyncIterable<string>,
  onLine: (line: string) => void,
): Promise<void> {
  const iterator = lines[Symbol.asyncIterator]();
  await repeatAsync<void>(async () => {
    const step = await iterator.next();
    if (step.done === true) return { value: undefined };
    onLine(step.value);
    return undefined;
  });
}

function policyOf(deps: GatewaySupervisorDeps): Policy {
  return {
    readyTimeoutMs: deps.readyTimeoutMs ?? 15_000,
    requestTimeoutMs: deps.requestTimeoutMs ?? 5_000,
    stopGraceMs: deps.stopGraceMs ?? 3_000,
    maxRestarts: deps.maxRestarts ?? 3,
    restartWindowMs: deps.restartWindowMs ?? 60_000,
    backoffMs: deps.backoffMs ?? DEFAULT_BACKOFF_MS,
  };
}

export function createGatewaySupervisor(deps: GatewaySupervisorDeps): GatewaySupervisor {
  const policy = policyOf(deps);
  const log = deps.log;
  const launch: GatewayLauncher =
    deps.launch ??
    bunGatewayLauncher({
      env: process.env,
      execPath: process.execPath,
      serviceDir: path.dirname(fileURLToPath(import.meta.url)),
      exists: existsSync,
      home: homedir(),
      scheduler: deps.scheduler,
      logger: log,
      drainMs: DRAIN_MS,
    });
  const core: Core = {
    enabled: false,
    state: "off",
    error: null,
    config: null,
    ports: null,
    live: null,
    deaths: [],
    driver: null,
    stopping: false,
    stopped: null,
    wake: null,
    waiters: [],
    queue: Promise.resolve(),
  };

  function setState(state: GatewayState): void {
    core.state = state;
    if (state === "starting") return;
    const waiting = core.waiters.splice(0);
    for (const wake of waiting) wake();
  }

  function settled(): Promise<void> {
    if (core.state !== "starting") return Promise.resolve();
    return new Promise((resolve) => {
      core.waiters.push(() => {
        resolve();
      });
    });
  }

  function fail(kind: ErrorKind, message: string): void {
    core.ports = null;
    core.error = { kind, message };
    setState("failed");
    log.error("gateway.failed", { kind });
  }

  function view(): RemoteStatusView {
    const config = core.enabled ? core.config : null;
    const tlsPort = core.ports?.tlsPort ?? null;
    return {
      enabled: core.enabled,
      state: core.state,
      loopbackPort: core.ports?.loopbackPort ?? null,
      tlsPort,
      hosts: config === null ? [] : effectiveHostsOf(config),
      fingerprint: core.ports?.fingerprint ?? null,
      certSource: certSourceOf(tlsPort, config?.tlsCert ?? null),
      pushAvailable: core.state === "running",
      error: core.error,
    };
  }

  /** 시한이 있는 기다림. 시한이 먼저 지나면 `timedOut`이다. 시간은 주입된 스케줄러가 흘린다 */
  function within<T>(work: Promise<T>, ms: number): Promise<Waited<T>> {
    const timeout = Promise.withResolvers<Waited<T>>();
    const handle = deps.scheduler.setTimeout(() => {
      timeout.resolve({ timedOut: true });
    }, ms);
    const finished = work.then((value): Waited<T> => {
      deps.scheduler.clearTimeout(handle);
      return { timedOut: false, value };
    });
    return Promise.race([finished, timeout.promise]);
  }

  /** 정지가 요청됐는지. 함수로 읽어야 앞의 검사로 좁혀진 값이 뒤 검사에 남지 않는다 */
  function isStopping(): boolean {
    return core.stopping;
  }

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle = deps.scheduler.setTimeout(() => {
        core.wake = null;
        resolve();
      }, ms);
      core.wake = () => {
        deps.scheduler.clearTimeout(handle);
        core.wake = null;
        resolve();
      };
    });
  }

  function liveOf(child: GatewayChild): Live {
    const live: Live = {
      child,
      lines: child.stdout[Symbol.asyncIterator](),
      stderr: { lastLine: null, errorLine: null },
    };
    detach(
      drainLines(child.stderr, (line) => {
        live.stderr.lastLine = line;
        if (line.startsWith("error: ")) live.stderr.errorLine = line.slice("error: ".length);
        log.info("gateway.stderr", { line });
      }),
      (cause) => {
        log.error("gateway.stderr_failed", { reason: reasonOf(cause) });
      },
    );
    return live;
  }

  async function readLine(live: Live, ms: number): Promise<LineRead> {
    const read = await within(
      attemptAsync(() => live.lines.next()),
      ms,
    );
    if (read.timedOut) return { kind: "timeout" };
    if (!read.value.ok) return { kind: "broken" };
    const step = read.value.value;
    if (step.done === true) return { kind: "closed" };
    return { kind: "line", line: step.value };
  }

  /** 자식을 정리한다: 정지 줄, 시한, SIGTERM, 시한, SIGKILL. 각 단계는 종료가 오면 바로 끝난다 */
  async function exitsWithin(live: Live, ms: number): Promise<boolean> {
    const waited = await within(live.child.exited, ms);
    return !waited.timedOut;
  }

  async function shutdownChild(live: Live): Promise<void> {
    live.child.write(JSON.stringify({ cmd: "stop" }));
    if (await exitsWithin(live, policy.stopGraceMs)) return;
    live.child.kill("SIGTERM");
    if (await exitsWithin(live, policy.stopGraceMs)) return;
    live.child.kill("SIGKILL");
    if (!(await exitsWithin(live, policy.stopGraceMs))) {
      log.error("gateway.kill_timeout", { pid: live.child.pid });
    }
  }

  /** 시작 뒤 첫 줄을 기다린다. 줄이 없거나 모양이 틀리면 자식을 죽이고 끝난 값을 돌려준다 */
  async function bootOf(live: Live): Promise<Boot> {
    const read = await readLine(live, policy.readyTimeoutMs);
    if (read.kind === "line") {
      const ready = parseReady(read.line);
      if (ready.ok) {
        return {
          kind: "ready",
          ports: {
            loopbackPort: ready.value.loopbackPort,
            tlsPort: ready.value.tlsPort,
            fingerprint: ready.value.fingerprint,
          },
        };
      }
      log.warn("gateway.bad_ready", {});
    } else if (read.kind === "closed") {
      return { kind: "exited", exit: await live.child.exited };
    } else {
      log.warn("gateway.no_ready", { reason: read.kind });
    }
    live.child.kill("SIGKILL");
    return { kind: "exited", exit: await live.child.exited };
  }

  /** 죽은 횟수를 세고, 상한을 넘었으면 실패로 두고, 아니면 백오프 뒤 다시 띄우라고 `again`을 돌려준다 */
  async function recordDeath(): Promise<"again" | "end"> {
    const now = deps.clock.now();
    core.deaths = [...core.deaths.filter((at) => at > now - policy.restartWindowMs), now];
    if (core.deaths.length > policy.maxRestarts) {
      fail(
        "gateway-down",
        "the web gateway stopped repeatedly and was not restarted; start remote access again to retry",
      );
      return "end";
    }
    core.ports = null;
    core.error = null;
    setState("starting");
    const count = core.deaths.length;
    const list = policy.backoffMs;
    const delay = list.length === 0 ? 0 : (list[Math.min(count - 1, list.length - 1)] ?? 0);
    log.info("gateway.restart_scheduled", { attempt: count, delayMs: delay });
    await pause(delay);
    return isStopping() ? "end" : "again";
  }

  /** 자식 하나의 한 생애: 기동, 첫 줄, 실행 중 감시. 재기동할 때만 `again`이다 */
  async function attemptOnce(config: GatewayConfig): Promise<"again" | "end"> {
    const launched = await launch({
      args: gatewayArgsOf({ socketPath: deps.socketPath, stateDir: deps.stateDir }, config),
    });
    if (!launched.ok) {
      if (!isStopping()) {
        fail(
          launched.error.kind === "binary-missing"
            ? "gateway-binary-missing"
            : "gateway-environment",
          launched.error.message,
        );
      }
      return "end";
    }
    const live = liveOf(launched.value);
    core.live = live;
    if (isStopping()) {
      await shutdownChild(live);
      core.live = null;
      return "end";
    }
    const boot = await bootOf(live);
    if (boot.kind === "ready") {
      if (isStopping()) {
        await live.child.exited;
        core.live = null;
        return "end";
      }
      core.ports = boot.ports;
      core.error = null;
      setState("running");
      log.info("gateway.ready", { pid: live.child.pid, tlsPort: boot.ports.tlsPort });
      const exit = await live.child.exited;
      core.live = null;
      core.ports = null;
      if (isStopping()) return "end";
      log.warn("gateway.exited", { code: exit.code, signal: exit.signal, phase: "running" });
      return recordDeath();
    }
    core.live = null;
    if (isStopping()) return "end";
    if (boot.exit.code === ENVIRONMENT_EXIT) {
      const text =
        live.stderr.errorLine ?? live.stderr.lastLine ?? "the gateway exited before it was ready";
      fail("gateway-environment", text.slice(0, MESSAGE_MAX));
      return "end";
    }
    log.warn("gateway.exited", { code: boot.exit.code, signal: boot.exit.signal, phase: "start" });
    return recordDeath();
  }

  function drive(config: GatewayConfig): Promise<void> {
    return repeatAsync<void>(async () => {
      if (isStopping()) return { value: undefined };
      const next = await attemptOnce(config);
      return next === "end" ? { value: undefined } : undefined;
    });
  }

  async function start(config: GatewayConfig): Promise<RemoteStatusView> {
    const pendingStop = core.stopped;
    if (pendingStop !== null) await pendingStop;
    if (core.state === "running") return view();
    if (core.state === "starting") {
      await settled();
      return view();
    }
    const normalized = normalizeConfig(config);
    core.enabled = true;
    core.config = normalized;
    core.deaths = [];
    core.error = null;
    core.ports = null;
    setState("starting");
    const run = drive(normalized);
    core.driver = run;
    detach(run, (cause) => {
      log.error("gateway.driver_failed", { reason: reasonOf(cause) });
      fail("gateway-down", "the web gateway supervisor stopped unexpectedly");
    });
    await settled();
    return view();
  }

  async function runStop(): Promise<RemoteStatusView> {
    core.enabled = false;
    core.stopping = true;
    const wake = core.wake;
    if (wake !== null) wake();
    const live = core.live;
    if (live !== null) await shutdownChild(live);
    const driver = core.driver;
    if (driver !== null) await driver;
    core.live = null;
    core.ports = null;
    core.error = null;
    core.deaths = [];
    core.driver = null;
    core.stopping = false;
    setState("off");
    log.info("gateway.stopped", {});
    return view();
  }

  function stop(): Promise<RemoteStatusView> {
    if (core.stopped !== null) return core.stopped;
    const done = runStop().then((result) => {
      core.stopped = null;
      return result;
    });
    core.stopped = done;
    return done;
  }

  /** 요청을 한 번에 하나씩 보낸다. 운영 상태가 아니면 `remote-off`다 */
  function gated<T>(
    work: (live: Live) => Promise<Result<T, RemoteFailure>>,
  ): Promise<Result<T, RemoteFailure>> {
    const turn = core.queue.then(() => whenRunning(work));
    core.queue = turn.then(
      () => undefined,
      (cause: unknown) => {
        log.error("gateway.request_failed", { reason: reasonOf(cause) });
      },
    );
    return turn;
  }

  function whenRunning<T>(
    work: (live: Live) => Promise<Result<T, RemoteFailure>>,
  ): Promise<Result<T, RemoteFailure>> {
    const live = core.live;
    if (core.state !== "running" || isStopping() || live === null) {
      return Promise.resolve(failure({ kind: "remote-off" }));
    }
    return work(live);
  }

  /** 명령 한 줄을 보내고 답 한 줄을 읽는다. 시한을 넘기면 자식을 죽여 감독이 다시 띄우게 한다 */
  async function exchange(
    live: Live,
    command: GatewayCommand,
  ): Promise<Result<ReplyEvent, RemoteFailure>> {
    live.child.write(JSON.stringify(command));
    const read = await readLine(live, policy.requestTimeoutMs);
    if (read.kind === "line") {
      const reply = parseReply(read.line);
      return reply.ok
        ? ok(reply.value)
        : failure({ kind: "gateway-protocol", message: reply.error });
    }
    if (read.kind === "timeout") {
      log.warn("gateway.request_timeout", { cmd: command.cmd });
      live.child.kill("SIGKILL");
      return failure({ kind: "gateway-timeout" });
    }
    if (read.kind === "closed") {
      return failure({
        kind: "gateway-protocol",
        message: "the gateway closed the control channel",
      });
    }
    return failure({ kind: "gateway-protocol", message: "the control channel could not be read" });
  }

  async function pair(): Promise<Result<{ code: string; expiresAt: number }, RemoteFailure>> {
    const reply = await gated((live) => exchange(live, { cmd: "pair" }));
    if (!reply.ok) return failure(reply.error);
    if (reply.value.event === "pairing-code") {
      // 게이트웨이는 읽기 쉬운 "ABCDE-12345"를 낸다. wire 값은 하이픈 없는 10자다(입력은 하이픈을 가리지 않는다)
      return ok({ code: reply.value.code.replaceAll("-", ""), expiresAt: reply.value.expiresAt });
    }
    return failure(failureOfReply(reply.value));
  }

  async function devices(): Promise<Result<readonly RemoteDevice[], RemoteFailure>> {
    const reply = await gated((live) => exchange(live, { cmd: "devices" }));
    if (!reply.ok) return failure(reply.error);
    if (reply.value.event === "devices") return ok(reply.value.devices.map(deviceOf));
    return failure(failureOfReply(reply.value));
  }

  async function revoke(
    target: { readonly id: string } | { readonly all: true },
  ): Promise<Result<{ revoked: number }, RemoteFailure>> {
    const command: GatewayCommand =
      "all" in target ? { cmd: "revoke-all" } : { cmd: "revoke", id: target.id };
    const reply = await gated((live) => exchange(live, command));
    if (!reply.ok) return failure(reply.error);
    if (reply.value.event === "revoked") return ok({ revoked: reply.value.count });
    return failure(failureOfReply(reply.value));
  }

  async function dispose(): Promise<void> {
    if (
      core.state === "off" &&
      core.driver === null &&
      core.live === null &&
      core.stopped === null
    ) {
      return;
    }
    await stop();
  }

  return {
    status: view,
    start,
    stop,
    pair,
    devices,
    revoke,
    dispose,
  };
}

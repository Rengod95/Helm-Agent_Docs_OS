import { networkInterfaces } from "node:os";
import { assertNever, err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import { readOsRuntime, systemClock } from "@fresnel/platform-os";

// L4.remote.spec(Tailscale 접속). 이 컴퓨터의 Tailscale을 감지하고, 게이트웨이의 루프백 포트를 `tailscale serve`로 신뢰되는 HTTPS에 내보낸다. 화면(wizard)이 부른다.
// 이 모듈의 함수는 던지지 않는다. 예상 가능한 실패는 `kind`가 있는 값으로 돌려준다.
// 외부 명령은 L0.os의 `run`으로 실행한다(DR-07). 시험은 `run`을 가짜로 바꿔 끼우고 실제 tailnet을 쓰지 않는다.

const CLI = "tailscale";
const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
/** 실행 파일을 찾지 못했거나 시작하지 못했다(셸과 같은 종료 코드) */
const NOT_FOUND = 127;
const HTTPS_PORT = 443;
const COMMAND_TIMEOUT_MS = 10_000;
/** `tailscale serve`가 HTTPS 설정을 동의하라고 내는 링크. 공백 전까지 뽑는다 */
const CONSENT_LINK = /https:\/\/login\.tailscale\.com\/\S+/u;
const HTTPS_OFF_TEXT = /not enabled/iu;

/** `run`의 결과. stderr는 끝쪽 출력이고, 없으면 빈 문자열이다 */
export interface TailscaleRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface TailscaleDeps {
  /** `process.platform` 값. darwin이면 PATH에 `tailscale`이 없을 때 앱 번들의 CLI를 한 번 더 찾는다 */
  readonly platform: string;
  run(cmd: string, args: readonly string[]): Promise<TailscaleRunResult>;
}

export type TailscaleState =
  | { readonly kind: "not_installed" }
  | { readonly kind: "not_running" }
  | { readonly kind: "needs_login"; readonly authUrl: string | null }
  | {
      readonly kind: "ready";
      readonly magicDnsName: string | null;
      readonly ips: readonly string[];
      readonly tailnetName: string | null;
      readonly httpsEnabled: boolean | null;
    }
  | { readonly kind: "unreadable"; readonly detail: string };

export type TailscaleServeFailure =
  | { readonly kind: "not_installed" }
  | { readonly kind: "not_running" }
  | { readonly kind: "needs_login"; readonly authUrl: string | null }
  | { readonly kind: "https_not_enabled"; readonly consentUrl: string | null }
  | { readonly kind: "failed"; readonly detail: string };

export type TailscaleServeFailureReason = TailscaleServeFailure["kind"];

export type ServeStatus =
  | { readonly kind: "off" }
  | { readonly kind: "on"; readonly url: string; readonly target: string }
  | { readonly kind: "other"; readonly detail: string }
  | {
      readonly kind: "unavailable";
      readonly reason: TailscaleServeFailureReason;
      readonly detail: string;
    };

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** `DNSName`의 끝 점을 떼고 소문자로 한다. 빈 값이면 없음이다 */
function magicNameOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\.$/u, "").toLowerCase();
  return name === "" ? null : name;
}

function objectOf(text: string): JsonObject | null {
  const parsed = parseJson(text);
  if (!parsed.ok) return null;
  const value = parsed.value;
  return isObject(value) ? value : null;
}

function firstLineOf(ran: TailscaleRunResult): string {
  const line = [ran.stdout, ran.stderr]
    .join("\n")
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text !== "");
  return line ?? `종료 코드 ${ran.exitCode}`;
}

function consentUrlOf(output: string): string | null {
  const match = CONSENT_LINK.exec(output);
  return match === null ? null : match[0].replace(/[.,;:)'"]+$/u, "");
}

function unreadable(detail: string): TailscaleState {
  return { kind: "unreadable", detail };
}

function readyOf(root: JsonObject): TailscaleState {
  const self = root["Self"];
  if (!isObject(self)) return unreadable("Running인데 Self가 없다");
  const tailnet = root["CurrentTailnet"];
  const certs = root["CertDomains"];
  return {
    kind: "ready",
    magicDnsName: magicNameOf(self["DNSName"]),
    ips: stringsOf(self["TailscaleIPs"]),
    tailnetName: isObject(tailnet) ? textOf(tailnet["Name"]) : null,
    httpsEnabled: Array.isArray(certs) ? certs.length > 0 : null,
  };
}

function stateOf(ran: TailscaleRunResult): TailscaleState {
  if (ran.exitCode === NOT_FOUND) return { kind: "not_installed" };
  const text = ran.stdout.trim();
  if (text === "") {
    return ran.exitCode === 0 ? unreadable("status 출력이 비었다") : { kind: "not_running" };
  }
  const root = objectOf(text);
  if (root === null) return unreadable("status 출력이 JSON 객체가 아니다");
  const backend = textOf(root["BackendState"]);
  if (backend === "Stopped" || backend === "NoState") return { kind: "not_running" };
  if (backend === "NeedsLogin") return { kind: "needs_login", authUrl: textOf(root["AuthURL"]) };
  if (backend === "Running") return readyOf(root);
  return unreadable(`BackendState를 알 수 없다: ${backend ?? "없음"}`);
}

/** PATH의 `tailscale`을 먼저 부르고, 찾지 못하면(darwin) 앱 번들의 CLI를 부른다. 둘 다 없으면 종료 코드 127이다 */
async function runCli(deps: TailscaleDeps, args: readonly string[]): Promise<TailscaleRunResult> {
  const onPath = await deps.run(CLI, args);
  if (onPath.exitCode !== NOT_FOUND || deps.platform !== "darwin") return onPath;
  return deps.run(MAC_APP_CLI, args);
}

/** `tailscale status --json`으로 이 컴퓨터의 Tailscale 상태를 읽는다 */
export async function detectTailscale(deps: TailscaleDeps): Promise<TailscaleState> {
  return stateOf(await runCli(deps, ["status", "--json"]));
}

/** 준비된 상태의 MagicDNS 이름. 준비되지 않았으면 null이다 */
export function magicDnsNameOf(state: TailscaleState): string | null {
  return state.kind === "ready" ? state.magicDnsName : null;
}

/** 게이트웨이 허용 호스트에 더할 값: MagicDNS 이름과 IP 주소. 준비되지 않았으면 빈 배열이다 */
export function tailscaleHostNames(state: TailscaleState): readonly string[] {
  if (state.kind !== "ready") return [];
  const name = magicDnsNameOf(state);
  return name === null ? [...state.ips] : [name, ...state.ips];
}

function urlOf(hostPort: string): string {
  return `https://${hostPort.replace(/:443$/u, "")}`;
}

interface ServeTarget {
  readonly hostPort: string;
  readonly path: string;
  readonly proxy: string | null;
}

function describeTarget(target: ServeTarget): string {
  return `${target.hostPort}${target.path} → ${target.proxy ?? "프록시 아님"}`;
}

/** `serve status --json` 객체를 이 포트의 상태로 옮긴다. 모양이 다르면 null이다 */
function serveStatusOf(root: JsonObject, port: number): ServeStatus | null {
  const webValue = root["Web"] ?? {};
  const tcpValue = root["TCP"] ?? {};
  if (!isObject(webValue) || !isObject(tcpValue)) return null;
  const targets: ServeTarget[] = [];
  for (const [hostPort, site] of Object.entries(webValue)) {
    if (!isObject(site)) return null;
    const handlers = site["Handlers"];
    if (!isObject(handlers)) return null;
    for (const [path, handler] of Object.entries(handlers)) {
      if (!isObject(handler)) return null;
      targets.push({ hostPort, path, proxy: textOf(handler["Proxy"]) });
    }
  }
  const ours = `http://127.0.0.1:${port}`;
  const theirs = targets.find((target) => target.proxy !== ours);
  if (theirs !== undefined) return { kind: "other", detail: describeTarget(theirs) };
  const mine = targets[0];
  if (mine !== undefined) return { kind: "on", url: urlOf(mine.hostPort), target: ours };
  const tcpPorts = Object.keys(tcpValue);
  if (tcpPorts.length > 0)
    return { kind: "other", detail: `TCP 전달이 있다: ${tcpPorts.join(", ")}` };
  return { kind: "off" };
}

function unavailableFailed(detail: string): ServeStatus {
  return { kind: "unavailable", reason: "failed", detail };
}

/** 실패한 실행을 실패 종류로 옮긴다. 동의 링크나 "not enabled" 문구가 있으면 HTTPS 꺼짐이고, 그 밖은 데몬 상태를 다시 읽어 정한다 */
async function serveFailureOf(
  deps: TailscaleDeps,
  ran: TailscaleRunResult,
): Promise<TailscaleServeFailure> {
  if (ran.exitCode === NOT_FOUND) return { kind: "not_installed" };
  const output = [ran.stdout, ran.stderr].join("\n");
  const consentUrl = consentUrlOf(output);
  if (consentUrl !== null || HTTPS_OFF_TEXT.test(output)) {
    return { kind: "https_not_enabled", consentUrl };
  }
  const state = await detectTailscale(deps);
  switch (state.kind) {
    case "not_installed":
      return { kind: "not_installed" };
    case "not_running":
      return { kind: "not_running" };
    case "needs_login":
      return { kind: "needs_login", authUrl: state.authUrl };
    case "ready":
    case "unreadable":
      return { kind: "failed", detail: firstLineOf(ran) };
    default:
      return assertNever(state, "TailscaleState");
  }
}

/** 상태 읽기의 실패 종류를 내보내기 실패 값으로 옮긴다(동의 링크와 인증 주소는 상태 읽기에 없으므로 null이다) */
function failureOfReason(
  reason: TailscaleServeFailureReason,
  detail: string,
): TailscaleServeFailure {
  switch (reason) {
    case "not_installed":
      return { kind: "not_installed" };
    case "not_running":
      return { kind: "not_running" };
    case "needs_login":
      return { kind: "needs_login", authUrl: null };
    case "https_not_enabled":
      return { kind: "https_not_enabled", consentUrl: null };
    case "failed":
      return { kind: "failed", detail };
    default:
      return assertNever(reason, "TailscaleServeFailureReason");
  }
}

/** 이 포트가 `tailscale serve`로 내보내지는지 읽는다(`serve status --json`) */
export async function tailscaleServeStatus(
  deps: TailscaleDeps,
  port: number,
): Promise<ServeStatus> {
  const ran = await runCli(deps, ["serve", "status", "--json"]);
  if (ran.exitCode !== 0) {
    const failure = await serveFailureOf(deps, ran);
    return { kind: "unavailable", reason: failure.kind, detail: firstLineOf(ran) };
  }
  const root = objectOf(ran.stdout.trim());
  if (root === null) return unavailableFailed("serve status 출력이 JSON 객체가 아니다");
  return serveStatusOf(root, port) ?? unavailableFailed("serve status 모양이 다르다");
}

/**
 * 이 포트를 `tailscale serve --bg --https=443`으로 신뢰되는 HTTPS에 내보내고, 주소를 돌려준다.
 * 사용자의 확인은 호출하는 쪽(화면)이 받았다고 본다.
 */
export async function enableTailscaleServe(
  deps: TailscaleDeps,
  port: number,
): Promise<Result<{ readonly url: string }, TailscaleServeFailure>> {
  const ran = await runCli(deps, [
    "serve",
    "--bg",
    `--https=${HTTPS_PORT}`,
    `http://127.0.0.1:${port}`,
  ]);
  if (ran.exitCode !== 0) return err(await serveFailureOf(deps, ran));
  const status = await tailscaleServeStatus(deps, port);
  switch (status.kind) {
    case "on":
      return ok({ url: status.url });
    case "off":
      return err({ kind: "failed", detail: "serve 설정이 적용되지 않았다" });
    case "other":
      return err({ kind: "failed", detail: `다른 대상을 내보내는 중이다: ${status.detail}` });
    case "unavailable":
      return err(failureOfReason(status.reason, status.detail));
    default:
      return assertNever(status, "ServeStatus");
  }
}

/**
 * 이 포트의 내보내기를 끈다(`tailscale serve --https=443 off`). 이미 꺼져 있으면 성공이다.
 * 다른 대상을 내보내는 중이면 그 설정을 지우지 않도록 끄지 않고 실패로 돌려준다.
 */
export async function disableTailscaleServe(
  deps: TailscaleDeps,
  port: number,
): Promise<Result<null, TailscaleServeFailure>> {
  const before = await tailscaleServeStatus(deps, port);
  if (before.kind === "off") return ok(null);
  if (before.kind === "other") {
    return err({
      kind: "failed",
      detail: `다른 대상을 내보내는 중이라 끄지 않았다: ${before.detail}`,
    });
  }
  if (before.kind === "unavailable") return err(failureOfReason(before.reason, before.detail));
  const ran = await runCli(deps, ["serve", `--https=${HTTPS_PORT}`, "off"]);
  return ran.exitCode === 0 ? ok(null) : err(await serveFailureOf(deps, ran));
}

/** 운영 환경의 deps. 실행은 L0.os의 `run`으로 하고, 출력의 stderr도 받는다 */
export function systemTailscaleDeps(): TailscaleDeps {
  const runtime = readOsRuntime();
  return {
    platform: process.platform,
    async run(cmd, args) {
      const ran = await runtime.run([cmd, ...args], {
        signal: new AbortController().signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        captureStderr: true,
      });
      if (!ran.ok) return { exitCode: exitCodeOfFailure(ran.error.kind), stdout: "", stderr: "" };
      return {
        exitCode: ran.value.exitCode,
        stdout: ran.value.stdout,
        stderr: ran.value.stderr ?? "",
      };
    },
  };
}

/** 실행하지 못한 명령의 종료 코드. 셸과 같다: 시한 124, 찾지 못함 127, 중단 130 */
function exitCodeOfFailure(kind: "spawn_failed" | "timeout" | "cancelled"): number {
  switch (kind) {
    case "timeout":
      return 124;
    case "spawn_failed":
      return NOT_FOUND;
    case "cancelled":
      return 130;
    default:
      return assertNever(kind, "TailscaleRunFailure");
  }
}

/** 한 네트워크 주소 항목의 모양. `os.networkInterfaces()`의 항목이 이 모양을 만족한다 */
export interface NetworkEntry {
  readonly family: string;
  readonly address: string;
  readonly netmask: string;
  readonly internal: boolean;
}

export type NetworkInterfaceMap = Readonly<Record<string, readonly NetworkEntry[] | undefined>>;

/**
 * 네트워크 주소 목록의 지문. 항목을 정렬해 JSON으로 만들므로 같은 주소 집합이면 같은 값이고,
 * 주소가 바뀌었는지만 본다. 인터페이스 목록은 시험이 넘길 수 있다.
 */
export function networkFingerprint(interfaces: NetworkInterfaceMap = networkInterfaces()): string {
  const rows = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? []).map((entry) =>
      JSON.stringify([name, entry.family, entry.address, entry.netmask, entry.internal]),
    ),
  );
  return JSON.stringify(rows.toSorted());
}

export interface TailscaleHostNames {
  /** 마지막으로 읽은 허용 호스트 이름. 아직 읽지 않았으면 빈 배열이다 */
  current(): readonly string[];
  /**
   * 허용 호스트 이름을 다시 읽는다. 네트워크 지문이 바뀌었거나 마지막 읽기에서 `intervalMs`가 지났을 때만 `tailscale`을 부른다.
   * 읽는 중에 또 부르면 그 읽기를 기다린 뒤 다시 판단한다.
   */
  refresh(): Promise<void>;
}

export interface TailscaleHostNamesEnv {
  readonly clock: Clock;
  readonly interfaces: () => NetworkInterfaceMap;
}

function systemHostNamesEnv(): TailscaleHostNamesEnv {
  return { clock: systemClock(), interfaces: () => networkInterfaces() };
}

/** 허용 호스트 이름을 캐시한다. 운영은 `systemHostNamesEnv`(시계와 실제 인터페이스 목록)를 쓴다 */
export function createTailscaleHostNames(
  deps: TailscaleDeps,
  intervalMs: number,
  env: TailscaleHostNamesEnv = systemHostNamesEnv(),
): TailscaleHostNames {
  let names: readonly string[] = [];
  let readAt: number | null = null;
  let readPrint = "";
  let inFlight: Promise<void> | null = null;

  async function read(print: string): Promise<void> {
    const state = await detectTailscale(deps);
    names = tailscaleHostNames(state);
    readAt = env.clock.now();
    readPrint = print;
  }

  return {
    current: () => names,
    async refresh(): Promise<void> {
      if (inFlight !== null) await inFlight;
      const print = networkFingerprint(env.interfaces());
      const fresh = readAt !== null && print === readPrint && env.clock.now() - readAt < intervalMs;
      if (fresh) return;
      const work = read(print);
      inFlight = work;
      try {
        await work;
      } finally {
        inFlight = null;
      }
    },
  };
}

import {
  addTarget,
  parseTargetAddress,
  pinAddress,
  pinOfAddress,
  PREFLIGHT_STEPS,
  preflightCauseKey,
  preflightFixKey,
  preflightHintKey,
  preflightStepKey,
  type TargetEntry,
} from "@fresnel/client";
import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { EngineState } from "../../../state/engine/index.ts";
import type { SshHostsReply } from "../../../transport/ipc.ts";
import type { CheckState } from "../shared/check-steps.tsx";
import { sameChoice, type ConnectionState, type TargetChoice } from "./connection-model.ts";
import {
  hostKeyPromptOf,
  pickedSshFields,
  PROBE_IDLE,
  preflightTargetOf,
  probeReducer,
  stopLineOf,
  type HostKeyPrompt,
  type ProbeAction,
  type ProbeState,
  type StepLine,
} from "./connection-probe-model.ts";
import { composeFields, fieldsOfAddress } from "./host-address.ts";

// "다른 컴퓨터에 연결" 구역과 "컴퓨터 추가" wizard의 순수 모델(DOM 없음, 시안 `_notes/design/dz/dzRW-design.md` §5).
// wizard는 방식 → 점검 → 저장 세 단계다. 점검을 통과하기 전에는 저장할 주소가 없다(`ready`가 null). 명령은 화면 부품이 부르고
// 결과만 `addReducer`로 넘긴다. 사전 점검 단계 줄은 `connection-probe-model.ts`의 `ProbeState`를 그대로 쓰고, 여기서는 그것을
// 점검 줄(`CheckSteps`)의 값과 멈춘 자리의 안내(호스트 키, 비밀번호만, Fresnel 없음, 버전 다름)로 바꾼다.

/** 번역 키와 인자. 그림이 `t()`로 문장을 만든다 */
export interface Msg {
  readonly key: MessageId;
  readonly args?: MessageArgs;
}

// ── 저장한 컴퓨터 카드 ─────────────────────────────────────────────────

/** 카드 둘째 줄의 주소 요약. ssh는 `user@host[:port]`, 웹은 `host:port`(확인 값 고정 부분은 뺀다), 그 밖은 경로나 포트다 */
export function addressSummaryOf(address: string): string {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok) return address;
  const target = parsed.target;
  switch (target.kind) {
    case "ssh": {
      const who = target.user === null ? "" : `${target.user}@`;
      const where = target.port === null ? "" : `:${String(target.port)}`;
      return `${who}${target.host}${where}`;
    }
    case "wss":
      return `${target.host.includes(":") ? `[${target.host}]` : target.host}:${String(target.port)}`;
    case "unix":
      return target.path;
    case "tcp":
      return `127.0.0.1:${String(target.port)}`;
    default:
      return assertNever(target, "TargetAddress");
  }
}

const KIND_BADGE: Readonly<Record<"ssh" | "wss" | "unix" | "tcp", MessageId>> = {
  ssh: "desktop.connection.computers.badge.ssh",
  wss: "desktop.connection.computers.badge.web",
  unix: "desktop.connection.computers.badge.local",
  tcp: "desktop.connection.computers.badge.local",
};

/** 카드 첫 줄 끝의 방식 배지. 풀리지 않는 주소는 배지가 없다 */
export function kindBadgeOf(address: string): MessageId | null {
  const parsed = parseTargetAddress(address);
  return parsed.ok ? KIND_BADGE[parsed.target.kind] : null;
}

/** 카드 상태 줄(점 8 + 12 글). 점 색은 tone, 글은 secondary다 */
export interface CardStatus {
  readonly tone: "success" | "neutral" | "warning" | "danger";
  readonly key: MessageId;
}

function transitional(engine: EngineState | null): boolean {
  return (
    engine?.kind === "starting" || engine?.kind === "restarting" || engine?.kind === "stopping"
  );
}

/**
 * 카드의 상태. 연결 중인 대상은 "연결 중", 실패한 대상은 "연결하지 못했어요". 지금 붙은 컴퓨터는 엔진이 바뀌는 중이면 "연결 중",
 * 상태를 읽었으면 "지금 쓰는 중", 읽지 못했으면 "연결이 끊겼어요"다. 그 밖의 카드는 상태 줄이 없다(null).
 */
export function cardStatusOf(
  state: ConnectionState,
  engine: EngineState | null,
  choice: TargetChoice,
): CardStatus | null {
  if (state.pending !== null && sameChoice(state.pending.target, choice)) {
    return { tone: "neutral", key: "desktop.connection.computers.connecting" };
  }
  if (state.failure !== null && sameChoice(state.failure.target, choice)) {
    return { tone: "danger", key: "desktop.connection.computers.failed" };
  }
  if (!sameChoice(state.engineTarget, choice)) return null;
  if (state.pending !== null || transitional(engine)) {
    return { tone: "neutral", key: "desktop.connection.computers.connecting" };
  }
  if (state.status.kind === "ready") {
    return { tone: "success", key: "desktop.connection.computers.current" };
  }
  if (state.status.kind === "loading") return null;
  return { tone: "warning", key: "desktop.connection.computers.offline" };
}

// ── 점검 줄 ───────────────────────────────────────────────────────────

/** 점검 줄 한 줄의 값. 그림이 문장으로 바꿔 `CheckStep`을 만든다 */
export interface CheckRow {
  readonly id: string;
  readonly label: Msg;
  readonly state: CheckState;
  readonly detail: Msg | null;
  readonly fix: Msg | null;
  readonly elapsedMs: number | null;
}

/** 멈춘 자리에서 점검 줄 대신 따로 그리는 원인. 이 코드들은 줄 아래 안내가 고치는 법을 맡는다 */
const OWN_NOTICE_CODES: ReadonlySet<string> = new Set([
  "host_key_new",
  "host_key_changed",
  "auth_password_only",
  "not_installed",
  "version_mismatch",
]);

function checkStateOf(line: StepLine): CheckState {
  switch (line.status) {
    case "running":
      return "running";
    case "pass":
      return "passed";
    case "fail":
      return "failed";
    case "action":
      return "attention";
    default:
      return assertNever(line.status, "StepLine status");
  }
}

function passDetailOf(line: StepLine): Msg | null {
  if (line.step === "service" && line.detail?.action === "started_service") {
    return { key: "desktop.connection.add.serviceStarted" };
  }
  return null;
}

function failFixOf(line: StepLine): Msg | null {
  if (OWN_NOTICE_CODES.has(line.code)) return null;
  const hint = line.fix?.hint === undefined ? null : preflightHintKey(line.fix.hint);
  return hint === null ? { key: preflightFixKey(line.code) } : { key: hint };
}

function failDetailOf(line: StepLine): Msg {
  if (line.code === "version_mismatch") return { key: "desktop.connection.add.version.cause" };
  if (line.code === "host_key_new") return { key: "desktop.connection.add.hostKey.newCause" };
  if (line.code === "host_key_changed")
    return { key: "desktop.connection.add.hostKey.changedCause" };
  return { key: preflightCauseKey(line.code) };
}

/**
 * 사전 점검(SSH)의 여섯 단계 줄. 받은 단계는 그 상태, 받지 못한 단계는 시험 중이면 기다림(첫 것은 도는 중)이고, 멈췄거나 셸 명령이 실패했으면
 * 건너뜀이다. 주소 시험(웹, 로컬)은 한 줄이다. 시험 전이면 빈 목록이다.
 */
export function checkRowsOf(probe: ProbeState): readonly CheckRow[] {
  if (probe.tested !== null) {
    const tested = probe.tested;
    return [
      {
        id: "test",
        label: { key: "desktop.connection.computers.test" },
        state: tested.ok ? "passed" : "failed",
        detail: tested.ok
          ? { key: "desktop.connection.computers.tested" }
          : { key: preflightCauseKey(tested.code) },
        fix: tested.ok ? null : { key: preflightFixKey(tested.code) },
        elapsedMs: tested.durationMs,
      },
    ];
  }
  if (probe.steps.length === 0 && !probe.busy && !probe.failed) return [];
  const stopped = !probe.busy;
  // 시험 중에는 아직 받지 못한 첫 단계를 도는 중으로 본다(셸은 단계를 끝낼 때 이벤트를 보낸다)
  const next = probe.busy
    ? PREFLIGHT_STEPS.find((step) => !probe.steps.some((item) => item.step === step))
    : undefined;
  const anyRunning = probe.steps.some((item) => item.status === "running");
  return PREFLIGHT_STEPS.map((step): CheckRow => {
    const line = probe.steps.find((item) => item.step === step);
    const label: Msg = { key: preflightStepKey(step) };
    if (line === undefined) {
      const waitState: CheckState = step === next && !anyRunning ? "running" : "waiting";
      return {
        id: step,
        label,
        state: stopped ? "skipped" : waitState,
        detail: null,
        fix: null,
        elapsedMs: null,
      };
    }
    const state = checkStateOf(line);
    return {
      id: step,
      label,
      state,
      detail:
        state === "failed" || state === "attention"
          ? failDetailOf(line)
          : state === "passed"
            ? passDetailOf(line)
            : null,
      fix: state === "failed" || state === "attention" ? failFixOf(line) : null,
      elapsedMs: line.durationMs > 0 ? line.durationMs : null,
    };
  });
}

/** 멈춘 자리의 안내. 점검 줄 아래, 진행 패널 안에 그린다(대화 상자를 새로 띄우지 않는다) */
export type ProbeNotice =
  | { readonly kind: "hostKey"; readonly prompt: HostKeyPrompt }
  | { readonly kind: "passwordOnly"; readonly commands: readonly string[] }
  | { readonly kind: "notInstalled" }
  | {
      readonly kind: "version";
      readonly local: string;
      readonly remote: string;
      readonly lower: "local" | "remote";
    }
  | { readonly kind: "commands"; readonly commands: readonly string[] }
  | { readonly kind: "requestFailed" };

/** 멈춘 줄의 안내. 시험 중이거나 멈춘 줄이 없으면 null이다 */
export function probeNoticeOf(probe: ProbeState): ProbeNotice | null {
  if (probe.busy) return null;
  if (probe.failed) return { kind: "requestFailed" };
  const line = stopLineOf(probe.steps);
  if (line === null) return null;
  const prompt = hostKeyPromptOf(line);
  if (prompt !== null) return { kind: "hostKey", prompt };
  const commands = line.fix?.commands ?? [];
  if (line.code === "auth_password_only") return { kind: "passwordOnly", commands };
  if (line.code === "not_installed") return { kind: "notInstalled" };
  if (line.code === "version_mismatch") {
    const detail = line.detail;
    return {
      kind: "version",
      local: detail?.local ?? "?",
      remote: detail?.remote ?? "?",
      lower: detail?.lower ?? "remote",
    };
  }
  return commands.length > 0 ? { kind: "commands", commands } : null;
}

// ── wizard 입력 ───────────────────────────────────────────────────────

export type AddMethod = "ssh" | "web";
export type AddStep = "method" | "check" | "save";
export const ADD_STEPS: readonly AddStep[] = ["method", "check", "save"];

/** 고른 방식 글을 방식으로 바꾼다. 모르는 글이면 undefined다 */
export function addMethodOf(text: string): AddMethod | undefined {
  return text === "ssh" || text === "web" ? text : undefined;
}

/** 직접 입력한 SSH 대상을 푼 값. `target`은 사전 점검에 넘기는 `[user@]host[:port]`, `label`은 제안 이름이다 */
export type SshInput =
  | { readonly ok: true; readonly target: string; readonly label: string }
  | { readonly ok: false };

const HOST_TEXT = /^[A-Za-z0-9._-]+$|^\[[0-9A-Fa-f:.]+\]$/;
const USER_TEXT = /^[A-Za-z0-9._-]+$/;

function portOf(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

/**
 * 직접 입력 한 칸을 푼다. `user@host`, `user@host:2222`, `ssh://user@host:2222`, 터미널 꼴 `ssh user@host -p 2222`와
 * `-p 2222 user@host`를 받는다. 호스트는 이름이나 IP(IPv6는 대괄호)다. 비었거나 맞지 않으면 `ok: false`다.
 */
export function parseSshInput(text: string): SshInput {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words[0] === "ssh") words.shift();
  let port: number | null = null;
  const rest: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "-p") {
      const next = portOf(words[index + 1] ?? "");
      if (next === null || port !== null) return { ok: false };
      port = next;
      index += 1;
    } else if (/^-p\d+$/.test(word)) {
      const next = portOf(word.slice(2));
      if (next === null || port !== null) return { ok: false };
      port = next;
    } else {
      rest.push(word);
    }
  }
  if (rest.length !== 1) return { ok: false };
  const spec = (rest[0] ?? "").replace(/^ssh:\/\//i, "").replace(/\/$/, "");
  const at = spec.lastIndexOf("@");
  const user = at < 0 ? "" : spec.slice(0, at);
  let host = at < 0 ? spec : spec.slice(at + 1);
  // `host:2222`와 `[::1]:2222`만 포트로 본다(대괄호 없는 IPv6는 받지 않는다)
  const portMatch = /^(\[[^\]]+\]|[^:[\]]+):(\d+)$/.exec(host);
  if (portMatch !== null) {
    const inline = portOf(portMatch[2] ?? "");
    if (inline === null || port !== null) return { ok: false };
    port = inline;
    host = portMatch[1] ?? "";
  }
  if (!HOST_TEXT.test(host) || (user !== "" && !USER_TEXT.test(user))) return { ok: false };
  const target = preflightTargetOf({ user, host, port: port === null ? "" : String(port) });
  if (target === null) return { ok: false };
  return { ok: true, target, label: host.replace(/^\[|\]$/g, "") };
}

/** ssh 설정에서 고른 호스트의 점검 대상. 별칭을 넘기면 사전 점검이 `ssh -G`로 실제 호스트와 포트를 읽는다 */
export function pickedTargetOf(host: SshHostsReply["hosts"][number]): string | null {
  return preflightTargetOf(pickedSshFields(host, { user: "", host: "", port: "", socket: "" }));
}

/** 고급의 서비스 주소 칸이 맞는가. 비었으면(점검이 찾는다) 또는 `/`로 시작하는 경로면 맞다 */
export function socketTextOk(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "" || (trimmed.startsWith("/") && !/\s/.test(trimmed));
}

/** 사전 점검이 준 주소에 고급 칸의 서비스 주소를 넣는다. 칸이 비었으면 점검이 찾은 주소 그대로다 */
export function sshSavedAddressOf(preflightAddress: string, socket: string): string {
  const trimmed = socket.trim();
  if (trimmed === "") return preflightAddress;
  const parsed = fieldsOfAddress(preflightAddress);
  if (!parsed.ok || parsed.fields.kind !== "ssh") return preflightAddress;
  return composeFields({ ...parsed.fields, socket: trimmed });
}

/** 웹 주소 칸을 푼 값. `base`는 저장 주소의 바탕(`wss://host:port`)이다 */
export interface WebEndpoint {
  readonly host: string;
  readonly port: number;
  readonly base: string;
}

/** 웹 주소 칸을 푼다. `https://`·`wss://`는 떼고, 포트가 없으면 8443이다. 맞지 않으면 null이다 */
export function webEndpointOf(text: string): WebEndpoint | null {
  if (text.trim() === "") return null;
  const base = composeFields({ kind: "wss", address: text, pin: "" });
  const parsed = parseTargetAddress(base);
  if (!parsed.ok || parsed.target.kind !== "wss") return null;
  return { host: parsed.target.host, port: parsed.target.port, base };
}

/** 확인 값을 웹 주소에 고정한다. 고정한 주소와 쌍 맺기에 보낼 확인 값(16진수 64자)이다. 형식이 틀리면 null이다 */
export function pinnedOf(
  endpoint: WebEndpoint,
  fingerprint: string,
): { readonly address: string; readonly pin: string } | null {
  const pinned = pinAddress(endpoint.base, fingerprint);
  if (!pinned.ok) return null;
  const pin = pinOfAddress(pinned.address);
  return pin === null ? null : { address: pinned.address, pin };
}

/** 연결 코드 길이(Crockford 10자, 5-5) */
const PAIR_CODE_LENGTH = 10;

/** 연결 코드 칸의 모양: 글자·숫자만 남겨 대문자로, 10자까지, 5자 뒤 하이픈. 붙여 넣은 `abcde 12345`도 같은 모양이 된다 */
export function formatPairCode(text: string): string {
  const bare = text
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, PAIR_CODE_LENGTH);
  return bare.length > 5 ? `${bare.slice(0, 5)}-${bare.slice(5)}` : bare;
}

/** 코드 10자가 다 찼는가 */
export function pairCodeReady(code: string): boolean {
  return code.replace(/-/g, "").length === PAIR_CODE_LENGTH;
}

/** 저장 단계의 이름·주소 검사. 이름이 비었거나 같은 주소가 이미 있으면 그 문장 키, 맞으면 null이다 */
export function saveProblemOf(
  items: readonly TargetEntry[],
  label: string,
  address: string,
): MessageId | null {
  if (label.trim() === "") return "desktop.connection.add.save.empty";
  const added = addTarget(items, { id: "\u0000check", label: label.trim(), address });
  if (added.ok) return null;
  return added.reason === "duplicate"
    ? "desktop.connection.add.save.duplicate"
    : "desktop.connection.add.save.failed";
}

// ── wizard 상태 ───────────────────────────────────────────────────────

export interface SshDraft {
  /** ssh 설정 목록에서 고른 별칭. 직접 입력하면 지운다 */
  readonly picked: string | null;
  /** 직접 입력 칸. 목록에서 고르면 비운다 */
  readonly typed: string;
  /** 고급의 서비스 주소 칸(선택) */
  readonly socket: string;
}

type FingerprintRead =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly fingerprint: string }
  | { readonly kind: "failed"; readonly key: MessageId };

type PairRead =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly key: MessageId; readonly seconds?: number };

/** 점검을 통과한 결과. 저장 단계가 쓴다 */
interface ReadyInfo {
  readonly address: string;
  readonly suggested: string;
  /** 그 컴퓨터의 Fresnel 버전(SSH 점검만) */
  readonly version: string | null;
  /** 연결 시험에 걸린 시간(SSH 점검만) */
  readonly ms: number | null;
}

type SaveRead =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly key: MessageId };

export interface AddState {
  readonly step: AddStep;
  readonly method: AddMethod;
  readonly ssh: SshDraft;
  /** 웹 주소 칸 */
  readonly web: string;
  readonly probe: ProbeState;
  readonly fingerprint: FingerprintRead;
  /** 연결 코드 칸(`formatPairCode` 모양) */
  readonly code: string;
  readonly pair: PairRead;
  readonly ready: ReadyInfo | null;
  readonly label: string;
  readonly save: SaveRead;
}

export function initialAddState(method: AddMethod): AddState {
  return {
    step: "method",
    method,
    ssh: { picked: null, typed: "", socket: "" },
    web: "",
    probe: PROBE_IDLE,
    fingerprint: { kind: "idle" },
    code: "",
    pair: { kind: "idle" },
    ready: null,
    label: "",
    save: { kind: "idle" },
  };
}

export type AddAction =
  | { readonly type: "method"; readonly method: AddMethod }
  | { readonly type: "pick"; readonly name: string }
  | { readonly type: "typed"; readonly text: string }
  | { readonly type: "socket"; readonly text: string }
  | { readonly type: "web"; readonly text: string }
  /** 점검 단계로 간다(SSH 점검 시작 또는 웹 확인 값 재기 시작) */
  | { readonly type: "start" }
  | { readonly type: "probe"; readonly action: ProbeAction }
  | { readonly type: "fingerprint"; readonly read: FingerprintRead }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "pair"; readonly read: PairRead }
  /** 점검을 통과했다. 저장 단계로 가고 이름 칸에 제안 이름을 넣는다 */
  | { readonly type: "passed"; readonly ready: ReadyInfo }
  | { readonly type: "back" }
  | { readonly type: "label"; readonly text: string }
  | { readonly type: "save"; readonly read: SaveRead };

export function addReducer(state: AddState, action: AddAction): AddState {
  switch (action.type) {
    case "method":
      return { ...state, method: action.method };
    case "pick":
      return { ...state, ssh: { ...state.ssh, picked: action.name, typed: "" } };
    case "typed":
      return {
        ...state,
        ssh: {
          ...state.ssh,
          typed: action.text,
          picked: action.text === "" ? state.ssh.picked : null,
        },
      };
    case "socket":
      return { ...state, ssh: { ...state.ssh, socket: action.text } };
    case "web":
      return { ...state, web: action.text };
    case "start":
      return {
        ...state,
        step: "check",
        probe: state.method === "ssh" ? probeReducer(PROBE_IDLE, { type: "begin" }) : PROBE_IDLE,
        fingerprint: state.method === "web" ? { kind: "reading" } : { kind: "idle" },
        code: "",
        pair: { kind: "idle" },
        ready: null,
      };
    case "probe":
      return { ...state, probe: probeReducer(state.probe, action.action) };
    case "fingerprint":
      return { ...state, fingerprint: action.read };
    case "code":
      return {
        ...state,
        code: formatPairCode(action.text),
        pair: state.pair.kind === "failed" ? { kind: "idle" } : state.pair,
      };
    case "pair":
      return { ...state, pair: action.read, code: action.read.kind === "failed" ? "" : state.code };
    case "passed":
      return {
        ...state,
        step: "save",
        ready: action.ready,
        label: action.ready.suggested,
        save: { kind: "idle" },
      };
    case "back":
      return {
        ...state,
        step: "method",
        probe: PROBE_IDLE,
        fingerprint: { kind: "idle" },
        pair: { kind: "idle" },
        code: "",
        ready: null,
      };
    case "label":
      return {
        ...state,
        label: action.text,
        save: state.save.kind === "failed" ? { kind: "idle" } : state.save,
      };
    case "save":
      return { ...state, save: action.read };
    default:
      return assertNever(action, "AddAction");
  }
}

/** 방식 단계에서 점검으로 넘어갈 SSH 대상. 직접 입력이 있으면 그것, 없으면 고른 별칭이다. 맞지 않으면 null이다 */
export function sshTargetOfDraft(
  draft: SshDraft,
  hosts: readonly SshHostsReply["hosts"][number][],
): { readonly target: string; readonly label: string } | null {
  if (draft.typed.trim() !== "") {
    const parsed = parseSshInput(draft.typed);
    return parsed.ok ? { target: parsed.target, label: parsed.label } : null;
  }
  if (draft.picked === null) return null;
  const host = hosts.find((item) => item.name === draft.picked);
  if (host === undefined) return null;
  const target = pickedTargetOf(host);
  return target === null ? null : { target, label: host.name };
}

/** 방식 단계의 [점검 시작]·[다음]을 누를 수 있는가 */
export function canStart(
  state: AddState,
  hosts: readonly SshHostsReply["hosts"][number][],
): boolean {
  if (state.method === "web") return webEndpointOf(state.web) !== null;
  return sshTargetOfDraft(state.ssh, hosts) !== null && socketTextOk(state.ssh.socket);
}

/** 웹 점검 단계의 [연결]을 누를 수 있는가: 확인 값을 읽었고, 코드 10자가 찼고, 쌍 맺기가 가고 있지 않다 */
export function canPair(state: AddState): boolean {
  return (
    state.fingerprint.kind === "read" && pairCodeReady(state.code) && state.pair.kind !== "busy"
  );
}

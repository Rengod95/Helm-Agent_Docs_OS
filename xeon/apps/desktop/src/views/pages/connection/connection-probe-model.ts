import { PREFLIGHT_STEPS, pairErrorKey, type PreflightStepId } from "@fresnel/client";
import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  PreflightEvent,
  PreflightOutcome,
  RemoteTestOutcome,
  SshHostsReply,
  SshPreflightArgs,
} from "../../../transport/ipc.ts";
import type { FingerprintError, PairFailure } from "../../commands.ts";
import type { SshFields } from "./host-address.ts";

// 호스트 추가 칸과 저장된 호스트 줄의 "연결 시험"이 쓰는 순수 모델(DOM 없음). 사전 점검의 단계 줄, 지문과 연결 코드의 문장 고르기,
// SSH 호스트 고르기의 채움 값, 대상 바꾸기 확인 조건, 끊긴 뒤 다시 붙기 줄을 만든다. 명령은 컨테이너가 부르고 결과만 여기로 넘긴다.

/** 쌍 맺기 때 보내는 기기 이름. 이 앱에는 기기 이름 설정이 없어 고정한다 */
export const PAIR_DEVICE_NAME = "Fresnel desktop";
/** 연결 코드 칸의 길이 제한 */
export const PAIR_CODE_MAX = 64;

type PreflightStop = Extract<PreflightOutcome, { readonly ok: false }>;

/** 단계 한 줄. 단계마다 마지막 이벤트 하나를 든다(셸 이벤트의 필요한 값만) */
export interface StepLine {
  readonly step: PreflightStepId;
  readonly status: "running" | "pass" | "fail" | "action";
  readonly code: string;
  readonly durationMs: number;
  readonly actions: readonly string[];
  readonly detail: PreflightEvent["detail"] | undefined;
  readonly fix: PreflightEvent["fix"] | undefined;
}

/**
 * 한 번의 시험(사전 점검 또는 주소 시험)의 화면 상태. `steps`는 단계 순서대로 든다. `tested`는 주소 시험(`testTarget`)의 답이다.
 * `failed`는 셸 명령 자체가 실패했다는 뜻이다.
 */
export interface ProbeState {
  readonly busy: boolean;
  readonly steps: readonly StepLine[];
  readonly tested: RemoteTestOutcome | null;
  readonly failed: boolean;
}

export const PROBE_IDLE: ProbeState = { busy: false, steps: [], tested: null, failed: false };

/** 사전 점검에 더하는 인자. 대상은 호출하는 쪽이 정한다. 호스트 키 확인 뒤 다시 돌릴 때만 값이 있다 */
export type ProbeRunArgs = Omit<SshPreflightArgs, "target">;

/** 저장된 호스트 줄에서 돌린 시험 하나. 한 번에 한 줄만 시험하므로 줄 id만 든다 */
export interface RowProbe {
  readonly id: string;
  readonly probe: ProbeState;
}

export type ProbeAction =
  | { readonly type: "begin" }
  | { readonly type: "step"; readonly event: PreflightEvent }
  | { readonly type: "stopped"; readonly outcome: PreflightStop }
  | { readonly type: "finished" }
  | { readonly type: "tested"; readonly outcome: RemoteTestOutcome }
  | { readonly type: "failed" };

function stepIndexOf(step: PreflightStepId): number {
  return PREFLIGHT_STEPS.indexOf(step);
}

/** 단계 하나를 넣는다. 같은 단계의 이전 줄은 바뀌고, 나머지는 단계 순서를 지킨다 */
function withStep(steps: readonly StepLine[], line: StepLine): readonly StepLine[] {
  return [...steps.filter((item) => item.step !== line.step), line].toSorted(
    (a, b) => stepIndexOf(a.step) - stepIndexOf(b.step),
  );
}

function lineOfEvent(event: PreflightEvent): StepLine {
  return {
    step: event.step,
    status: event.status,
    code: event.code,
    durationMs: event.durationMs,
    actions: event.actions,
    detail: event.detail,
    fix: event.fix,
  };
}

export function probeReducer(state: ProbeState, action: ProbeAction): ProbeState {
  switch (action.type) {
    case "begin":
      return { busy: true, steps: [], tested: null, failed: false };
    case "step":
      return { ...state, steps: withStep(state.steps, lineOfEvent(action.event)) };
    case "stopped": {
      const { outcome } = action;
      // 멈춘 단계의 시간은 이벤트에서 이미 받았으면 그 값을 쓴다
      const previous = state.steps.find((item) => item.step === outcome.step);
      const line: StepLine = {
        step: outcome.step,
        status: outcome.status,
        code: outcome.code,
        durationMs: previous?.durationMs ?? 0,
        actions: outcome.actions,
        detail: outcome.detail,
        fix: outcome.fix,
      };
      return { ...state, busy: false, steps: withStep(state.steps, line) };
    }
    case "finished":
      return { ...state, busy: false };
    case "tested":
      return { ...state, busy: false, tested: action.outcome };
    case "failed":
      return { ...state, busy: false, failed: true };
    default:
      return assertNever(action, "ProbeAction");
  }
}

/** 멈춘 단계의 줄. 사전 점검이 멈추면 그 단계가 마지막으로 보낸 실패 또는 조치 줄이다 */
export function stopLineOf(steps: readonly StepLine[]): StepLine | null {
  const stopped = steps.filter((item) => item.status === "fail" || item.status === "action");
  return stopped.at(-1) ?? null;
}

/** 새 호스트 키(또는 바뀐 키) 확인 정보. `replace`는 저장된 키가 바뀐 경우다 */
export interface HostKeyPrompt {
  readonly fingerprint: string;
  readonly keyType: string;
  readonly hostname: string;
  readonly replace: boolean;
}

/** 멈춘 줄이 호스트 키 확인을 요구하면 그 정보다. 조치에 `trust_host_key`나 `replace_host_key`가 없으면 null이다 */
export function hostKeyPromptOf(line: StepLine | null): HostKeyPrompt | null {
  const hostKey = line?.detail?.hostKey;
  if (line === null || hostKey === undefined) return null;
  const replace = line.actions.includes("replace_host_key");
  if (!replace && !line.actions.includes("trust_host_key")) return null;
  return {
    fingerprint: hostKey.fingerprint,
    keyType: hostKey.keyType,
    hostname: hostKey.hostname,
    replace,
  };
}

/** 사전 점검 인자의 대상 글(`[user@]host[:port]`). 호스트가 비었으면 null이다 */
export function preflightTargetOf(
  fields: Pick<SshFields, "user" | "host" | "port">,
): string | null {
  const host = fields.host.trim();
  if (host === "") return null;
  const user = fields.user.trim();
  const port = fields.port.trim();
  return `${user === "" ? "" : `${user}@`}${host}${port === "" ? "" : `:${port}`}`;
}

/** 고르기 목록의 한 줄 글: `user@HostName:port`. 호스트 이름이 없으면 별칭을, 포트가 없으면 포트를 뺀다 */
export function hostDisplayOf(host: SshHostsReply["hosts"][number]): string {
  const who = host.user === null ? "" : `${host.user}@`;
  const where = host.hostName ?? host.name;
  const port = host.port === null ? "" : `:${String(host.port)}`;
  return `${who}${where}${port}`;
}

/**
 * 고른 SSH 호스트를 주소 칸에 채운다. 별칭을 호스트 칸에 넣고 `user`만 따로 두면, 사전 점검이 `ssh -G`로 실제 호스트와
 * 포트를 읽는다. 소켓 칸은 그대로 둔다.
 */
export function pickedSshFields(
  host: SshHostsReply["hosts"][number],
  current: SshFields,
): SshFields {
  return { user: host.user ?? "", host: host.name, port: "", socket: current.socket };
}

/** 고르기 목록의 빈 자리 문장. 설정 파일을 읽지 못했으면 그 문장이 먼저다 */
export function pickEmptyKeyOf(reply: SshHostsReply): MessageId | null {
  if (reply.unreadable !== null) return "desktop.connection.hosts.unreadable";
  if (reply.hosts.length === 0) return "desktop.connection.hosts.none";
  return null;
}

/** 쌍 맺기 실패의 문장 키와 기다릴 초(잠김일 때만). 셸 명령이 실패한 것은 요청 실패 문장이다 */
export function pairFailureKeyOf(failure: PairFailure): {
  readonly key: MessageId;
  readonly seconds?: number;
} {
  if (failure.kind === "failed") return { key: "desktop.connection.actionFailed" };
  if (failure.code !== "locked") return { key: pairErrorKey(failure.code) };
  // 잠김인데 기다릴 시간을 모르면 "거절"로 본다(잠김 문장은 초를 꼭 받는다)
  if (failure.retryAfterSeconds === null) return { key: pairErrorKey("rejected") };
  return { key: pairErrorKey("locked"), seconds: failure.retryAfterSeconds };
}

/** 지문을 재지 못했을 때의 문장. 재기 코드(`refused`, `timeout`, `io`)가 닿지 못한 문장을 고른다 */
export function fingerprintFailureKeyOf(error: FingerprintError): MessageId {
  if (error.kind === "failed") return "desktop.connection.actionFailed";
  return pairErrorKey(error.code);
}

/** 원격 서비스가 살아 있는지 한 번 읽은 값. `unchecked`는 읽지 않았다(ssh 주소가 아니거나 연결이 있다) */
export type AliveReading =
  | { readonly kind: "unchecked" }
  | { readonly kind: "read"; readonly alive: boolean | null };

export const UNCHECKED: AliveReading = { kind: "unchecked" };

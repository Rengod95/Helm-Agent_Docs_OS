import {
  addTarget,
  filterTargets,
  TARGET_SEARCH_THRESHOLD,
  type AttachFailureKind,
  type TargetAddressReason,
  type TargetEntry,
} from "@fresnel/client";
import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { WIRE_ERRORS, type HostClientView } from "@fresnel/contracts/wire";
import type { EngineState, Link } from "../../../state/engine/index.ts";
import type { EngineTargetView } from "../../../state/ui/index.ts";
import type {
  CommandError,
  ConnectionSnapshot,
  ConnectTarget,
  ServiceCard,
} from "../../commands.ts";

// 연결 화면(P-08)의 상태 기계. 순수 함수만 둔다: 명령을 부르는 일은 화면이 맡고, 결과와 엔진·연결 관찰을 이 모델의 동작으로 옮긴다.
// 대상 목록은 로컬 설정이 주는 값이고 거울에 넣지 않는다. 진행은 엔진 상태 전이와 연결 상태로 본다(셸 명령은 값만 준다).
// 토큰은 이 모델에 들어오지 않는다(환경 변수로만 받는다).

/** 고른 대상. 저장된 원격 대상은 항목 그대로 든다(목록이 바뀌어도 현재 대상의 이름이 남는다) */
export type TargetChoice =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly entry: TargetEntry };

export const LOCAL_CHOICE: TargetChoice = { kind: "local" };

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "failed" };

/** 연결 진행 단계. 엔진이 멈추고(`stopping`), 다시 띄우고(`starting`·`restarting`), 연결을 맞춘다(`syncing`) */
export type ConnectStage = "requested" | "stopping" | "starting" | "restarting" | "syncing";

interface PendingConnect {
  readonly target: TargetChoice;
  /** 시도 전에 엔진이 가리키던 대상. 셸이 거절하면 이것으로 되돌린다 */
  readonly prior: TargetChoice;
  readonly stage: ConnectStage;
  /** `restarting`일 때 엔진이 다시 띄우는 번째 시도 */
  readonly attempt: number;
  /** 요청을 보낼 때 본 엔진 상태와 연결 상태. 이것과 처음 달라지기 전의 관찰은 낡은 값이라 진행으로 보지 않는다 */
  readonly from: { readonly engine: EngineState["kind"] | null; readonly link: Link["phase"] };
  /** 요청 뒤에 값이 처음 달라진 관찰을 받았는가 */
  readonly moved: boolean;
}

/**
 * 연결 실패. `retry`는 다시 시도의 방식이다: 셸이 거절했으면 같은 대상으로 `retarget`을 다시 보내고(`connect`),
 * 엔진이나 연결이 실패했으면 다시 띄우거나 다시 잇는다(`restart`).
 */
interface ConnectFailure {
  readonly kind: AttachFailureKind;
  readonly target: TargetChoice;
  readonly retry: "connect" | "restart";
}

type StatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly snapshot: ConnectionSnapshot }
  | { readonly kind: "offline" }
  | { readonly kind: "failed" };

/**
 * 연결된 클라이언트 목록(`host.clients`)의 읽기 상태. 상태 카드와 따로 읽어서 목록이 실패해도 카드는 그대로 둔다.
 * `offline`(연결이 없다)과 `unsupported`(엔진이 이 메서드를 모른다)는 목록 자리를 숨긴다. 뒤쪽은 연결 수 줄만 남는다.
 */
export type ClientsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly clients: readonly HostClientView[] }
  | { readonly kind: "offline" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" };

/**
 * 이 기기 서비스 카드의 단추가 눌릴 수 있는 바탕: 상태를 읽었고(연결이 있고), 다른 설정 쓰기나 서비스 동작이나 연결 진행이 없을 때다.
 */
function serviceIdle(state: ConnectionState): boolean {
  return (
    state.status.kind === "ready" &&
    !state.busy &&
    state.serviceBusy === null &&
    state.pending === null
  );
}

/** 시작 단추를 누를 수 있는가: 바탕이 되고 서비스가 실행 중이 아니다(상태를 읽지 못했으면 누를 수 있다) */
export function canStartService(state: ConnectionState): boolean {
  return serviceIdle(state) && state.service.kind !== "running";
}

/** 멈추기 단추를 누를 수 있는가: 바탕이 되고 서비스가 실행 중이다 */
export function canStopService(state: ConnectionState): boolean {
  return serviceIdle(state) && state.service.kind === "running";
}

/**
 * 원격 응답 허용 줄을 바꿀 수 있는가: 연결이 있고(상태를 읽었고), 값을 알고 있고, 다른 명령이나 연결 진행이 없을 때다.
 * 연결이 없으면 값을 보이고 잠근다.
 */
export function canSetRemoteRespond(state: ConnectionState): boolean {
  return (
    state.status.kind === "ready" &&
    state.remoteAllowRespond !== null &&
    !state.busy &&
    state.pending === null
  );
}

/** 추가 칸의 문장 검사 결과. 이름은 비었는가, 주소는 어떤 사유로 거절됐는가 */
export interface FormErrors {
  readonly label: boolean;
  readonly address: AddressReason | null;
}

/** 주소 거절 사유. 형식 검사의 사유와 같은 목록 중복 한 가지다 */
export type AddressReason = TargetAddressReason | "duplicate";

export interface FormState {
  readonly label: string;
  readonly address: string;
  readonly errors: FormErrors;
}

export const NO_FORM_ERRORS: FormErrors = { label: false, address: null };

interface Notice {
  readonly tone: "danger" | "success";
  readonly id: MessageId;
}

/** 이 기기 서비스 카드의 동작. 시작이나 멈추기 가운데 하나다 */
export type ServiceAction = "start" | "stop";

export interface ConnectionState {
  readonly list: ListState;
  readonly items: readonly TargetEntry[];
  /** 라디오에서 고른 대상. 연결 버튼이 이리로 간다 */
  readonly selected: TargetChoice;
  /** 엔진이 가리키는 대상(마지막으로 요청한 대상). 같은 대상을 다시 요청하면 셸은 아무 일도 하지 않으므로 연결을 막는다 */
  readonly engineTarget: TargetChoice;
  readonly query: string;
  readonly form: FormState | null;
  readonly pending: PendingConnect | null;
  readonly failure: ConnectFailure | null;
  readonly status: StatusState;
  /** 연결된 클라이언트 목록. 상태 카드와 따로 읽는다(목록 실패가 카드를 막지 않는다) */
  readonly clients: ClientsState;
  /** 이 기기의 서비스 상태 카드. 읽기 전이거나 읽지 못했으면 `unknown`이다 */
  readonly service: ServiceCard;
  /** 카드의 시작이나 멈추기가 가고 있는 동안 그 동작이다 */
  readonly serviceBusy: ServiceAction | null;
  /** 카드의 마지막 시작이나 멈추기가 실패했으면 그 동작이다. 성공하거나 다시 누르면 지운다 */
  readonly serviceError: ServiceAction | null;
  /** 서비스 모드 설정 값. 읽기 전에는 null */
  readonly serviceEnabled: boolean | null;
  /** 설정이 다시 시작을 기다린다(예약 화면이 켠 값이 엔진에 아직 들어가지 않았다). 이 기기의 켜기·끄기는 바로 적용되므로 참이 되지 않는다 */
  readonly restartNeeded: boolean;
  /** 원격 응답 허용 값. 읽기 전이거나 엔진이 이 설정을 알리지 않으면 null이다(이때 줄은 잠긴다) */
  readonly remoteAllowRespond: boolean | null;
  /** 서비스 멈추기 확인 대화 상자가 떠 있는가 */
  readonly stopConfirm: boolean;
  /** 목록 저장이나 설정 쓰기가 가고 있다. 같은 동작을 두 번 보내지 않도록 버튼을 잠근다 */
  readonly busy: boolean;
  readonly notice: Notice | null;
}

export const INITIAL_CONNECTION_STATE: ConnectionState = {
  list: { kind: "loading" },
  items: [],
  selected: LOCAL_CHOICE,
  engineTarget: LOCAL_CHOICE,
  query: "",
  form: null,
  pending: null,
  failure: null,
  status: { kind: "loading" },
  clients: { kind: "loading" },
  service: { kind: "unknown" },
  serviceBusy: null,
  serviceError: null,
  serviceEnabled: null,
  restartNeeded: false,
  remoteAllowRespond: null,
  stopConfirm: false,
  busy: false,
  notice: null,
};

/** 엔진과 연결의 관찰 한 번. 화면이 거울과 UI 스토어에서 읽어 넘긴다 */
interface EngineObservation {
  readonly engine: EngineState | null;
  readonly link: Link["phase"];
  /** 마지막 연결 시도의 실패 코드(`ui.connectError`). 셸 세션이 쓴다 */
  readonly connectError: string | null;
}

export type ConnectionAction =
  | {
      readonly type: "targetsChanged";
      readonly items: readonly TargetEntry[];
      readonly notice: Notice | null;
      readonly added: TargetEntry | null;
    }
  | { readonly type: "targetsFailed" }
  | { readonly type: "select"; readonly choice: TargetChoice }
  /** 화면을 열 때 엔진이 붙은 대상으로 고른 칸과 엔진 칸을 맞춘다. 목록을 읽은 뒤에 보낸다 */
  | { readonly type: "engineTargetSeen"; readonly target: EngineTargetView }
  | { readonly type: "query"; readonly text: string }
  | { readonly type: "formOpened" }
  | { readonly type: "formField"; readonly field: "label" | "address"; readonly value: string }
  | { readonly type: "formFailed"; readonly errors: FormErrors }
  | { readonly type: "formClosed" }
  | { readonly type: "busy"; readonly busy: boolean }
  | { readonly type: "statusLoading" }
  | { readonly type: "statusLoaded"; readonly snapshot: ConnectionSnapshot }
  | { readonly type: "statusFailed"; readonly reason: "offline" | "failed" }
  | { readonly type: "clientsLoading" }
  | { readonly type: "clientsLoaded"; readonly clients: readonly HostClientView[] }
  | { readonly type: "clientsFailed"; readonly reason: "offline" | "unsupported" | "failed" }
  | {
      readonly type: "connectStarted";
      readonly target: TargetChoice;
      readonly observed: EngineObservation;
    }
  | { readonly type: "connectRejected"; readonly kind: AttachFailureKind }
  | { readonly type: "engineSeen"; readonly observed: EngineObservation }
  | { readonly type: "serviceModeSet"; readonly enabled: boolean }
  | { readonly type: "serviceBusy"; readonly action: ServiceAction | null }
  | { readonly type: "serviceError"; readonly action: ServiceAction | null }
  | { readonly type: "remoteRespondSet"; readonly enabled: boolean }
  | { readonly type: "stopConfirm"; readonly open: boolean }
  | { readonly type: "notice"; readonly notice: Notice | null };

// ── 대상 고르기 ──────────────────────────────────────────────────────────

/** 라디오 값. 이 기기는 `local`, 저장된 원격 대상은 `remote:<id>`다 */
export function valueOfChoice(choice: TargetChoice): string {
  return choice.kind === "local" ? "local" : `remote:${choice.entry.id}`;
}

/** 라디오 값을 대상으로 되돌린다. 목록에 없는 원격 값이면 null이다 */
export function choiceOfValue(items: readonly TargetEntry[], value: string): TargetChoice | null {
  if (value === "local") return LOCAL_CHOICE;
  const id = value.startsWith("remote:") ? value.slice("remote:".length) : null;
  const entry = items.find((item) => item.id === id);
  return entry === undefined ? null : { kind: "remote", entry };
}

export function sameChoice(a: TargetChoice, b: TargetChoice): boolean {
  if (a.kind === "local" || b.kind === "local") return a.kind === b.kind;
  return a.entry.id === b.entry.id;
}

/** 검색 입력은 대상이 기준을 넘을 때만 보인다. 기준 이하면 검색어와 무관하게 전부 보인다 */
export function searchShown(items: readonly TargetEntry[]): boolean {
  return items.length > TARGET_SEARCH_THRESHOLD;
}

/** 화면에 보이는 대상 줄. 검색 입력이 있을 때만 검색어로 거른다 */
export function visibleTargets(state: ConnectionState): readonly TargetEntry[] {
  return searchShown(state.items) ? filterTargets(state.items, state.query) : state.items;
}

/** 연결 버튼을 누를 수 있는가: 진행 중이 아니고, 고른 대상이 엔진이 가리키는 대상과 다르다 */
export function canConnect(state: ConnectionState): boolean {
  return state.pending === null && !state.busy && !sameChoice(state.selected, state.engineTarget);
}

/** 셸 명령 인자로 바꾼다. 원격은 주소와 이름을 싣는다(토큰은 환경 변수로만 간다). 이름은 셸에 가지 않고 상태 표시줄이 쓴다 */
export function toConnectTarget(choice: TargetChoice): ConnectTarget {
  return choice.kind === "local"
    ? { kind: "local" }
    : { kind: "remote", address: choice.entry.address, label: choice.entry.label };
}

/**
 * 엔진이 붙은 대상을 화면의 고른 대상으로 바꾼다. 원격은 주소가 같은 목록 항목을 찾고, 목록에 없으면 이 기기로 둔다
 * (지운 대상에 붙어 있어도 고른 칸은 이 기기다).
 */
function choiceOfEngineTarget(
  items: readonly TargetEntry[],
  target: EngineTargetView,
): TargetChoice {
  if (target.kind === "local") return LOCAL_CHOICE;
  const entry = items.find((item) => item.address === target.address);
  return entry === undefined ? LOCAL_CHOICE : { kind: "remote", entry };
}

/** 저장할 때 쓰는 대상 id. 밀리초 시각으로 만들고, 같은 id는 `addTarget`이 거부한다 */
export function newTargetId(nowMs: number): string {
  return `t${nowMs.toString(36)}`;
}

// ── 추가 칸 검사 ────────────────────────────────────────────────────────

export type FormCheck =
  | { readonly ok: true; readonly list: readonly TargetEntry[]; readonly entry: TargetEntry }
  | { readonly ok: false; readonly errors: FormErrors };

/** 추가 칸을 검사한다. 이름이 비었거나 주소가 거절되면 두 칸의 사유를 함께 돌려준다 */
export function checkForm(
  items: readonly TargetEntry[],
  form: Pick<FormState, "label" | "address">,
  id: string,
): FormCheck {
  const label = form.label.trim();
  const entry: TargetEntry = { id, label, address: form.address };
  const added = addTarget(items, entry);
  const labelOk = label !== "";
  if (labelOk && added.ok) {
    const saved = added.list.find((item) => item.id === id);
    if (saved !== undefined) return { ok: true, list: added.list, entry: saved };
  }
  return {
    ok: false,
    errors: { label: !labelOk, address: added.ok ? null : added.reason },
  };
}

// ── 연결 실패 종류 ──────────────────────────────────────────────────────

/** `hello` 단계의 실패 코드가 가리키는 종류. 인증 거절(1004)과 버전·순서 오류(1001~1003)만 구분한다 */
const PROTOCOL_CODES: ReadonlySet<number> = new Set([
  WIRE_ERRORS["host.helloRequired"].code,
  WIRE_ERRORS["host.helloDuplicate"].code,
  WIRE_ERRORS["protocol.unsupported"].code,
]);

/**
 * 세션이 남긴 연결 실패 코드(`ui.connectError`)를 연결 실패 종류로 바꾼다. 형식은 `session.ts`가 쓰는 세 가지다:
 * `hello:<코드>`(wire 오류 코드), `attach:<셸 명령 코드>`, `engine_not_running`. 터널과 소켓의 원인은 여기에 없고
 * 엔진이 멈춘 원인(`attachFailureOfExit`)으로 본다. 종류가 없는 실패는 `other`다.
 */
export function attachFailureOf(connectError: string | null): AttachFailureKind | null {
  if (connectError === null) return null;
  if (!connectError.startsWith("hello:")) return "other";
  const code = Number(connectError.slice("hello:".length));
  if (code === WIRE_ERRORS["host.authFailed"].code) return "auth";
  if (PROTOCOL_CODES.has(code)) return "protocol";
  return "other";
}

/**
 * 엔진 stderr 첫 줄(영어)의 특징 문구와 종류. 순서가 뜻을 가른다: 호스트 키 줄은 "ssh tunnel" 줄 안에도 함께 오므로
 * `hostKey`를 `tunnel`보다 먼저 본다.
 */
const EXIT_DETAIL_KINDS: readonly (readonly [string, AttachFailureKind])[] = [
  ["socket does not exist", "socketMissing"],
  ["refused the connection", "refused"],
  ["cannot be accessed", "permission"],
  ["did not respond in time", "timeout"],
  ["host key verification failed", "hostKey"],
  ["ssh tunnel", "tunnel"],
  ["token is missing", "tokenMissing"],
  ["token does not match", "auth"],
];

/**
 * 멈춘 엔진의 종료 원인을 연결 실패 종류로 바꾼다. 원인은 종료 코드가 아니라 `detail`(stderr 첫 줄)의 문구로 고른다.
 * 종료 코드 3(환경 문제)은 셸이 자동 재시도를 하지 않는다는 뜻이고 종류는 `detail`이 정한다. 문구가 없거나 모르는
 * 줄이면 `other`다. 대소문자는 가리지 않는다.
 */
export function attachFailureOfExit(exit: {
  readonly code: number | null;
  readonly detail?: string | null;
}): AttachFailureKind {
  const detail = exit.detail;
  if (detail === null || detail === undefined) return "other";
  const text = detail.toLowerCase();
  const found = EXIT_DETAIL_KINDS.find(([phrase]) => text.includes(phrase));
  return found === undefined ? "other" : found[1];
}

// ── 연결된 클라이언트 ──────────────────────────────────────────────────

/** 목록 한 줄. 이름은 `hello`를 마친 연결만 있다(없으면 `null`이고 화면이 전송 종류로 부른다) */
export interface ClientRow {
  readonly id: string;
  readonly name: string | null;
  readonly transport: HostClientView["transport"];
  readonly version: string | null;
  readonly self: boolean;
  readonly writeThreads: number;
  readonly observedThreads: number;
}

export function clientRowOf(client: HostClientView): ClientRow {
  return {
    id: client.connectionId,
    name: client.name ?? null,
    transport: client.transport,
    version: client.version ?? null,
    self: client.self,
    writeThreads: client.writeThreads,
    observedThreads: client.observedThreads,
  };
}

/** 목록 읽기 실패를 화면 상태로 바꾼다. 연결이 없음과 오래된 엔진은 목록을 숨기고, 그 밖은 실패로 보여 다시 시도를 준다 */
export function clientsReasonOf(error: CommandError): "offline" | "unsupported" | "failed" {
  if (error.kind === "offline") return "offline";
  if (error.kind === "unsupported") return "unsupported";
  return "failed";
}

/** 목록 자리를 그리는가. 연결이 없거나 오래된 엔진이면 숨긴다 */
export function clientsShown(clients: ClientsState): boolean {
  return clients.kind !== "offline" && clients.kind !== "unsupported";
}

// ── 진행 단계 ──────────────────────────────────────────────────────────

export type StepId = "stop" | "start" | "sync";
export type StepStatus = "done" | "now" | "todo";

/** 진행 단계 세 개의 상태. 요청 직후와 멈추는 중은 첫 단계, 다시 띄우는 중은 둘째, 연결을 맞추는 중은 셋째다 */
export function stepsOf(
  stage: ConnectStage,
): readonly { readonly id: StepId; readonly status: StepStatus }[] {
  const at = (now: StepId): readonly { readonly id: StepId; readonly status: StepStatus }[] => {
    const order: readonly StepId[] = ["stop", "start", "sync"];
    const index = order.indexOf(now);
    return order.map((id, i) => ({
      id,
      status: i < index ? "done" : i === index ? "now" : "todo",
    }));
  };
  switch (stage) {
    case "requested":
    case "stopping":
      return at("stop");
    case "starting":
    case "restarting":
      return at("start");
    case "syncing":
      return at("sync");
    default:
      return assertNever(stage, "ConnectStage");
  }
}

// ── 상태 기계 ──────────────────────────────────────────────────────────

function engineKindOf(engine: EngineState | null): EngineState["kind"] | null {
  return engine === null ? null : engine.kind;
}

function withPending(
  state: ConnectionState,
  stage: ConnectStage,
  attempt: number,
): ConnectionState {
  const pending = state.pending;
  if (pending === null) return state;
  if (pending.stage === stage && pending.attempt === attempt) return state;
  return { ...state, pending: { ...pending, stage, attempt } };
}

/** 진행을 끝낸다: 엔진이 가리키는 대상이 고른 대상이 되고 연결이 맞았다는 알림을 남긴다 */
function succeed(state: ConnectionState): ConnectionState {
  return {
    ...state,
    pending: null,
    failure: null,
    notice: { tone: "success", id: "desktop.connection.connected" },
  };
}

function fail(
  state: ConnectionState,
  kind: AttachFailureKind,
  retry: ConnectFailure["retry"],
): ConnectionState {
  const pending = state.pending;
  if (pending === null) return state;
  return {
    ...state,
    pending: null,
    failure: { kind, target: pending.target, retry },
  };
}

/**
 * 엔진과 연결의 관찰을 진행에 반영한다. 진행 중이 아니면 아무 일도 없다. 요청 때의 값과 처음 달라지기 전의 관찰은
 * 낡은 값일 수 있어(요청과 같은 묶음에서 다시 그려진다) 무시한다. 세션이 남긴 연결 실패는 요청 뒤에 생긴 것이다
 * (요청 때 화면이 오류를 지운다).
 */
function observe(state: ConnectionState, observed: EngineObservation): ConnectionState {
  const pending = state.pending;
  if (pending === null) return state;
  if (observed.connectError !== null) {
    const kind = attachFailureOf(observed.connectError);
    return kind === null ? state : fail(state, kind, "restart");
  }
  const changed =
    engineKindOf(observed.engine) !== pending.from.engine || observed.link !== pending.from.link;
  if (!pending.moved && !changed) return state;
  const moved: ConnectionState = pending.moved
    ? state
    : { ...state, pending: { ...pending, moved: true } };
  const engine = observed.engine;
  if (engine === null) return moved;
  switch (engine.kind) {
    case "stopping":
      return withPending(moved, "stopping", 0);
    case "stopped":
      return moved;
    case "starting":
      return withPending(moved, "starting", 0);
    case "restarting":
      return withPending(moved, "restarting", engine.attempt);
    case "failed":
      return fail(moved, attachFailureOfExit(engine.lastExit), "restart");
    case "running":
      if (observed.link === "live") return succeed(moved);
      if (observed.link === "failed") return fail(moved, "other", "restart");
      return withPending(moved, "syncing", 0);
    default:
      return assertNever(engine, "EngineState");
  }
}

/** 고른 대상이 목록에서 사라졌으면 이 기기로 되돌린다 */
function keepSelection(selected: TargetChoice, items: readonly TargetEntry[]): TargetChoice {
  if (selected.kind === "local") return selected;
  return items.some((item) => item.id === selected.entry.id) ? selected : LOCAL_CHOICE;
}

export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  switch (action.type) {
    case "targetsChanged": {
      const selected = keepSelection(state.selected, action.items);
      const form = action.added === null ? state.form : null;
      return {
        ...state,
        list: { kind: "ready" },
        items: action.items,
        selected: action.added === null ? selected : { kind: "remote", entry: action.added },
        form,
        query: action.added === null ? state.query : "",
        notice: action.notice,
      };
    }
    case "targetsFailed":
      return { ...state, list: { kind: "failed" } };
    case "select":
      return { ...state, selected: action.choice };
    case "engineTargetSeen": {
      // 진행 중이면 고른 대상과 엔진 대상을 건드리지 않는다. 화면을 열 때 한 번만 부른다
      if (state.pending !== null) return state;
      const choice = choiceOfEngineTarget(state.items, action.target);
      return { ...state, selected: choice, engineTarget: choice };
    }
    case "query":
      return { ...state, query: action.text };
    case "formOpened":
      return { ...state, form: { label: "", address: "", errors: NO_FORM_ERRORS } };
    case "formField": {
      if (state.form === null) return state;
      const form = { ...state.form, [action.field]: action.value, errors: NO_FORM_ERRORS };
      return { ...state, form };
    }
    case "formFailed":
      if (state.form === null) return state;
      return { ...state, form: { ...state.form, errors: action.errors } };
    case "formClosed":
      return { ...state, form: null };
    case "busy":
      return { ...state, busy: action.busy };
    case "statusLoading":
      return { ...state, status: { kind: "loading" } };
    case "statusLoaded":
      return {
        ...state,
        status: { kind: "ready", snapshot: action.snapshot },
        service: action.snapshot.service,
        serviceEnabled: action.snapshot.serviceEnabled,
        restartNeeded: action.snapshot.restartPending,
        remoteAllowRespond: action.snapshot.remoteAllowRespond,
      };
    case "statusFailed":
      // 상태를 못 읽으면 이전 카드는 낡은 값이다. 실행 중인 것처럼 보이지 않도록 모름으로 바꾼다
      return {
        ...state,
        status: { kind: action.reason === "offline" ? "offline" : "failed" },
        service: { kind: "unknown" },
      };
    case "clientsLoading":
      return { ...state, clients: { kind: "loading" } };
    case "clientsLoaded":
      return { ...state, clients: { kind: "ready", clients: action.clients } };
    case "clientsFailed":
      return { ...state, clients: { kind: action.reason } };
    case "connectStarted":
      // 진행 중에는 새 요청을 받지 않는다. 실패 뒤 다시 시도도 이 동작으로 시작한다
      if (state.pending !== null) return state;
      return {
        ...state,
        pending: {
          target: action.target,
          prior: state.engineTarget,
          stage: "requested",
          attempt: 0,
          from: { engine: engineKindOf(action.observed.engine), link: action.observed.link },
          moved: false,
        },
        engineTarget: action.target,
        failure: null,
        notice: null,
      };
    case "connectRejected": {
      const pending = state.pending;
      if (pending === null) return state;
      // 셸이 대상 바꾸기를 거절했으면 엔진은 이전 대상 그대로다. 같은 대상으로 다시 보내면 된다
      return {
        ...state,
        pending: null,
        engineTarget: pending.prior,
        failure: { kind: action.kind, target: pending.target, retry: "connect" },
      };
    }
    case "engineSeen":
      return observe(state, action.observed);
    case "serviceModeSet":
      // 이 기기의 켜기·끄기는 엔진을 다시 띄워 바로 적용되므로 다시 시작 대기가 없다
      return { ...state, serviceEnabled: action.enabled, restartNeeded: false };
    case "serviceBusy":
      return { ...state, serviceBusy: action.action };
    case "serviceError":
      return { ...state, serviceError: action.action };
    case "remoteRespondSet":
      // 원격 응답 허용은 엔진을 다시 띄우지 않아도 바로 적용된다(L2.schedule §6: live)
      return { ...state, remoteAllowRespond: action.enabled };
    case "stopConfirm":
      return { ...state, stopConfirm: action.open };
    case "notice":
      return { ...state, notice: action.notice };
    default:
      return assertNever(action, "ConnectionAction");
  }
}

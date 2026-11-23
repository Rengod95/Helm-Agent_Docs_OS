import { assertNever, err, ok, type Result } from "@fresnel/contracts";
import type { OrchestrationApi, OrchestrationStartDriveResult } from "@fresnel/orchestration-sdk";
import type { HelmCommandError } from "./failures.ts";
import { inquiryIdFrom, needIdFrom } from "./signals.ts";
import {
  PHASE_TEXT,
  pluginNeedOf,
  updateState,
  type HelmLens,
  type HelmPhase,
  type HelmState,
  type StateWriteFailure,
} from "./state.ts";
import { transition } from "./phase.ts";
import { LEASE_TEXT, LENS_STATUS_TEXT } from "./texts.ts";

export type HelmCommand =
  | { readonly name: "start"; readonly topic?: string }
  | { readonly name: "stop" }
  | { readonly name: "status" }
  | { readonly name: "plugin"; readonly purpose: string };

export interface HelmStatusView {
  readonly enabled: boolean;
  readonly phase: HelmPhase;
  readonly inquiryId: string | null;
  readonly topic: string | null;
  readonly lenses: readonly HelmLens[];
  readonly findings: number;
  /** 임대 상태. 외부 플러그인은 GroupService에 닿지 못해 커밋된 상태에서 얻는다: 탐구 중이면 held, pending만 있으면 waiting */
  readonly lease: "held" | "waiting" | "none";
  readonly leaseHolder?: string;
}

export const HELM_USAGE = "사용법: /helm start [주제] | stop | status | plugin <설명>";

/** 순수 함수. "/helm" 뒤의 인자 문자열을 해석한다. 인자가 없으면 status다 */
export function parseHelmCommand(
  args: string,
): Result<HelmCommand, Extract<HelmCommandError, { kind: "usage" }>> {
  const text = args.trim();
  if (text === "") return ok({ name: "status" });
  const [sub = "", ...rest] = text.split(/\s+/u);
  const tail = rest.join(" ");
  if (sub === "start") return ok(tail === "" ? { name: "start" } : { name: "start", topic: tail });
  if (sub === "plugin") {
    return tail === ""
      ? err({ kind: "usage", message: HELM_USAGE })
      : ok({ name: "plugin", purpose: tail.slice(0, 500) });
  }
  if (sub === "stop" || sub === "status") {
    return tail === "" ? ok({ name: sub }) : err({ kind: "usage", message: HELM_USAGE });
  }
  // 하위 명령이 아닌 글(`/helm 책을 끝까지 읽는 습관`)은 시작의 주제다. 입력을 조용히 버리지 않는다(U-09)
  return ok({ name: "start", topic: [sub, ...rest].join(" ") });
}

/** 순수 함수. 커밋된 상태를 상태 보기로 바꾼다. `/helm status`와 확장 메서드 `status`가 같이 쓴다 */
export function viewOf(state: Readonly<HelmState>): HelmStatusView {
  const waiting = state.pending !== null || pluginNeedOf(state) !== null;
  const lease = state.phase !== "idle" ? "held" : waiting ? "waiting" : "none";
  return {
    enabled: true,
    phase: state.phase,
    inquiryId: state.inquiryId ?? state.pending?.inquiryId ?? null,
    topic: state.topic ?? state.pending?.topic ?? null,
    lenses: state.lenses,
    findings: state.findings.length,
    lease,
  };
}

export interface CommandContext {
  /** 명령마다 다른 값. 탐구 id의 재료와 알림 requestId에 쓴다 */
  readonly nonce: string;
  /** 현재 turn 입력의 용어 후보. 주제를 생략했을 때 쓴다 */
  readonly terms: readonly string[];
}

type CommandApi = Pick<OrchestrationApi<HelmState>, "state" | "commit">;

/**
 * 명령 실행. 효과는 updateState뿐이다. 명령 처리기는 재실행되지 않으므로 ADR-0015 대상이 아니다.
 * 호출은 상태 문서에 닿는 문맥(on 핸들러)에서 한다: `RegistrationApi.state`·`commit`은 on·drive 밖에서 쓸 수 없다
 */
export async function runHelmCommand(
  g: CommandApi,
  cmd: HelmCommand,
  ctx: CommandContext,
): Promise<Result<HelmStatusView, HelmCommandError>> {
  switch (cmd.name) {
    case "status":
      return ok(viewOf(g.state()));
    case "start": {
      const current = g.state();
      // 탐구가 있으면(도는 중이거나 시작을 기다리는 중) 같은 주제나 주제 생략의 start는 이어 가기다. 주도가 살아 있으면 엔진이 요청을 버린다.
      // 다른 주제는 지금 탐구와 충돌하므로 거절한다. 신호가 만든 대기 요청도 이 명령으로만 시작한다(drive-isolation.md 2.2)
      const live = current.phase !== "idle" || current.pending !== null;
      if (live) {
        const activeTopic =
          current.phase !== "idle" ? current.topic : (current.pending?.topic ?? null);
        const activeId = current.inquiryId ?? current.pending?.inquiryId ?? null;
        if (cmd.topic === undefined || cmd.topic === activeTopic) return ok(viewOf(current));
        return err({ kind: "already_running", inquiryId: activeId });
      }
      const topic = (cmd.topic ?? ctx.terms.slice(0, 3).join(", ")).slice(0, 500);
      if (topic === "") return err({ kind: "no_topic" });
      const pending = {
        inquiryId: inquiryIdFrom(`command:${ctx.nonce}:${topic}`),
        topic,
        source: "command" as const,
      };
      const written = await updateState(
        g,
        (state) => transition(state, { type: "requested", pending }).state,
      );
      return written.ok ? ok(viewOf(written.value)) : failedWrite(written.error);
    }
    case "plugin": {
      const current = g.state();
      // 탐구가 있으면 맡기기를 쌓지 않는다. 맡기기 요청은 탐구보다 먼저 처리되므로 대기 중인 요청도 한 번에 하나다
      if (current.phase !== "idle" || current.pending !== null) {
        const inquiryId = current.inquiryId ?? current.pending?.inquiryId ?? null;
        return err({ kind: "already_running", inquiryId });
      }
      if (pluginNeedOf(current) !== null) return err({ kind: "plugin_pending" });
      const pluginNeed = { purpose: cmd.purpose, id: needIdFrom(`plugin:${ctx.nonce}`) };
      const written = await updateState(g, (state) => ({ ...state, pluginNeed }));
      return written.ok ? ok(viewOf(written.value)) : failedWrite(written.error);
    }
    case "stop": {
      const written = await updateState(g, (state) => {
        // 맡기기 요청도 취소한다. 이미 맡겨졌다면 돌아온 결과는 요청이 없으므로 알림 없이 끝난다
        if (state.phase === "idle") {
          return { ...transition(state, { type: "stopRequested" }).state, pluginNeed: null };
        }
        return { ...state, stopRequested: true };
      });
      return written.ok ? ok(viewOf(written.value)) : failedWrite(written.error);
    }
    default:
      return assertNever(cmd, "HelmCommand");
  }
}

function failedWrite(failure: StateWriteFailure): Result<never, HelmCommandError> {
  if (failure.kind === "disabled" || failure.kind === "lease_lost")
    return err({ kind: "disabled" });
  return err({ kind: "state_write", failure });
}

/** `OrchestrationApi.startDrive`가 거부했을 때의 오류 값 */
type StartFailure = Extract<OrchestrationStartDriveResult, { readonly ok: false }>["error"];

/** 주도 시작 요청이 거부된 이유를 한 줄 문장으로 바꾼다. 상태는 이미 커밋돼 있어 다시 `/helm start`로 이어 갈 수 있다 */
export function startFailureText(error: StartFailure): string {
  switch (error.kind) {
    case "unknown_thread":
      return "대화를 찾지 못해 탐구를 시작하지 못했습니다. 시작은 기다리는 상태로 남아 있어요.";
    case "unknown_scope":
      return "Helm 그룹을 찾지 못해 탐구를 시작하지 못했습니다. 시작은 기다리는 상태로 남아 있어요.";
    case "child_thread":
      return "하위 대화에서는 탐구를 시작할 수 없습니다. 기다리는 탐구는 남아 있어요.";
    case "not_drive":
      return "Helm의 구동 기능을 쓸 수 없어 탐구를 시작하지 못했습니다.";
    case "drive_error":
      return "Helm 구동 기능이 앞선 오류로 멈춰 있어 탐구를 시작하지 못했습니다. Helm을 껐다 다시 켠 뒤 시도하세요.";
    case "input_too_large":
      return "시작 입력이 너무 커서 탐구를 시작하지 못했습니다. 입력을 줄여 다시 시도하세요.";
    case "no_context":
      return "대화 문맥이 없어 탐구를 시작하지 못했습니다.";
    default:
      return assertNever(error, "StartDriveError");
  }
}

/** HelmCommandError를 kind별 한 줄 문장으로 바꾼다 */
export function commandErrorText(error: HelmCommandError): string {
  switch (error.kind) {
    case "usage":
      return error.message;
    case "already_running":
      return "이미 탐구 중이거나 시작을 기다리는 탐구가 있습니다.";
    case "no_topic":
      return "주제를 알 수 없습니다. /helm start 주제 로 주제를 적어 주세요.";
    case "plugin_pending":
      return "플러그인 맡기기를 기다리는 중입니다. /helm stop 으로 취소할 수 있어요.";
    case "disabled":
      return "Helm 그룹이 꺼져 있습니다.";
    case "state_write":
      return `상태를 쓰지 못했습니다(${error.failure.kind}). 잠시 뒤 다시 시도하세요.`;
    default:
      return assertNever(error, "HelmCommandError");
  }
}

/** `/helm plugin` 결과 글. 요청은 커밋됐고 주도 시작 요청을 냈다. 제작은 맡기기 결과가 올 때 알린다 */
export function pluginRequestText(purpose: string): string {
  return `[helm] 플러그인 제작을 authoring에 맡기려고 요청했어요: ${purpose}`;
}

/** 상태 한 줄 문장. `missingMeta`가 있으면 도구 메타 없음 경고를 붙인다 */
export function statusText(view: HelmStatusView, missingMeta: readonly string[]): string {
  const lines = [
    `[helm] ${LEASE_TEXT[view.lease]}, 단계: ${PHASE_TEXT[view.phase]}${view.topic === null ? "" : `, 주제: ${view.topic}`}`,
  ];
  if (view.lenses.length > 0) {
    lines.push(
      `렌즈: ${view.lenses.map((lens) => `${lens.title}(${LENS_STATUS_TEXT[lens.status]})`).join(", ")}`,
    );
  }
  if (view.findings > 0) lines.push(`발견: ${String(view.findings)}개`);
  if (missingMeta.length > 0) {
    lines.push(`도구 메타 없음(쓰기로 취급): ${missingMeta.join(", ")}`);
  }
  return lines.join("\n");
}

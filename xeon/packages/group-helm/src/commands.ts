import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type { GroupApi } from "@xeon/group-kit";
import type { HelmCommandError } from "./failures.ts";
import { inquiryIdFrom } from "./signals.ts";
import {
  updateState,
  type HelmLens,
  type HelmPhase,
  type HelmState,
  type StateWriteFailure,
} from "./state.ts";
import { transition } from "./phase.ts";

export type HelmCommand =
  | { readonly name: "start"; readonly topic?: string }
  | { readonly name: "stop" }
  | { readonly name: "status" };

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

export const HELM_USAGE = "사용법: /helm start [주제] | stop | status";

/** 순수 함수. "/helm" 뒤의 인자 문자열을 해석한다. 인자가 없으면 status다 */
export function parseHelmCommand(
  args: string,
): Result<HelmCommand, Extract<HelmCommandError, { kind: "usage" }>> {
  const text = args.trim();
  if (text === "") return ok({ name: "status" });
  const [sub = "", ...rest] = text.split(/\s+/u);
  const tail = rest.join(" ");
  if (sub === "start") return ok(tail === "" ? { name: "start" } : { name: "start", topic: tail });
  if (sub === "stop" || sub === "status") {
    return tail === "" ? ok({ name: sub }) : err({ kind: "usage", message: HELM_USAGE });
  }
  return err({ kind: "usage", message: HELM_USAGE });
}

function viewOf(state: Readonly<HelmState>): HelmStatusView {
  const lease = state.phase !== "idle" ? "held" : state.pending !== null ? "waiting" : "none";
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

type CommandApi = Pick<GroupApi<HelmState>, "state" | "commit">;

/**
 * 명령 실행. 효과는 updateState뿐이다. 명령 처리기는 재실행되지 않으므로 ADR-0015 대상이 아니다.
 * 호출은 상태 문서에 닿는 문맥(on 핸들러)에서 한다: `ScopeApi.state`·`commit`은 on·drive 밖에서 쓸 수 없다
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
      if (current.phase !== "idle" || current.pending !== null) {
        return err({
          kind: "already_running",
          inquiryId: current.inquiryId ?? current.pending?.inquiryId ?? null,
        });
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
    case "stop": {
      const written = await updateState(g, (state) => {
        if (state.phase === "idle") return transition(state, { type: "stopRequested" }).state;
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

/** HelmCommandError를 kind별 한 줄 문장으로 바꾼다 */
export function commandErrorText(error: HelmCommandError): string {
  switch (error.kind) {
    case "usage":
      return error.message;
    case "already_running":
      return "이미 탐구 중이거나 시작을 기다리는 탐구가 있습니다.";
    case "no_topic":
      return "주제를 알 수 없습니다. /helm start 주제 로 주제를 적어 주세요.";
    case "disabled":
      return "Helm 그룹이 꺼져 있습니다.";
    case "state_write":
      return `상태를 쓰지 못했습니다(${error.failure.kind}). 잠시 뒤 다시 시도하세요.`;
    default:
      return assertNever(error, "HelmCommandError");
  }
}

const PHASE_TEXT: Readonly<Record<HelmPhase, string>> = {
  idle: "대기",
  diverge: "발산",
  explore: "다른 분야 탐색",
  converge: "수렴",
  apply: "적용",
};

/** 상태 한 줄 문장. `missingMeta`가 있으면 도구 메타 없음 경고를 붙인다 */
export function statusText(view: HelmStatusView, missingMeta: readonly string[]): string {
  const lines = [
    `[helm] 단계: ${PHASE_TEXT[view.phase]}, 임대: ${view.lease}${view.topic === null ? "" : `, 주제: ${view.topic}`}`,
  ];
  if (view.lenses.length > 0) {
    lines.push(`렌즈: ${view.lenses.map((lens) => `${lens.title}(${lens.status})`).join(", ")}`);
  }
  if (view.findings > 0) lines.push(`발견: ${String(view.findings)}개`);
  if (missingMeta.length > 0) {
    lines.push(`도구 메타 없음(쓰기로 취급): ${missingMeta.join(", ")}`);
  }
  return lines.join("\n");
}

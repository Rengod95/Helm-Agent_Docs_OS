import { assertNever } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { PROPOSAL_STATUS_VALUES, type ProposalStatus } from "./proposals/proposal.ts";
import type { ProposalDecision, QueueOps } from "./proposals/ops.ts";
import type { CommandReport, LearningError } from "./results.ts";

// L3.learning.spec §6.2 명령 `/learning`. 모든 하위 명령은 진입 때 지연 정리(§4.5 규칙 7)를 먼저 한다.
// 승인과 수정은 판(`--revision`)을 필수로 받는다: F wire `proposal.decide`가 approve와 edit에 판을 필수로 둔다(M3-REQ-18).

export type LearningCommand =
  | { readonly op: "queue"; readonly json: boolean; readonly status: ProposalStatus | undefined }
  | { readonly op: "show"; readonly id: string }
  | {
      readonly op: "approve";
      readonly id: string;
      readonly revision: number;
      readonly scope: "user" | "project" | undefined;
    }
  | { readonly op: "reject"; readonly id: string; readonly note: string | undefined }
  | { readonly op: "edit"; readonly id: string; readonly revision: number; readonly body: string }
  | { readonly op: "revert"; readonly id: string }
  | { readonly op: "review"; readonly cancel: boolean };

export type CommandParse =
  | { readonly ok: true; readonly command: LearningCommand }
  | { readonly ok: false; readonly usage: string };

export const LEARNING_USAGE: string =
  "usage: /learning queue [--json] [--status <s>] | queue show <id> | queue approve <id> --revision <n> [--scope user|project] | " +
  "queue reject <id> [--note <text>] | queue edit <id> --revision <n> <body> | queue revert <id> | review [--cancel]";

const fail: CommandParse = { ok: false, usage: LEARNING_USAGE };

function isStatus(value: string): value is ProposalStatus {
  return PROPOSAL_STATUS_VALUES.some((status) => status === value);
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  return Number(value);
}

/** 순수 함수. "/learning" 뒤의 인자 문자열을 해석한다 */
export function parseLearningCommand(args: string): CommandParse {
  const tokens = args.split(/\s+/u).filter((token) => token.length > 0);
  const [first, second, third] = tokens;
  if (first === "review") {
    const rest = tokens.slice(1);
    if (rest.length === 0) return { ok: true, command: { op: "review", cancel: false } };
    return rest.length === 1 && rest[0] === "--cancel"
      ? { ok: true, command: { op: "review", cancel: true } }
      : fail;
  }
  if (first !== "queue") return fail;
  if (second === undefined || second.startsWith("--")) return parseQueue(tokens.slice(1));
  if (third === undefined) return fail;
  const id = third;
  const afterId = tokens.slice(3);
  if (second === "show")
    return afterId.length === 0 ? { ok: true, command: { op: "show", id } } : fail;
  if (second === "revert")
    return afterId.length === 0 ? { ok: true, command: { op: "revert", id } } : fail;
  if (second === "approve") return parseApprove(id, afterId);
  if (second === "reject") return parseReject(id, afterId);
  if (second === "edit") return parseEdit(id, args);
  return fail;
}

function parseQueue(rest: readonly string[]): CommandParse {
  let json = false;
  let status: ProposalStatus | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--json") {
      json = true;
    } else if (token === "--status") {
      const value = rest[index + 1];
      if (value === undefined || !isStatus(value)) return fail;
      status = value;
      index += 1;
    } else {
      return fail;
    }
  }
  return { ok: true, command: { op: "queue", json, status } };
}

function parseApprove(id: string, rest: readonly string[]): CommandParse {
  let revision: number | undefined;
  let scope: "user" | "project" | undefined;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === "--revision") {
      revision = positiveInt(value);
    } else if (flag === "--scope" && (value === "user" || value === "project")) {
      scope = value;
    } else {
      return fail;
    }
  }
  return revision === undefined
    ? fail
    : { ok: true, command: { op: "approve", id, revision, scope } };
}

function parseReject(id: string, rest: readonly string[]): CommandParse {
  if (rest.length === 0) return { ok: true, command: { op: "reject", id, note: undefined } };
  if (rest[0] !== "--note" || rest.length < 2) return fail;
  return { ok: true, command: { op: "reject", id, note: rest.slice(1).join(" ") } };
}

/** `edit <id> --revision <n> <본문…>`: 본문은 판 뒤의 나머지 줄이고 공백을 그대로 둔다 */
function parseEdit(id: string, args: string): CommandParse {
  const matched = /^\s*queue\s+edit\s+\S+\s+--revision\s+([1-9][0-9]*)\s+([\s\S]+)$/u.exec(args);
  const revision = positiveInt(matched?.[1]);
  const body = matched?.[2];
  if (revision === undefined || body === undefined || body.trim().length === 0) return fail;
  return { ok: true, command: { op: "edit", id, revision, body } };
}

/** 호스트가 같은 결정을 명령 줄로 실행하려고 쓰는 변환. `parseLearningCommand`의 역이다 */
export function decisionCommandLine(decision: ProposalDecision): string {
  switch (decision.kind) {
    case "approve":
      return `queue approve ${decision.proposalId} --revision ${String(decision.revision)}${decision.scope === undefined ? "" : ` --scope ${decision.scope}`}`;
    case "reject":
      return `queue reject ${decision.proposalId}${decision.note === undefined || decision.note.trim() === "" ? "" : ` --note ${decision.note.replace(/\s+/gu, " ").trim()}`}`;
    case "edit":
      return `queue edit ${decision.proposalId} --revision ${String(decision.revision)} ${decision.body}`;
    case "revert":
      return `queue revert ${decision.proposalId}`;
    default:
      return assertNever(decision, "ProposalDecision");
  }
}

export interface CommandEnv {
  readonly ops: QueueOps;
  /** 진행 중 표지가 남은 검토를 닫는다(대화가 있을 때만 부른다) */
  settleInFlight(threadId: ThreadId): Promise<void>;
  readonly signal: AbortSignal;
  readonly threadId: ThreadId | null;
  /** 수동 검토를 시작한다. 진행 중 검토가 있으면 `learning.reviewBusy` */
  startReview(threadId: ThreadId): Promise<CommandReport>;
  cancelReview(): Promise<CommandReport>;
}

function errorReport(error: LearningError): CommandReport {
  return { kind: "error", error };
}

/** 명령 하나를 실행해 결과 값을 돌려준다. 진입 때 지연 정리를 먼저 한다 */
export async function runLearningCommand(
  command: LearningCommand,
  env: CommandEnv,
): Promise<CommandReport> {
  // 진입 정리는 기록을 쓰므로 대화가 있을 때만 한다. 대화 없이 부르면 읽기 명령만 된다
  const writable = env.threadId !== null;
  if (env.threadId !== null) await env.settleInFlight(env.threadId);
  const swept = writable ? await env.ops.sweep(env.signal) : undefined;
  const sweep = swept?.ok === true ? swept.value : null;
  if (!writable && command.op !== "queue" && command.op !== "show") {
    return errorReport({ kind: "learning.noConversation" });
  }
  switch (command.op) {
    case "queue": {
      const listed = await env.ops.list(
        command.status === undefined ? {} : { statuses: [command.status] },
      );
      return listed.ok ? { kind: "queue", views: listed.value, sweep } : errorReport(listed.error);
    }
    case "show": {
      const listed = await env.ops.list({});
      if (!listed.ok) return errorReport(listed.error);
      const view = listed.value.find((row) => row.id === command.id);
      return view === undefined
        ? errorReport({ kind: "learning.notFound", proposalId: command.id })
        : { kind: "show", view };
    }
    case "approve":
      return {
        kind: "decision",
        result: await env.ops.decide(
          {
            kind: "approve",
            proposalId: command.id,
            revision: command.revision,
            ...(command.scope === undefined ? {} : { scope: command.scope }),
          },
          env.signal,
        ),
      };
    case "reject":
      return {
        kind: "decision",
        result: await env.ops.decide(
          {
            kind: "reject",
            proposalId: command.id,
            ...(command.note === undefined ? {} : { note: command.note }),
          },
          env.signal,
        ),
      };
    case "edit":
      return {
        kind: "decision",
        result: await env.ops.decide(
          { kind: "edit", proposalId: command.id, revision: command.revision, body: command.body },
          env.signal,
        ),
      };
    case "revert":
      return {
        kind: "decision",
        result: await env.ops.decide({ kind: "revert", proposalId: command.id }, env.signal),
      };
    case "review":
      if (command.cancel) return env.cancelReview();
      return env.threadId === null
        ? { kind: "usage", text: "/learning review needs a conversation" }
        : env.startReview(env.threadId);
    default:
      return assertNever(command, "LearningCommand");
  }
}

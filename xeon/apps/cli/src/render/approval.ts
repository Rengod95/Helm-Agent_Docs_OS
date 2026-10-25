import type { ApprovalRespondParams, ApprovalRespondResult } from "@xeon/contracts/wire";
import type { ApprovalView, QuestionView, RememberChoice } from "./ops.ts";

// L4.cli.spec §4.11. 승인 프롬프트. 줄 입력으로 허용·거부·답을 받아 approval.respond 인자로 바꾼다.
// 질문(question)은 QuestionAnswer, 계획(plan)의 허용은 PlanAnswer, 거부는 DenyAnswer가 정본 모양이다(F wire §3.3.1).

/** approval.respond에서 approvalId를 뺀 부분 */
export type ApprovalResponse = Omit<ApprovalRespondParams, "approvalId">;

/** 승인 프롬프트가 쓰는 입출력. CliIo의 부분이다 */
export interface PromptIo {
  /** EOF(Ctrl+D)나 중단이면 null이다 */
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
  stdout(text: string): Promise<void>;
}

type AskOutcome =
  | { readonly kind: "answered"; readonly response: ApprovalResponse }
  /** 다른 클라이언트가 먼저 답해 프롬프트를 닫았다 */
  | { readonly kind: "dismissed" };

const DENY_ONLY: ApprovalResponse = { decision: "deny" };

/**
 * 중단 여부. `isAborted(signal)`는 readonly라 TS가 앞선 검사의 좁힘을 await 너머로 이어 간다:
 * 대기 중에 바뀔 수 있는 값이므로 함수 호출로 다시 읽는다
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function rememberHint(remember: readonly RememberChoice[]): string {
  const parts = ["[y] 이번만 허용"];
  if (remember.includes("thread")) parts.push("[t] 이 세션 동안 허용");
  if (remember.includes("always")) parts.push("[a] 항상 허용");
  parts.push("[n] 거부");
  return parts.join("  ");
}

async function askFeedback(io: PromptIo, signal: AbortSignal): Promise<ApprovalResponse> {
  const line = await io.readLine("거부 이유 (없으면 엔터): ", signal);
  const feedback = line?.trim() ?? "";
  return feedback.length === 0 ? DENY_ONLY : { decision: "deny", answer: { feedback } };
}

/** 도구 호출 승인: 허용 범위를 고르거나 거부한다 */
async function askTool(
  view: ApprovalView,
  io: PromptIo,
  signal: AbortSignal,
): Promise<AskOutcome | "retry"> {
  const line = await io.readLine(`${rememberHint(view.remember)} > `, signal);
  if (isAborted(signal)) return { kind: "dismissed" };
  if (line === null) return { kind: "answered", response: DENY_ONLY };
  const choice = line.trim().toLowerCase();
  if (choice === "y" || choice === "yes") {
    return { kind: "answered", response: { decision: "allow", remember: "once" } };
  }
  if (choice === "t" && view.remember.includes("thread")) {
    return { kind: "answered", response: { decision: "allow", remember: "thread" } };
  }
  if (choice === "a" && view.remember.includes("always")) {
    return { kind: "answered", response: { decision: "allow", remember: "always" } };
  }
  if (choice === "n" || choice === "no") {
    const denied = await askFeedback(io, signal);
    return isAborted(signal) ? { kind: "dismissed" } : { kind: "answered", response: denied };
  }
  await io.stdout("y, t, a, n 중 하나를 입력한다\n");
  return "retry";
}

/** 계획 승인: 승인하면서 다음 권한 모드를 고르거나, 거부한다 */
async function askPlan(
  nextModes: readonly string[],
  io: PromptIo,
  signal: AbortSignal,
): Promise<AskOutcome | "retry"> {
  const line = await io.readLine("[y] 승인  [n] 거부 > ", signal);
  if (isAborted(signal)) return { kind: "dismissed" };
  if (line === null) return { kind: "answered", response: DENY_ONLY };
  const choice = line.trim().toLowerCase();
  if (choice === "n" || choice === "no") {
    const denied = await askFeedback(io, signal);
    return isAborted(signal) ? { kind: "dismissed" } : { kind: "answered", response: denied };
  }
  if (choice !== "y" && choice !== "yes") {
    await io.stdout("y 또는 n을 입력한다\n");
    return "retry";
  }
  let mode: string | undefined;
  if (nextModes.length > 0) {
    const list = nextModes.map((name, index) => `${String(index + 1)}) ${name}`).join("  ");
    const picked = await io.readLine(`다음 권한 모드 ${list} (엔터는 지금 모드) > `, signal);
    if (isAborted(signal)) return { kind: "dismissed" };
    const text = picked?.trim() ?? "";
    if (text.length > 0) {
      const index = Number(text);
      mode = Number.isInteger(index) ? nextModes[index - 1] : nextModes.find((m) => m === text);
      if (mode === undefined) {
        await io.stdout(`모르는 모드: ${text}\n`);
        return "retry";
      }
    }
  }
  const noteLine = await io.readLine("메모 (없으면 엔터): ", signal);
  if (isAborted(signal)) return { kind: "dismissed" };
  const note = noteLine?.trim() ?? "";
  return {
    kind: "answered",
    response: {
      decision: "allow",
      answer: {
        ...(mode === undefined ? {} : { mode }),
        ...(note.length === 0 ? {} : { note }),
      },
    },
  };
}

function describeQuestion(question: QuestionView, index: number, total: number): string {
  const lines: string[] = [];
  const header = question.header === null ? "" : `[${question.header}] `;
  lines.push(`질문 ${String(index + 1)}/${String(total)}: ${header}${question.text}`);
  question.options.forEach((option, optionIndex) => {
    const mark = option.recommended ? " (추천)" : "";
    const detail = option.description === null ? "" : ` - ${option.description}`;
    lines.push(`  ${String(optionIndex + 1)}) ${option.label}${mark}${detail}`);
  });
  const how = [
    question.multiSelect ? "번호(여러 개는 쉼표)" : "번호",
    ...(question.allowFreeText ? ["직접 입력"] : []),
    "/deny 거부",
  ].join(", ");
  lines.push(`  입력: ${how}`);
  return `${lines.join("\n")}\n`;
}

type QuestionItem = { readonly selected: string[]; readonly text?: string };

/** 질문 하나의 답을 읽는다. 읽을 수 없는 입력이면 undefined(다시 묻는다), 거부면 "deny" */
function parseQuestionInput(
  question: QuestionView,
  text: string,
): QuestionItem | "deny" | undefined {
  if (text === "/deny") return "deny";
  const tokens = text
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const numbers = tokens.map((token) => (/^\d+$/.test(token) ? Number(token) : Number.NaN));
  const allNumbers = tokens.length > 0 && numbers.every((n) => Number.isInteger(n));
  if (allNumbers) {
    const picked: string[] = [];
    for (const n of numbers) {
      const option = question.options[n - 1];
      if (option === undefined) return undefined;
      picked.push(option.id);
    }
    if (!question.multiSelect && picked.length > 1) return undefined;
    return { selected: picked };
  }
  if (question.allowFreeText && text.length > 0) return { selected: [], text };
  return undefined;
}

async function askQuestions(
  questions: readonly QuestionView[],
  io: PromptIo,
  signal: AbortSignal,
): Promise<AskOutcome> {
  const answers: Record<string, QuestionItem> = {};
  for (const [index, question] of questions.entries()) {
    // 질문은 차례로 묻는다. 앞 답이 끝나야 다음 질문을 보인다
    // oxlint-disable-next-line no-await-in-loop -- 한 번에 한 질문씩 사람에게 묻는다 (L4.cli.spec §4.11)
    await io.stdout(describeQuestion(question, index, questions.length));
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 입력이 올바를 때까지 같은 질문을 다시 묻는다 (L4.cli.spec §4.11)
      const line = await io.readLine("> ", signal);
      if (isAborted(signal)) return { kind: "dismissed" };
      if (line === null) return { kind: "answered", response: DENY_ONLY };
      const parsed = parseQuestionInput(question, line.trim());
      if (parsed === "deny") return { kind: "answered", response: DENY_ONLY };
      if (parsed !== undefined) {
        answers[question.id] = parsed;
        break;
      }
      // oxlint-disable-next-line no-await-in-loop -- 잘못된 입력을 알린 뒤 다시 묻는다 (L4.cli.spec §4.11)
      await io.stdout("읽을 수 없는 입력이다. 다시 입력한다\n");
    }
  }
  return { kind: "answered", response: { decision: "answer", answer: answers } };
}

/** 승인 요청 하나를 사람에게 묻는다. 요청 제목과 본문은 트랜스크립트가 이미 보였다 */
async function askApproval(
  view: ApprovalView,
  io: PromptIo,
  signal: AbortSignal,
): Promise<AskOutcome> {
  const { form } = view;
  if (form.kind === "question") return askQuestions(form.questions, io, signal);
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 알아듣는 입력이 올 때까지 같은 질문을 다시 묻는다 (L4.cli.spec §4.11)
    const outcome = await (form.kind === "tool"
      ? askTool(view, io, signal)
      : askPlan(form.nextModes, io, signal));
    if (outcome !== "retry") return outcome;
  }
}

/** 세션이 승인 요청을 넘기는 곳. 프롬프트(대화형)와 자동 거부(print)가 같은 모양이다 */
export interface ApprovalSink {
  /** approval.requested가 왔다. 같은 approvalId는 한 번만 다룬다. 기다리지 않는다 */
  offer(view: ApprovalView): void;
  /** approval.resolved가 왔다. 열린 프롬프트를 닫는다 */
  resolved(approvalId: string): void;
  /** 지금까지 넘어온 승인의 처리가 끝나기를 기다린다 */
  idle(): Promise<void>;
  /** 새 승인이 넘어왔을 때 부를 함수를 등록한다. 입력 대기가 프롬프트에 자리를 내주는 데 쓴다 */
  onOffer(listener: () => void): () => void;
  /** 열린 프롬프트를 모두 닫는다 */
  dispose(): void;
}

/** 응답이 적용되지 않은 이유 중 다시 보내도 같은 것. `answer_invalid`와 `commit_failed`는 다시 입력해 보낼 수 있어 여기에 없다 */
export type SupersededReason = "already_resolved" | "unknown_approval" | "unspecified";

export interface PrompterOptions {
  readonly io: PromptIo;
  readonly respond: (
    approvalId: string,
    response: ApprovalResponse,
  ) => Promise<ApprovalRespondResult>;
  /** 응답 전송이 실패했다(연결 끊김 등). 알리고 계속한다 */
  readonly onError: (approvalId: string, cause: unknown) => void;
  /** 다른 클라이언트가 먼저 답했거나 이미 처리된 승인이다. 이유를 알리지 않는 호스트는 `unspecified`다 */
  readonly onSuperseded: (approvalId: string, reason: SupersededReason) => void;
}

/** 적용되지 않은 응답을 다시 입력받는 횟수 상한. 기록 실패가 계속되면 승인은 대기로 남기고 포기한다 */
const MAX_REASKS = 3;

/** 다시 입력해 보낼 수 있는 이유(answer_invalid, commit_failed)를 사람이 읽는 줄로 */
function notAppliedText(result: ApprovalRespondResult): string {
  if (result.reason === "commit_failed") return "승인 응답을 기록하지 못했다. 다시 입력한다\n";
  const detail = result.detail === undefined ? "" : `: ${result.detail}`;
  return `응답이 요청과 맞지 않다${detail}. 다시 입력한다\n`;
}

/** 대화형 프롬프트. 한 번에 하나만 묻고(입력이 하나뿐이다) 나머지는 줄을 세운다 */
export function createApprovalPrompter(options: PrompterOptions): ApprovalSink {
  const seen = new Set<string>();
  const closed = new Set<string>();
  const active = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const state: { chain: Promise<void>; disposed: boolean } = {
    chain: Promise.resolve(),
    disposed: false,
  };

  /**
   * 한 번 묻고 보낸다. 적용되지 않았을 때 이유로 가른다(F wire §3.3.1 approval.respond):
   * `answer_invalid`는 요청이 아직 대기 중이라 응답을 고쳐 다시 보낼 수 있고, `commit_failed`는 기록에 실패해 같은 요청이 남아 있다.
   * 둘은 이유를 알리고 다시 묻는다(상한 {@link MAX_REASKS}). 그 밖은 다시 보내도 같아서 프롬프트를 닫는다
   */
  const handle = async (view: ApprovalView): Promise<void> => {
    if (state.disposed || closed.has(view.approvalId)) return;
    const controller = new AbortController();
    active.set(view.approvalId, controller);
    try {
      for (let attempt = 0; ; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 적용되지 않은 응답은 같은 질문을 다시 묻는다 (L4.cli.spec §4.11)
        const outcome = await askApproval(view, options.io, controller.signal);
        if (outcome.kind === "dismissed" || closed.has(view.approvalId)) {
          options.onSuperseded(view.approvalId, "unspecified");
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- 응답이 적용됐는지 보고 다음 동작을 정한다 (L4.cli.spec §4.11)
        const sent = await options.respond(view.approvalId, outcome.response);
        if (sent.applied) return;
        if (sent.reason !== "answer_invalid" && sent.reason !== "commit_failed") {
          options.onSuperseded(view.approvalId, sent.reason ?? "unspecified");
          return;
        }
        if (attempt + 1 >= MAX_REASKS) {
          // oxlint-disable-next-line no-await-in-loop -- 포기를 알린 뒤 끝낸다 (L4.cli.spec §4.11)
          await options.io.stdout("응답이 계속 적용되지 않아 이 승인은 대기로 남긴다\n");
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- 이유를 알린 뒤 다시 묻는다 (L4.cli.spec §4.11)
        await options.io.stdout(notAppliedText(sent));
      }
    } catch (caught) {
      options.onError(view.approvalId, caught);
    } finally {
      active.delete(view.approvalId);
    }
  };

  return {
    offer(view) {
      if (seen.has(view.approvalId)) return;
      seen.add(view.approvalId);
      state.chain = state.chain.then(() => handle(view));
      for (const listener of Array.from(listeners)) listener();
    },
    onOffer(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolved(approvalId) {
      closed.add(approvalId);
      active.get(approvalId)?.abort();
    },
    idle: () => state.chain,
    dispose() {
      state.disposed = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}

/** print 모드: 프롬프트를 열 수 없으므로 거부로 답한다(§4.11 4번) */
export function createAutoDeny(options: {
  readonly respond: PrompterOptions["respond"];
  readonly onResult: (
    view: ApprovalView,
    outcome: "denied" | "failed" | { readonly notApplied: string },
  ) => Promise<void>;
}): ApprovalSink {
  const seen = new Set<string>();
  const state: { chain: Promise<void> } = { chain: Promise.resolve() };
  return {
    offer(view) {
      if (seen.has(view.approvalId)) return;
      seen.add(view.approvalId);
      const work = options.respond(view.approvalId, DENY_ONLY).then(
        (sent) =>
          sent.applied
            ? options.onResult(view, "denied")
            : options.onResult(view, { notApplied: sent.reason ?? "unspecified" }),
        // 응답 수단이 없는 host면 거부 응답이 가지 않았음을 알림에 밝힌다
        () => options.onResult(view, "failed"),
      );
      state.chain = state.chain.then(() => work);
    },
    resolved() {
      // 자동 거부는 열린 프롬프트가 없다
    },
    onOffer() {
      // 자동 거부는 입력을 쓰지 않는다
      return () => undefined;
    },
    idle: () => state.chain,
    dispose() {
      // 정리할 것이 없다
    },
  };
}

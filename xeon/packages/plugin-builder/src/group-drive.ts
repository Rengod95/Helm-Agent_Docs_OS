import { parse } from "@fresnel/contracts";
import type {
  AskCard,
  DriveCommand,
  DriveStep,
  PostItem,
  StepResult,
} from "@fresnel/contracts/extensions";
import type { DevkitService } from "@fresnel/contracts/services";
import { Type } from "typebox";
import { INITIAL_AUTHORING_STATE, sessionOpen, type AuthoringState } from "./group-state.ts";
import { confirmCard, confirmedYes, packConfirmation } from "./confirm.ts";

// 맡기기 입력(drive-isolation.md 2.2, 2.6). 다른 플러그인(Helm)이 `handoff`로 `{ purpose, id }`를 싣는다. `id`는 맡긴 쪽의 요청 id다.
const HandoffInputSchema = Type.Object({
  purpose: Type.String({ minLength: 1, maxLength: 500 }),
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});

// L3.authoring.spec §4.1 drive, drive-isolation.md §1.1·§1.4(B-5, B-8). 단계 함수다: 커밋된 상태와 직전 결과(`last`)만 보고
// 명령 하나를 고른다. 클로저에 진행 상태를 두지 않으므로 같은 단계가 재시작 뒤 다시 돌아도 같은 명령이 나온다.
// - 사용자 메시지는 `turn`으로 처리한다(B-5).
// - 사람 확인은 `ask` 명령이다. 답은 다음 단계의 `last`로 온다. 답이 없으면 같은 requestId로 같은 `ask`를 다시 낸다
//   (기록된 답을 돌려주므로 재시작해도 안전하다). 답이 `yes`가 아니면 파일을 쓰는 호출을 하지 않는다.
// - 확인 결과를 모델에 알리는 followUp은 `g.post`로, 상태는 `commit` 명령으로 남긴다.
// - 할 일이 없을 때: 세션이 열려 있으면 `yield`(상주), 닫혀 있고 확인도 없으면 `done`(상태가 바뀌기 전까지 후보가 아니다).
// 진행은 커밋된 상태로만 정한다(재생 규율). 답을 기다리는 동안 drive 락은 엔진이 반납한다(X-17).

export interface DriveApi {
  post(
    item: PostItem,
    options: { readonly when: "next" | "followUp"; readonly requestId: string },
  ): Promise<unknown>;
}

/** 직전 결과가 이 단계가 낸 확인의 답인가. `yes`, 그 밖의 답(`no`), 답이 아님(`none`: 처음이거나 다른 명령의 결과) */
type Answer = "yes" | "no" | "none";

function answerOf(last: StepResult | null): Answer {
  if (last === null) return "none";
  if (last.kind === "ask") {
    if (last.answer !== "answered") return "no";
    return confirmedYes(last.value) ? "yes" : "no";
  }
  if (last.kind === "denied") return "no";
  return "none";
}

function notice(content: string): PostItem {
  return { kind: "context", customType: "grp.authoring.notice.status", content, display: true };
}

function requestKey(state: Readonly<AuthoringState>, what: string): string {
  return `authoring:${what}:${state.name ?? ""}:${String(state.askRound)}`.slice(0, 64);
}

/**
 * 할 일이 없을 때의 명령. 세션이 열려 있거나 확인이 남았거나 intent 확인을 기다리면 상주하고(`yield`), 아니면 물러난다.
 * 비상주 세션은 검토함으로 보낸 뒤 물러난다(`done`). 상주 세션은 `authoring_stop`이 닫을 때까지 `done`하지 않는다 (M5c §4.8.6)
 */
const restOf = (state: Readonly<AuthoringState>): DriveCommand<AuthoringState> => {
  if (state.submitted !== null && !state.resident) return { do: "done" };
  const waiting =
    sessionOpen(state) ||
    state.pending !== null ||
    (state.phase === "intent" && !state.intentConfirmed && state.name !== null);
  return waiting ? { do: "yield" } : { do: "done" };
};

/**
 * 상주 대화에서 검토함으로 보낸 뒤 사용자가 다시 말한 것은 같은 플러그인을 고치는 새 판이다. 이름, 폴더, 파일은 그대로 두고
 * 뼈대 다음 단계(`compose`)부터 다시 한다. 검토 흔적(시험, 묶기, 제출)은 지운다
 */
function nextIteration(state: Readonly<AuthoringState>): AuthoringState {
  return {
    ...state,
    phase: "compose",
    pending: null,
    denied: null,
    trial: null,
    packaged: null,
    submitted: null,
    lastErrorKey: null,
    sameErrorRuns: 0,
  };
}

/** 상태를 남기고 그 뒤 할 일을 정한다. 상태 판이 바뀌므로 물러난 뒤에도 다음 판에서 다시 본다 */
const commitThen = (next: AuthoringState): DriveCommand<AuthoringState> => ({
  do: "commit",
  state: next,
  next: restOf(next),
});

const askOf = (requestId: string, card: AskCard): DriveCommand<AuthoringState> => ({
  do: "ask",
  card,
  requestId,
});

export function authoringDrive(g: DriveApi, devkit: DevkitService): DriveStep<AuthoringState> {
  const tell = (state: Readonly<AuthoringState>, what: string, text: string) =>
    g.post(notice(`[authoring] ${text}`), {
      when: "next",
      requestId: `${requestKey(state, what)}:n`.slice(0, 64),
    });

  // 사람이 답한 뒤 턴이 끊긴 채 멈추지 않게, 답의 결과를 모델에 알리는 followUp 입력으로 같은 흐름이 이어지게 한다
  const resume = (state: Readonly<AuthoringState>, what: string, text: string) =>
    g.post(
      {
        kind: "context",
        customType: "grp.authoring.notice.status",
        content: `[authoring] ${text}`,
        display: false,
      },
      { when: "followUp", requestId: `${requestKey(state, what)}:r`.slice(0, 64) },
    );

  const intentStep = async (
    state: Readonly<AuthoringState>,
    name: string,
    answer: Answer,
  ): Promise<DriveCommand<AuthoringState>> => {
    if (answer === "none")
      return askOf(
        requestKey(state, "intent"),
        confirmCard(`플러그인 "${name}"을 ${state.dir ?? ""}에 만들까요?`),
      );
    if (answer === "yes") {
      await resume(
        state,
        "intent",
        "the user confirmed the kind and the name: continue without asking through authoring_trial",
      );
      const next: AuthoringState = { ...state, phase: "compose", intentConfirmed: true };
      return commitThen(next);
    }
    await tell(
      state,
      "intent",
      "the user did not confirm the kind and the name: the session was closed",
    );
    await resume(state, "intent", "the user did not confirm: ask what they want to change");
    return commitThen({ ...INITIAL_AUTHORING_STATE, askRound: state.askRound + 1 });
  };

  const fixStep = async (
    state: Readonly<AuthoringState>,
    answer: Answer,
  ): Promise<DriveCommand<AuthoringState>> => {
    if (answer === "none")
      return askOf(
        requestKey(state, "fix"),
        confirmCard("여러 번 고쳐도 같은 오류가 남아 있어요. 계속 고칠까요?"),
      );
    if (answer === "yes") {
      const next: AuthoringState = { ...state, pending: null, sameErrorRuns: 0 };
      await resume(state, "fix", "the user wants to keep fixing: continue with authoring_validate");
      return commitThen(next);
    }
    // 상주 대화는 `authoring_stop`이 끝낼 때까지 열어 둔다. 고치기를 그만둔 것은 세션을 닫는 일이 아니다
    const next: AuthoringState = {
      ...state,
      pending: null,
      phase: state.resident ? "fix" : "done",
    };
    await resume(
      state,
      "fix",
      state.resident
        ? "the user stopped fixing: ask what to do next"
        : "the user stopped fixing: the session is done",
    );
    return commitThen(next);
  };

  const trialStep = async (
    state: Readonly<AuthoringState>,
    answer: Answer,
  ): Promise<DriveCommand<AuthoringState>> => {
    if (answer === "none")
      return askOf(
        requestKey(state, "trial"),
        confirmCard("만든 확장을 테스트로 돌려 볼까요? 모델을 써서 비용이 들어요."),
      );
    if (answer === "no") {
      const next: AuthoringState = { ...state, pending: null, denied: "trial" };
      await resume(state, "trial", "the user declined the Test run");
      return commitThen(next);
    }
    if (state.dir === null) return { do: "yield" };
    const started = await devkit.testRun({ dir: state.dir });
    if (started.ok) {
      const next: AuthoringState = {
        ...state,
        pending: null,
        trial: { threadId: started.value.threadId },
      };
      await resume(state, "trial", "the Test run started");
      return commitThen(next);
    }
    await tell(
      state,
      "trial",
      `the Test run did not start: ${started.error.kind} ${started.error.message}`,
    );
    await resume(state, "trial", "the Test run did not start");
    return commitThen({ ...state, pending: null });
  };

  const packageStep = async (
    state: Readonly<AuthoringState>,
    answer: Answer,
  ): Promise<DriveCommand<AuthoringState>> => {
    if (state.dir === null) return { do: "yield" };
    const dir = state.dir;
    const confirm = packConfirmation(dir, state.askRound);
    if (answer === "none") return askOf(confirm.requestId, confirm.card);
    if (answer === "no") {
      const next: AuthoringState = { ...state, pending: null, denied: "package" };
      await resume(state, "package", "the user declined packing");
      return commitThen(next);
    }
    const packed = await devkit.pack({
      dir,
      ...(state.packOut === null ? {} : { out: state.packOut }),
    });
    if (packed.ok) {
      const next: AuthoringState = {
        ...state,
        pending: null,
        phase: "package",
        packaged: {
          path: packed.value.path,
          sha256: packed.value.sha256,
          files: packed.value.files.length,
        },
      };
      await resume(
        state,
        "package",
        "the extension was packed: the user may keep the bundle, or send the folder with authoring_submit",
      );
      return commitThen(next);
    }
    if (packed.error.kind === "denied") {
      const next: AuthoringState = { ...state, pending: null, denied: "package" };
      await resume(state, "package", "the user declined packing");
      return commitThen(next);
    }
    await tell(state, "package", `packaging failed: ${packed.error.kind} ${packed.error.message}`);
    await resume(state, "package", "packing failed");
    return commitThen({ ...state, pending: null });
  };

  /**
   * 맡겨진 호출(`frame.calledBy`)은 목적을 상태에 싣고 세션을 연 뒤 `accepted: true`로 곧 돌려준다(`done`).
   * 맡긴 쪽(Helm)은 이 결과를 기다리므로 상주하지 않는다: 상주하면 맡긴 `/helm` 명령이 제작이 끝날 때까지 멈춘다 (drive-isolation.md §2.1, §2.6).
   * 그래서 `accepted`는 "세션을 열었다"는 뜻이다. 열린 세션은 상태에 남아 `authoring_*` 도구가 이어 받고, 제작 대화(`craft`)는 시작 Drive로 상주한다.
   * 열린 세션이나 읽을 수 없는 입력은 받지 않고 사유와 함께 물러난다
   */
  const handoffStep = async (
    state: Readonly<AuthoringState>,
    calledBy: string,
    input: unknown,
  ): Promise<DriveCommand<AuthoringState>> => {
    if (sessionOpen(state))
      return { do: "done", result: { accepted: false, reason: "session_open" } };
    const read = parse(HandoffInputSchema, input);
    if (!read.ok) return { do: "done", result: { accepted: false, reason: "bad_input" } };
    const { purpose, id } = read.value;
    await g.post(
      {
        kind: "context",
        customType: "grp.authoring.notice.status",
        content: `[authoring] ${calledBy}가 맡김, authoring_start로 시작(모델 도구나 자체 화면이 필요하면 뼈대는 app, 훅이 아님): ${purpose}`,
        display: true,
      },
      // followUp이라 대화가 한가하면 바로 모델 턴이 열린다. next로 두면 다음 사용자 말까지 대기 메시지로 쌓인다(F-11)
      { when: "followUp", requestId: `authoring:handoff:${id ?? purpose}`.slice(0, 64) },
    );
    // 이름과 폴더는 아직 없다. 목적만 든 세션이고, 사용자에게 이름과 폴더를 정한 뒤 `authoring_start`로 시작한다
    const opened: AuthoringState = {
      ...INITIAL_AUTHORING_STATE,
      askRound: state.askRound,
      phase: "intent",
      sessionId: `auth-handoff-${id ?? "purpose"}`,
      purpose,
    };
    return {
      do: "commit",
      state: opened,
      next: { do: "done", result: { accepted: true, purpose } },
    };
  };

  return async ({ state, last, frame }): Promise<DriveCommand<AuthoringState>> => {
    // 맡겨진 첫 단계: 사용자 메시지와 달리 이 호출은 턴을 열지 않고 답하고 물러난다
    if (frame.calledBy !== null && last === null)
      return handoffStep(state, frame.calledBy, frame.input);
    // B-5: 사용자 메시지는 이 단계에서 턴으로 처리한다. 세션이 닫혀 있어도 메시지를 버리지 않는다
    if (last?.kind === "user") {
      // 상주 대화에서 검토함으로 보낸 뒤의 말은 같은 플러그인의 새 판이다(엔진 설계 §1.4)
      if (state.resident && state.submitted !== null)
        return {
          do: "commit",
          state: nextIteration(state),
          next: { do: "turn", input: last.message },
        };
      return { do: "turn", input: last.message };
    }
    const answer = answerOf(last);
    if (state.phase === "intent" && !state.intentConfirmed && state.name !== null)
      return intentStep(state, state.name, answer);
    if (state.pending === null) return restOf(state);
    if (state.pending === "fix_limit") return fixStep(state, answer);
    if (state.pending === "trial") return trialStep(state, answer);
    // 남은 요청은 묶기뿐이다(`fix_limit`·`trial`을 위에서 뺐다)
    return packageStep(state, answer);
  };
}

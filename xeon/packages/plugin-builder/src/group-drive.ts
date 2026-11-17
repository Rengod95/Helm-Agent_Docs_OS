import type {
  AskCard,
  DriveCommand,
  DriveStep,
  PostItem,
  StepResult,
} from "@fresnel/contracts/extensions";
import type { DevkitService } from "@fresnel/contracts/services";
import { INITIAL_AUTHORING_STATE, sessionOpen, type AuthoringState } from "./group-state.ts";
import { confirmCard, confirmedYes, packConfirmation } from "./confirm.ts";

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

/** 확인 카드에 쓰는 종류 이름 */
function kindLabelOf(kind: AuthoringState["kind"]): string {
  return kind === "plugin-group" ? "플러그인 그룹" : "플러그인";
}

function requestKey(state: Readonly<AuthoringState>, what: string): string {
  return `authoring:${what}:${state.name ?? ""}:${String(state.askRound)}`.slice(0, 64);
}

/** 할 일이 없을 때의 명령. 세션이 열려 있거나 확인이 남았거나 intent 확인을 기다리면 상주하고, 아니면 물러난다 */
const restOf = (state: Readonly<AuthoringState>): DriveCommand<AuthoringState> => {
  const waiting =
    sessionOpen(state) ||
    state.pending !== null ||
    (state.phase === "intent" && !state.intentConfirmed && state.name !== null);
  return waiting ? { do: "yield" } : { do: "done" };
};

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
        confirmCard(`${kindLabelOf(state.kind)} "${name}"을 ${state.dir ?? ""}에 만들까요?`),
      );
    if (answer === "yes") {
      await resume(
        state,
        "intent",
        "the user confirmed the kind and the name: continue with authoring_compose and authoring_scaffold",
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
    return commitThen(INITIAL_AUTHORING_STATE);
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
    const next: AuthoringState = { ...state, pending: null, phase: "done" };
    await resume(state, "fix", "the user stopped fixing: the session is done");
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
    const started = await devkit.testRun({ target: state.dir });
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

  return async ({ state, last }): Promise<DriveCommand<AuthoringState>> => {
    // B-5: 사용자 메시지는 이 단계에서 턴으로 처리한다. 세션이 닫혀 있어도 메시지를 버리지 않는다
    if (last?.kind === "user") return { do: "turn", input: last.message };
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

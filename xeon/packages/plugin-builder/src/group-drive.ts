import type { AskCard, DriveFn, PostItem } from "@fresnel/contracts/extensions";
import type { DevkitService } from "@fresnel/contracts/services";
import { INITIAL_AUTHORING_STATE, type AuthoringState } from "./group-state.ts";
import { installWithConfirmation, packWithConfirmation, type Ask } from "./release.ts";

// L3.authoring.spec §4.1 drive. 도구가 커밋한 요청(`pending`)과 intent 확인만 처리한다. 진행은 커밋된 상태로만 정한다(재생 규율).
// 사람 확인은 `loop.ask`이고, 기다리는 동안 drive 락이 반납된다(X-17). 답이 오면 같은 상태로 다시 불려 같은 requestId가 기록된 답을 돌려준다.

export interface DriveApi {
  commit(next: AuthoringState): Promise<unknown>;
  post(
    item: PostItem,
    options: { readonly when: "next" | "followUp"; readonly requestId: string },
  ): Promise<unknown>;
}

function notice(content: string): PostItem {
  return { kind: "context", customType: "grp.authoring.notice.status", content, display: true };
}

function confirmCard(text: string): AskCard {
  return {
    questions: [
      {
        id: "confirm",
        text,
        options: [
          { id: "yes", label: "예", recommended: true },
          { id: "no", label: "아니요" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  };
}

/** 확인 카드에 쓰는 종류 이름 */
function kindLabelOf(kind: AuthoringState["kind"]): string {
  return kind === "plugin-group" ? "플러그인 그룹" : "플러그인";
}

function requestKey(state: Readonly<AuthoringState>, what: string): string {
  return `authoring:${what}:${state.name ?? ""}:${String(state.askRound)}`.slice(0, 64);
}

export function authoringDrive(g: DriveApi, devkit: DevkitService): DriveFn<AuthoringState> {
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

  return async (loop, st) => {
    const ask: Ask = (request) => loop.ask(request);
    if (st.phase === "intent" && !st.intentConfirmed && st.name !== null) {
      const outcome = await loop.ask({
        requestId: requestKey(st, "intent"),
        card: confirmCard(`${kindLabelOf(st.kind)} "${st.name}"을 ${st.dir ?? ""}에 만들까요?`),
      });
      const yes =
        outcome.status === "answered" &&
        outcome.answer["confirm"]?.selected.includes("yes") === true;
      if (yes) {
        await g.commit({ ...st, phase: "compose", intentConfirmed: true });
        await resume(
          st,
          "intent",
          "the user confirmed the kind and the name: continue with authoring_compose and authoring_scaffold",
        );
      } else {
        await g.commit({ ...INITIAL_AUTHORING_STATE });
        await tell(
          st,
          "intent",
          "the user did not confirm the kind and the name: the session was closed",
        );
        await resume(st, "intent", "the user did not confirm: ask what they want to change");
      }
      return;
    }
    if (st.pending === null) return;
    if (st.pending === "fix_limit") {
      const outcome = await loop.ask({
        requestId: requestKey(st, "fix"),
        card: confirmCard("여러 번 고쳐도 같은 오류가 남아 있어요. 계속 고칠까요?"),
      });
      const yes =
        outcome.status === "answered" &&
        outcome.answer["confirm"]?.selected.includes("yes") === true;
      await g.commit(
        yes ? { ...st, pending: null, sameErrorRuns: 0 } : { ...st, pending: null, phase: "done" },
      );
      await resume(
        st,
        "fix",
        yes
          ? "the user wants to keep fixing: continue with authoring_validate"
          : "the user stopped fixing: the session is done",
      );
      return;
    }
    if (st.pending === "trial") {
      const outcome = await loop.ask({
        requestId: requestKey(st, "trial"),
        card: confirmCard("만든 확장을 테스트로 돌려 볼까요? 모델을 써서 비용이 들어요."),
      });
      const yes =
        outcome.status === "answered" &&
        outcome.answer["confirm"]?.selected.includes("yes") === true;
      if (!yes) {
        await g.commit({ ...st, pending: null, denied: "trial" });
        await resume(st, "trial", "the user declined the Test run");
        return;
      }
      if (st.dir === null) return;
      const started = await devkit.testRun({ target: st.dir });
      if (started.ok) {
        await g.commit({ ...st, pending: null, trial: { threadId: started.value.threadId } });
        await resume(st, "trial", "the Test run started");
      } else {
        await g.commit({ ...st, pending: null });
        await tell(
          st,
          "trial",
          `the Test run did not start: ${started.error.kind} ${started.error.message}`,
        );
        await resume(st, "trial", "the Test run did not start");
      }
      return;
    }
    if (st.pending === "package") {
      if (st.dir === null) return;
      const packed = await packWithConfirmation(
        devkit,
        ask,
        { dir: st.dir, ...(st.packOut === null ? {} : { out: st.packOut }) },
        st.askRound,
      );
      if (packed.ok) {
        await g.commit({
          ...st,
          pending: null,
          phase: "package",
          packaged: {
            path: packed.value.path,
            sha256: packed.value.sha256,
            files: packed.value.files.length,
          },
        });
        await resume(st, "package", "the extension was packed: continue with authoring_install");
      } else if (packed.error.kind === "denied") {
        await g.commit({ ...st, pending: null, denied: "package" });
        await resume(st, "package", "the user declined packing");
      } else {
        await g.commit({ ...st, pending: null });
        await tell(st, "package", `packaging failed: ${packed.error.kind} ${packed.error.message}`);
        await resume(st, "package", "packing failed");
      }
      return;
    }
    // install
    if (st.packaged === null) return;
    const linked = await installWithConfirmation(devkit, ask, st.packaged.path, st.askRound);
    if (linked.ok) {
      await g.commit({
        ...st,
        pending: null,
        phase: "done",
        installed: {
          name: linked.value.name,
          version: linked.value.version,
          location: linked.value.location,
        },
      });
      await resume(st, "install", "the extension was installed");
    } else if (linked.error.kind === "denied") {
      await g.commit({ ...st, pending: null, denied: "install" });
      await resume(st, "install", "the user declined installing");
    } else {
      await g.commit({ ...st, pending: null });
      await tell(st, "install", `installing failed: ${linked.error.kind} ${linked.error.message}`);
      await resume(st, "install", "installing failed");
    }
  };
}

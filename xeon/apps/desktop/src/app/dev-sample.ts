// 개발 빌드 전용 "표본 상태 보기"(lcMk2, Linear AGE-53). 실제 키·대기 승인이 없어도 확인 대기 표시(크리스탈, DP-223)를 묶은 앱에서 보려고
// 화면이 읽는 거울 면에 표본을 겹친다: 확인이 필요한 대화 둘(하나는 시한이 있는 승인), 기다리는 제안 둘(받은 요청 카드 하나가 따라 나온다).
// 승인 카드 세 종류(질문, 도구, 변경 검토)가 하나씩 있어 종류마다 다른 오로라 빛깔 조합을 한 화면에서 볼 수 있다(lcMk4).
// 엔진 상태와 엔진 연결은 건드리지 않는다(앱 안 감시자들은 겹치지 않은 거울을 읽는다). 표본 대화를 열거나 표본 승인에 답하면 엔진이 모르는 id라
// 실패한다(보기 전용). 정식 빌드(`BUILD_CHECKS` false)에서는 켜지지 않고 단축키도 걸리지 않는다.
// 켜고 끄기: ⌘⌥⇧S(macOS, 다른 OS는 Ctrl+Alt+Shift+S). 값은 이 창의 localStorage에 두고 창을 다시 읽는다.

import { t } from "@fresnel/client/i18n";
import { assertNever, attempt } from "@fresnel/contracts";
import { isId, type EventId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { LiveApprovalRequest } from "../state/engine/input.ts";
import type { EngineMirror, PendingApproval } from "../state/engine/state.ts";
import type { ReadonlyStore } from "../state/shared/readonly-store.ts";
import { BUILD_CHECKS } from "./build.ts";

/** localStorage 키. 값 "1"이면 켜짐 */
export const SAMPLE_STATE_KEY = "fresnel.dev.sampleState";
/** 표본 제안 수(받은 요청 카드와 내비 "제안" 줄) */
export const SAMPLE_PROPOSALS = 2;

/** 표본 승인의 종류: 질문, 도구(명령 실행), 변경 검토 */
type SampleKind = "question" | "tool" | "review";

/** 표본 대화: id 꼬리, 제목 키, 시한 여부, 기다리는 승인들의 종류(차례대로) */
const THREADS: readonly {
  readonly tail: string;
  readonly title: "desktop.dev.sample.threadDeploy" | "desktop.dev.sample.threadReadme";
  readonly urgent: boolean;
  readonly kinds: readonly SampleKind[];
}[] = [
  {
    tail: "SAMP01",
    title: "desktop.dev.sample.threadDeploy",
    urgent: false,
    kinds: ["question", "tool"],
  },
  {
    tail: "SAMP02",
    title: "desktop.dev.sample.threadReadme",
    urgent: true,
    kinds: ["review"],
  },
];

const threadIdOf = (tail: string): ThreadId | null => {
  const value = `thr_${"0".repeat(20)}${tail}`;
  return isId("thr", value) ? value : null;
};
const eventIdOf = (tail: string, n: number): EventId | null => {
  const value = `evt_${"0".repeat(19)}${tail}${String(n)}`;
  return isId("evt", value) ? value : null;
};

/** 표본 도구 승인: 배포 명령 실행(쓰기 등급) */
const SAMPLE_TOOL = {
  kind: "tool",
  tool: {
    toolName: "bash",
    risk: "write",
    args: { command: "bun run deploy --dry-run" },
    argsHash: "sample",
    ruleId: null,
  },
} as const;

/** 표본 변경 검토: 파일 둘(id는 형식만 맞춘 표본 값) */
function sampleReview(): LiveApprovalRequest["body"] {
  return {
    kind: "review",
    review: {
      reviewId: "rvw_00000000000000000000SAMPRV",
      artifactId: "art_00000000000000000000SAMPAR",
      title: "README",
      round: 1,
      files: [
        { path: "README.md", change: "modified", binary: false, hunks: 3 },
        { path: "docs/README.ko.md", change: "added", binary: false, hunks: 1 },
      ],
    },
  };
}

/** 표본 질문: 자유 글 한 칸 */
function sampleQuestion(): LiveApprovalRequest["body"] {
  return {
    kind: "question",
    question: {
      questions: [
        {
          id: "q",
          text: t("desktop.dev.sample.question"),
          options: [],
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
  };
}

function sampleBody(kind: SampleKind): LiveApprovalRequest["body"] {
  switch (kind) {
    case "question":
      return sampleQuestion();
    case "tool":
      return SAMPLE_TOOL;
    case "review":
      return sampleReview();
    default:
      return assertNever(kind, "SampleKind");
  }
}

/** 거울에 표본 대화·승인을 겹친다. 이미 같은 id가 있으면 그대로 둔다(순수 함수, `now`는 시한 계산에만 쓴다) */
export function withSampleMirror(state: EngineMirror, now: number): EngineMirror {
  const byId: Record<string, ThreadSummary> = { ...state.threads.byId };
  const approvalsById: Record<string, PendingApproval> = { ...state.approvals.byId };
  const threadIds: ThreadId[] = [];
  const approvalIds: EventId[] = [];
  // 표본 대화는 실제 대화와 같은 폴더 묶음에 서게 첫 실제 대화의 폴더를 쓴다(없으면 폴더 없음)
  const first = state.threads.ids[0];
  const workspace = first === undefined ? null : (state.threads.byId[first]?.workspace ?? null);
  const stamp = new Date(now).toISOString();
  THREADS.forEach((spec, index) => {
    const threadId = threadIdOf(spec.tail);
    if (threadId === null || byId[threadId] !== undefined) return;
    threadIds.push(threadId);
    byId[threadId] = {
      threadId,
      title: t(spec.title),
      status: "idle",
      workspace,
      createdAt: stamp,
      updatedAt: stamp,
      headSeq: 0,
      forkedFrom: null,
      resumable: null,
      queuedInputs: 0,
      pendingApprovals: spec.kinds.length,
    };
    spec.kinds.forEach((kind, k) => {
      const n = k + 1;
      const approvalId = eventIdOf(spec.tail, n);
      if (approvalId === null) return;
      approvalIds.push(approvalId);
      approvalsById[approvalId] = {
        approvalId,
        threadId,
        seq: index * 10 + n,
        request: {
          origin: { threadId, turnId: null, stepId: null, toolCallId: null, caller: "main" },
          requestKey: `sample-${spec.tail}-${String(n)}`,
          title: t(spec.title),
          remember: ["once"],
          surfaceThreadId: threadId,
          requestedAt: now,
          ...(spec.urgent ? { expiresAt: now + 30 * 60_000 } : {}),
          body: sampleBody(kind),
        },
      };
    });
  });
  if (threadIds.length === 0) return state;
  return {
    ...state,
    threads: { status: "ready", ids: [...threadIds, ...state.threads.ids], byId },
    approvals: {
      ...state.approvals,
      ids: [...state.approvals.ids, ...approvalIds],
      byId: approvalsById,
    },
  };
}

/** 거울 읽기 면에 표본을 겹친 읽기 면. 같은 거울 값에는 같은 객체를 돌려준다(구독자가 매번 다시 그리지 않게) */
export function sampleView(
  read: ReadonlyStore<EngineMirror>,
  now: () => number,
): ReadonlyStore<EngineMirror> {
  let seen: EngineMirror | null = null;
  let shown: EngineMirror = read.getState();
  const view = (state: EngineMirror): EngineMirror => {
    if (state !== seen) {
      seen = state;
      shown = withSampleMirror(state, now());
    }
    return shown;
  };
  return {
    getState: () => view(read.getState()),
    getInitialState: () => withSampleMirror(read.getInitialState(), now()),
    subscribe: (listener) =>
      read.subscribe((state, previous) => {
        listener(view(state), withSampleMirror(previous, now()));
      }),
  };
}

/** 개발 빌드이고 표본 보기가 켜져 있는지 */
export function sampleStateOn(storage: () => Storage = () => localStorage): boolean {
  if (!BUILD_CHECKS) return false;
  const read = attempt(() => storage().getItem(SAMPLE_STATE_KEY));
  return read.ok && read.value === "1";
}

/** 단축키 ⌘⌥⇧S(Ctrl+Alt+Shift+S)인지. `code`로 본다(Option을 누르면 `key`가 다른 글자가 된다) */
export function isSampleToggle(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  return (
    event.code === "KeyS" && event.altKey && event.shiftKey && (mac ? event.metaKey : event.ctrlKey)
  );
}

/**
 * 개발 빌드에서만 표본 보기 단축키를 건다. 누르면 값을 뒤집고 창을 다시 읽는다. 정식 빌드에서는 아무것도 걸지 않는다.
 * 저장소를 쓰지 못하면(막힌 저장소) `onFailure`로 알리고 그대로 둔다
 */
export function installSampleToggle(deps: {
  readonly mac: boolean;
  readonly reload: () => void;
  readonly onFailure: (cause: unknown) => void;
}): () => void {
  if (!BUILD_CHECKS) return () => {};
  const onKey = (event: KeyboardEvent): void => {
    if (!isSampleToggle(event, deps.mac)) return;
    event.preventDefault();
    const next = sampleStateOn() ? "0" : "1";
    const wrote = attempt(() => {
      localStorage.setItem(SAMPLE_STATE_KEY, next);
    });
    if (!wrote.ok) {
      deps.onFailure(wrote.error.cause);
      return;
    }
    deps.reload();
  };
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("keydown", onKey);
  };
}

// 플러그인 자세히 보기의 흐름 데이터. 한 턴의 순간(MOMENTS)마다 이 플러그인이 하는 일(STEPS)과 마지막 실행의 모습(RUN)을 둔다.
// Helm의 훅은 packages/group-helm/src/manifest.ts와 index.ts의 g.on(...) 여섯 개를 따른다. 나머지 값은 모양만 맞춘 가짜다.
import { FOLD_LABEL, HOOKS, type Fold, type PhaseId } from "./data";

export type Verb = Fold | "call" | "draw";
export const VERB_LABEL: Record<Verb, string> = {
  ...FOLD_LABEL,
  call: "불려 나옴",
  draw: "그리기",
};

export interface Moment {
  id: string;
  label: string;
  phase: PhaseId | "off";
  /** 훅이 아닌 순간(도구가 실행될 때)은 null */
  fold: Fold | null;
  /** 한 턴이 시작한 뒤 몇 초째(최근 실행 레일) */
  at: number;
}

const AT: Record<string, number> = {
  "thread.start": 0,
  "input.user.before": 0.02,
  "input.agent.before": 0.05,
  "thread.compact.before": 0.28,
  "request.provider.before": 0.31,
  "guard.model.before": 0.33,
  "request.model.after": 4.8,
  "tool.call.before": 4.9,
  "tool.run": 5.0,
  "tool.result": 7.4,
  "tool.execution.after": 7.5,
  "boundary.step.after": 7.7,
  "boundary.settle.after": 13.1,
  "thread.shutdown": 14.2,
};

/** 한 턴의 순간 14개: 순서 화면의 13개 사이에 "도구가 실행될 때"가 하나 끼어 있다. 위에서 아래가 흐르는 순서다. */
export const MOMENTS: readonly Moment[] = HOOKS.flatMap((h): Moment[] => {
  const m: Moment = { id: h.id, label: h.label, phase: h.phase, fold: h.fold, at: AT[h.id] ?? 0 };
  if (h.id !== "tool.call.before") return [m];
  return [
    m,
    {
      id: "tool.run",
      label: "도구가 실행될 때",
      phase: "act",
      fold: null,
      at: AT["tool.run"] ?? 5,
    },
  ];
});
/** 턴 안의 순간이 아닌 훅(순서 화면의 나머지 훅). 이 플러그인이 걸려 있을 때만 맨 아래에 나온다. */
export const OFF_TURN: readonly Moment[] = [
  {
    id: "lifecycle.lease.rejected",
    label: "주도 요청이 거절됐을 때",
    phase: "off",
    fold: "tap",
    at: 0,
  },
];
export const momentOf = (id: string): Moment | undefined =>
  [...MOMENTS, ...OFF_TURN].find((m) => m.id === id);

/** 한 순간에서 하는 일 하나 */
export interface Step {
  at: string;
  verb: Verb;
  /** 받는 것 */
  gets: string;
  /** 정하거나 바꾸는 것 */
  does: string;
  /** 다음에 넘기는 것 */
  hands: string;
  /** 넘기는 상대(같은 그룹의 구성원 id). 열 사이 손 넘김으로 그려진다 */
  to?: string;
}

const s = (at: string, verb: Verb, gets: string, does: string, hands: string, to?: string): Step =>
  to === undefined ? { at, verb, gets, does, hands } : { at, verb, gets, does, hands, to };

export const STEPS: Record<string, Step[]> = {
  helm: [
    s(
      "thread.start",
      "tap",
      "대화에 남은 지난 탐구 기록",
      "저장된 탐구 상태를 불러와요. 바꾸는 건 없어요",
      "복원한 상태 → 이후 순간들이 읽어요",
    ),
    s(
      "input.agent.before",
      "collect",
      "일을 시작하는 메시지, 지금 탐구 단계",
      "단계에 맞는 렌즈 안내를 조각으로 덧붙여요",
      "덧붙인 조각 → 모델 입력",
    ),
    s(
      "tool.call.before",
      "first",
      "쓰려는 도구와 위험 등급",
      "확산·탐색 단계에서 쓰기 도구면 막아요. 읽기 도구는 지나가요",
      "통과, 또는 이유를 단 차단",
      "helm/explore",
    ),
    s(
      "tool.execution.after",
      "tap",
      "끝난 도구와 그 결과",
      "결과에서 발견을 뽑아 탐구 기록에 남겨요",
      "발견 기록 → Helm 화면, 기억 원장",
      "helm/panel",
    ),
    s(
      "boundary.settle.after",
      "tap",
      "끝난 턴의 상태",
      "다음 단계로 갈지 판단해요. 이어 가면 주도를 잡고 한 턴 더 돌려요",
      "다음 턴 요청, 또는 사람 확인",
      "helm/panel",
    ),
    s(
      "lifecycle.lease.rejected",
      "tap",
      "거절된 주도 요청과 이유",
      "차례 기다림에 다시 넣고 알려요",
      "기다림 기록만",
    ),
  ],
  "helm/explore": [
    s(
      "tool.run",
      "call",
      "렌즈와 질문 (lens_search 호출)",
      "렌즈마다 보조 에이전트(explorer)를 띄워 자료를 찾아와요",
      "찾은 것 → Helm에게 도구 결과로",
      "helm",
    ),
  ],
  "helm/panel": [
    s(
      "tool.execution.after",
      "draw",
      "Helm이 남긴 탐구 기록",
      "옆 패널에 렌즈별 진행을 그려요",
      "화면만. 다른 곳에 넘기지 않아요",
    ),
    s(
      "boundary.settle.after",
      "draw",
      "Helm의 판단(이어 감 / 멈춤)",
      "패널의 단계 표시를 갱신해요",
      "화면만. 다른 곳에 넘기지 않아요",
    ),
  ],
  learning: [
    s(
      "boundary.settle.after",
      "tap",
      "끝난 턴의 요약",
      "배울 만한 것이 있으면 교훈 초안을 만들어요",
      "교훈 초안 → 기억 원장",
      "learning/ledger",
    ),
    s(
      "thread.shutdown",
      "tap",
      "닫히는 대화의 남은 교훈",
      "아직 쓰지 않은 교훈을 정리해요",
      "저장 요청 → 기억 원장",
      "learning/ledger",
    ),
  ],
  "learning/ledger": [
    s(
      "boundary.settle.after",
      "call",
      "교훈 초안 (memory_write)",
      "기억에 적고 중복은 합쳐요",
      "knowledge.memory 기록",
    ),
    s(
      "thread.shutdown",
      "call",
      "마지막 교훈 묶음",
      "기억에 한꺼번에 적어요",
      "knowledge.memory 기록",
    ),
  ],
  review: [
    s(
      "boundary.settle.after",
      "tap",
      "끝난 턴에서 바뀐 파일 목록",
      "변경을 리뷰 렌즈에 보내 검토시켜요",
      "검토 요청 → 리뷰 렌즈",
      "review/lens",
    ),
  ],
  "review/lens": [
    s(
      "input.agent.before",
      "collect",
      "일을 시작하는 메시지",
      "리뷰 관점을 조각으로 덧붙여요",
      "관점 조각 → 모델 입력",
    ),
    s(
      "boundary.settle.after",
      "call",
      "바뀐 파일 목록 (reviewer 호출)",
      "보조 에이전트가 변경을 읽고 의견을 써요",
      "의견 → 리뷰 결과",
    ),
  ],
  web: [
    s(
      "tool.run",
      "call",
      "검색어, 읽을 주소 (web_search, web_fetch)",
      "웹에서 찾고 페이지를 읽어요",
      "찾은 내용 → 도구 결과",
    ),
  ],
  exa: [
    s(
      "tool.run",
      "call",
      "검색어 (exa_search)",
      "Exa로 웹을 검색해요. 웹 검색을 대체하면 이쪽이 불려요",
      "찾은 내용 → 도구 결과",
    ),
  ],
  knowledge: [
    s(
      "tool.run",
      "call",
      "찾을 말, 스킬 이름 (knowledge_search, skill_load)",
      "기억과 스킬에서 찾아요",
      "찾은 내용 → 도구 결과",
    ),
  ],
  work: [
    s(
      "tool.run",
      "call",
      "할 일 내용 (task_create)",
      "할 일을 기록하고 이어 갈 자리를 남겨요",
      "만든 할 일 → 도구 결과",
    ),
  ],
  "cost-router": [
    s(
      "request.provider.before",
      "chain",
      "보낼 요청과 모델 후보",
      "쉬운 요청이면 더 싼 모델로 바꿔요",
      "모델이 바뀐 요청",
    ),
    s("request.model.after", "tap", "모델 답과 쓴 토큰", "비용을 기록해요", "기록만"),
  ],
  "compact-keep": [
    s(
      "thread.compact.before",
      "first",
      "요약하려는 대화",
      "내장 요약 대신 결정한 것만 남기는 요약을 직접 해요",
      "요약본. 내장 요약은 건너뛰어요",
    ),
  ],
  "secret-scan": [
    s(
      "tool.call.before",
      "first",
      "도구에 넣는 값",
      "키처럼 보이는 값이 섞였으면 막아요",
      "통과, 또는 이유를 단 차단",
    ),
  ],
  "lint-on-edit": [
    s(
      "tool.execution.after",
      "tap",
      "끝난 도구(파일 편집)",
      "고친 파일에 린트를 돌려요",
      "린트 결과 → 대화에 알림",
    ),
  ],
  "notify-done": [s("boundary.settle.after", "tap", "끝난 턴", "알림을 보내요", "알림만")],
  "acme-notes": [
    s(
      "tool.result",
      "chain",
      "검색 도구의 결과",
      "사내 노트(MCP acme-wiki)에서 찾은 것을 섞어요",
      "섞은 결과",
    ),
  ],
  "pr-kit": [
    s(
      "input.user.before",
      "chain",
      "내가 입력한 말",
      "PR 주소를 알아보고 /pr 안내를 붙여요",
      "고친 입력",
    ),
  ],
};

// ── 최근 실행 ─────────────────────────────────────────────────────
export type Outcome = "ok" | "changed" | "blocked" | "failed" | "skipped";
export const OUTCOME_LABEL: Record<Outcome, string> = {
  ok: "지나감",
  changed: "고침",
  blocked: "막음",
  failed: "실패",
  skipped: "건너뜀",
};
export interface Ran {
  ms: number;
  out: Outcome;
  note: string;
  /** 실패 이유(실패일 때) */
  reason?: string;
}
const r = (ms: number, out: Outcome, note: string, reason?: string): Ran =>
  reason === undefined ? { ms, out, note } : { ms, out, note, reason };

/** 마지막 턴(14:01, "캐시 무효화 조사")에서 순간마다 일어난 일. 없는 칸은 stepRan이 단계의 fold로 채운다. */
export const RUN: Record<string, Record<string, Ran>> = {
  helm: {
    "thread.start": r(38, "ok", "탐구 기록 2건 불러옴"),
    "input.agent.before": r(21, "changed", "렌즈 안내 조각 1개 덧붙임"),
    "tool.call.before": r(4, "blocked", "edit_file을 막음 · 확산 단계에서는 쓰기 도구를 못 써요"),
    "tool.execution.after": r(14, "ok", "발견 2건 기록"),
    "boundary.settle.after": r(
      1340,
      "failed",
      "판단을 끝내지 못함",
      "한도 1.2초를 넘겼어요(1.34초). 이 훅은 실패해도 턴을 이어 가요. 다음 턴으로 안 넘어갔어요",
    ),
  },
  "helm/explore": { "tool.run": r(2380, "ok", "렌즈 3개로 자료 9건 찾음") },
  "helm/panel": {
    "tool.execution.after": r(9, "ok", "렌즈 진행 3줄 갱신"),
    "boundary.settle.after": r(6, "skipped", "Helm 판단이 없어 갱신 안 함"),
  },
  learning: {
    "boundary.settle.after": r(52, "ok", "교훈 초안 1건"),
    "thread.shutdown": r(0, "skipped", "이번 실행에는 닫힘 없음"),
  },
  "learning/ledger": {
    "boundary.settle.after": r(18, "ok", "기억 1건 적음"),
    "thread.shutdown": r(0, "skipped", "이번 실행에는 닫힘 없음"),
  },
  review: { "boundary.settle.after": r(0, "skipped", "연속 5번 실패해 자동 꺼짐이라 안 불림") },
  "review/lens": {
    "input.agent.before": r(11, "changed", "관점 조각 1개 덧붙임"),
    "boundary.settle.after": r(0, "skipped", "리뷰가 꺼져 있어 안 불림"),
  },
  "cost-router": {
    "request.provider.before": r(6, "changed", "claude-opus → claude-haiku로 바꿈"),
    "request.model.after": r(2, "ok", "비용 기록"),
  },
  "secret-scan": { "tool.call.before": r(3, "ok", "검사한 값 4개, 키 없음") },
  "lint-on-edit": { "tool.execution.after": r(640, "ok", "린트 경고 0건") },
  "notify-done": { "boundary.settle.after": r(120, "ok", "알림 1건") },
  "acme-notes": {
    "tool.result": r(
      5000,
      "failed",
      "사내 노트를 섞지 못함",
      "notes.search 응답 시간 초과(5초). 결과를 섞지 않고 그대로 넘겼어요",
    ),
  },
  "pr-kit": { "input.user.before": r(3, "ok", "PR 주소 없음, 바꾸지 않음") },
  web: { "tool.run": r(1190, "ok", "검색 1건, 페이지 2개 읽음") },
  knowledge: { "tool.run": r(220, "ok", "스킬 1개 불러옴") },
};
const BY_VERB: Record<Verb, Outcome> = {
  tap: "ok",
  collect: "changed",
  chain: "changed",
  first: "ok",
  call: "ok",
  draw: "ok",
};
export function stepRan(id: string, step: Step): Ran {
  const hit = RUN[id]?.[step.at];
  if (hit !== undefined) return hit;
  return { ms: 12, out: BY_VERB[step.verb], note: "실행됨" };
}

// ── 설정 ──────────────────────────────────────────────────────────
export const SETTINGS: Record<string, readonly (readonly [string, string])[]> = {
  helm: [
    ["주도 한도", "턴 4 · 보조 8 · 토큰 40만"],
    ["렌즈 수 상한", "3"],
    ["확산 단계에서 쓰기 차단", "켜짐"],
    ["자동 시작", "제안"],
  ],
  review: [["실패 한도", "연속 5번"]],
};
export const DEFAULT_SETTINGS: readonly (readonly [string, string])[] = [
  ["실패 한도", "연속 5번이면 자동 꺼짐"],
  ["훅 시간 한도", "1.2초"],
];

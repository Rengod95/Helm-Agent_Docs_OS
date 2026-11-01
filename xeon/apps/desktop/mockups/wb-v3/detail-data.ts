// 플러그인 상세(무엇으로 되어 있나 + 어떻게 움직이나) 고정 데이터. 좌표는 상세 세계(1000 × 360) 기준이다.
// Helm은 L3.helm.spec의 단계 머신과 group-kit 구성 선언(결정 7), 비용 라우터는 사용자 L1 플러그인 예시([제안]: 가상 모델
// 라우터는 L1.models.spec §3 미결 "registerVirtualModel" 2차라, 여기서는 registerProvider + request.provider.before chain으로 그렸다).
import type { LayerId } from "./data";

export interface InRow {
  id: string;
  /** 오른쪽 작은 글: 누가 주는지 */
  sub: string;
  to: string[];
  missing?: boolean;
  user?: boolean;
}
export interface InGroup {
  layer: LayerId;
  title: string;
  rows: InRow[];
}
export interface Comp {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  line: string;
  x: number;
  y: number;
  h?: number;
  /** 강조(주도 요소) */
  hero?: boolean;
}
export interface OutRow {
  id: string;
  sub?: string;
  from: string[];
  stage?: string;
  user?: boolean;
}
export interface OutGroup {
  layer: LayerId;
  title: string;
  rows: OutRow[];
}
export interface Phase {
  id: string;
  label: string;
  budget?: string;
  comps: string[];
  /** 이 단계로 들어오는 경계 조건 */
  cond?: string;
  fan?: string[];
  note?: string;
}
export interface DetailSpec {
  id: string;
  inputs: InGroup[];
  comps: Comp[];
  internal: [string, string, string][];
  outputs: OutGroup[];
  phases: Phase[];
  /** 흐름이 고리인가(단계 머신) */
  cyclic: boolean;
  flowTitle: string;
  flowMeta: string;
  activePhase: string;
  gateAfter?: string;
}

export const HELM_DETAIL: DetailSpec = {
  id: "helm",
  inputs: [
    {
      layer: "L2",
      title: "기능",
      rows: [
        { id: "web.search", sub: "Exa 검색", to: ["knowledge-use"], user: true },
        { id: "web.fetch", sub: "웹", to: ["knowledge-use"] },
        { id: "knowledge.search", sub: "없음 · 선택", to: ["knowledge-use"], missing: true },
        { id: "knowledge.skills", sub: "지식", to: ["knowledge-use"] },
        { id: "work.tasks", sub: "작업", to: ["record"] },
      ],
    },
    {
      layer: "L1",
      title: "에이전트 핵심",
      rows: [
        { id: "loop.spawn", sub: "보조 에이전트", to: ["drive"] },
        { id: "loop.turn", sub: "턴 실행", to: ["drive"] },
      ],
    },
    {
      layer: "L0",
      title: "시스템 기반",
      rows: [{ id: "ScopedStore", sub: "저장", to: ["restore", "record"] }],
    },
  ],
  comps: [
    {
      id: "drive",
      name: "단계 머신",
      role: "drive",
      roleLabel: "주도",
      line: "확산 → 탐색 → 수렴 → 적용",
      x: 270,
      y: 26,
      h: 84,
      hero: true,
    },
    {
      id: "knowledge-use",
      name: "지식 소비",
      role: "knowledge",
      roleLabel: "지식",
      line: "수렴에서 읽기만 · 출처별 저하",
      x: 270,
      y: 124,
    },
    {
      id: "record",
      name: "발견 기록",
      role: "record",
      roleLabel: "기록",
      line: "발견을 그룹 기록으로 남겨요",
      x: 270,
      y: 198,
    },
    {
      id: "restore",
      name: "상태 복원",
      role: "restore",
      roleLabel: "복원",
      line: "다시 열면 단계를 이어요",
      x: 524,
      y: 26,
    },
    {
      id: "signal",
      name: "신호 감지",
      role: "signal",
      roleLabel: "신호",
      line: "막힘 3 · 반복 3 · 새 분야",
      x: 524,
      y: 94,
    },
    {
      id: "lens",
      name: "렌즈 주입",
      role: "lens",
      roleLabel: "렌즈",
      line: "신호 순서로 렌즈 3개",
      x: 524,
      y: 162,
    },
    {
      id: "guard",
      name: "쓰기 막기",
      role: "guard",
      roleLabel: "막기",
      line: "탐색 중 main·explorer 쓰기 거부",
      x: 524,
      y: 230,
    },
  ],
  internal: [
    ["signal", "drive", "막힘"],
    ["drive", "lens", "렌즈 지시"],
    ["drive", "guard", "단계"],
    ["knowledge-use", "drive", "발견"],
    ["drive", "record", "적용"],
    ["restore", "drive", "단계 복원"],
  ],
  outputs: [
    {
      layer: "X",
      title: "연결 지점",
      rows: [
        { id: "session.start", from: ["restore"], stage: "session" },
        { id: "boundary.settle.after", from: ["signal"], stage: "boundary" },
        { id: "input.agent.before", from: ["lens"], stage: "input" },
        { id: "tool.call.before", from: ["guard"], stage: "tool" },
        { id: "tool.execution.after", from: ["signal"], stage: "tool" },
        { id: "lifecycle.lease.rejected", from: ["drive"], stage: "lifecycle" },
        { id: "진행권 · 입력 넣기", from: ["drive"] },
      ],
    },
    {
      layer: "L3",
      title: "내놓는 것",
      rows: [
        { id: "grp.helm.discovery.recorded", sub: "학습이 읽어요", from: ["record"] },
        { id: "화면 · Helm 탐구", from: ["record"] },
      ],
    },
  ],
  phases: [
    { id: "idle", label: "쉼", comps: ["signal", "restore"] },
    {
      id: "diverge",
      label: "확산",
      budget: "턴 1",
      comps: ["drive", "lens"],
      cond: "막힘 신호 · 진행권",
    },
    {
      id: "explore",
      label: "탐색",
      budget: "보조 3",
      comps: ["drive", "lens", "guard"],
      cond: "diverged",
      fan: ["실패 사례", "기본 원리", "다른 분야"],
    },
    { id: "gather", label: "모으기", comps: ["drive"], cond: "렌즈 끝", note: "부분 결과 허용" },
    {
      id: "converge",
      label: "수렴",
      budget: "턴 0",
      comps: ["drive", "knowledge-use"],
      cond: "done ≥ 1",
    },
    { id: "apply", label: "적용", budget: "턴 1", comps: ["drive", "record"], cond: "발견 ≥ 1" },
    { id: "end", label: "끝", comps: ["record"], cond: "applied" },
  ],
  cyclic: true,
  flowTitle: "어떻게 움직이나",
  flowMeta:
    "단계 머신 · 단계마다 커밋하고 다시 불려요 · 진행 한도 턴 4 · 보조 에이전트 8 · 토큰 400k",
  activePhase: "explore",
  gateAfter: "converge",
};

export const ROUTER_DETAIL: DetailSpec = {
  id: "cost-router",
  inputs: [
    {
      layer: "L1",
      title: "에이전트 핵심",
      rows: [
        { id: "models.registerProvider", sub: "모델", to: ["provider"] },
        { id: "models.roles", sub: "모델 · 역할 표", to: ["choose"] },
        { id: "models.usage", sub: "모델 · 사용량", to: ["record"] },
      ],
    },
    {
      layer: "L0",
      title: "시스템 기반",
      rows: [{ id: "ScopedStore", sub: "저장 · 통계 표", to: ["record"] }],
    },
    {
      layer: "F",
      title: "공통 규약",
      rows: [{ id: "ext.cost-router.rules", sub: "설정 키 · 선언", to: ["rules"] }],
    },
  ],
  comps: [
    {
      id: "provider",
      name: "provider 등록",
      role: "provider",
      roleLabel: "등록",
      line: "route/auto 를 모델로 내놔요",
      x: 270,
      y: 14,
    },
    {
      id: "rules",
      name: "규칙 읽기",
      role: "rules",
      roleLabel: "설정",
      line: "짧은 질문 · 긴 컨텍스트 · 계획",
      x: 270,
      y: 92,
    },
    {
      id: "choose",
      name: "모델 고르기",
      role: "choose",
      roleLabel: "고르기",
      line: "haiku · sonnet · opus 중 하나",
      x: 270,
      y: 170,
      h: 84,
      hero: true,
    },
    {
      id: "measure",
      name: "요청 재기",
      role: "measure",
      roleLabel: "재기",
      line: "입력 토큰 · 도구 수 · 첨부",
      x: 524,
      y: 50,
    },
    {
      id: "patch",
      name: "요청 고치기",
      role: "patch",
      roleLabel: "고치기",
      line: "provider 본문의 model만 바꿔요",
      x: 524,
      y: 140,
    },
    {
      id: "record",
      name: "비용 기록",
      role: "record",
      roleLabel: "기록",
      line: "고른 모델과 아낀 비용",
      x: 524,
      y: 222,
    },
  ],
  internal: [
    ["rules", "choose", "규칙"],
    ["measure", "choose", "크기"],
    ["choose", "patch", "모델"],
    ["patch", "record", "결과"],
  ],
  outputs: [
    {
      layer: "X",
      title: "연결 지점",
      rows: [
        {
          id: "request.provider.before",
          sub: "chain",
          from: ["measure", "patch"],
          stage: "request",
        },
        { id: "request.model.after", sub: "tap", from: ["record"], stage: "request" },
      ],
    },
    {
      layer: "L1",
      title: "내놓는 것",
      rows: [
        { id: "provider route/auto", sub: "역할 표 main이 써요", from: ["provider"] },
        { id: "x.cost-router.route.chosen", sub: "기록 종류", from: ["record"] },
      ],
    },
  ],
  phases: [
    { id: "arrive", label: "요청 도착", comps: ["measure"], cond: "request.provider.before" },
    { id: "measure", label: "재기", comps: ["measure"], note: "18k 토큰 · 도구 3" },
    { id: "match", label: "규칙 대조", comps: ["rules", "choose"] },
    {
      id: "choose",
      label: "모델 고르기",
      comps: ["choose"],
      fan: ["haiku-5-5", "sonnet-5-5", "opus-5-5"],
    },
    { id: "patch", label: "요청 고치기", comps: ["patch"], note: "model 필드만" },
    { id: "after", label: "응답 뒤 기록", comps: ["record"], cond: "request.model.after" },
  ],
  cyclic: false,
  flowTitle: "어떻게 움직이나",
  flowMeta: "요청마다 한 번 · 진행권을 쓰지 않아요 · 실패하면 고치지 않고 통과(skip)",
  activePhase: "choose",
};

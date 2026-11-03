// 플러그인 상세(무엇으로 되어 있나 + 어떻게 움직이나) 고정 데이터. 좌표는 상세 그림(900 폭) 기준이다.
// Helm은 L3.helm.spec의 단계 머신과 group-sdk 구성 선언(결정 7), 비용 라우터는 사용자 L1 플러그인 예시([제안]: 가상 모델
// 라우터는 L1.models.spec §3 미결 "registerVirtualModel" 2차라, 여기서는 registerProvider + request.provider.before chain으로 그렸다).
import { T } from "../_shell/terms";
import type { LayerId } from "./data";

export interface InRow {
  /** 기계 이름. 화면에 내지 않는다. */
  id: string;
  label: string;
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
  x: number;
  y: number;
  h?: number;
  /** 강조(주도 요소) */
  hero?: boolean;
}
export interface OutRow {
  /** 기계 이름. 화면에 내지 않는다. */
  id: string;
  label: string;
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
  comps: string[];
  fan?: string[];
}
export interface DetailSpec {
  id: string;
  inputs: InGroup[];
  comps: Comp[];
  internal: [string, string][];
  outputs: OutGroup[];
  phases: Phase[];
  /** 흐름이 고리인가(단계 머신) */
  cyclic: boolean;
  activePhase: string;
  gateAfter?: string;
}

export const HELM_DETAIL: DetailSpec = {
  id: "helm",
  inputs: [
    {
      layer: "L2",
      title: T.layerL2,
      rows: [
        { id: "web.search", label: "웹 검색", sub: "Exa 검색", to: ["knowledge-use"], user: true },
        { id: "web.fetch", label: "페이지 읽기", sub: "웹", to: ["knowledge-use"] },
        {
          id: "knowledge.search",
          label: "지식 검색",
          sub: "없음 · 선택",
          to: ["knowledge-use"],
          missing: true,
        },
        { id: "knowledge.skills", label: "기술·기억", sub: "지식", to: ["knowledge-use"] },
        { id: "work.tasks", label: "작업 목록", sub: "작업", to: ["record"] },
      ],
    },
    {
      layer: "L1",
      title: T.layerL1,
      rows: [
        { id: "loop.spawn", label: "에이전트 띄우기", sub: "보조 에이전트", to: ["drive"] },
        { id: "loop.turn", label: "턴 돌리기", sub: "턴 실행", to: ["drive"] },
      ],
    },
    {
      layer: "L0",
      title: T.layerL0,
      rows: [{ id: "ScopedStore", label: "범위 저장소", sub: "저장", to: ["restore", "record"] }],
    },
  ],
  comps: [
    {
      id: "drive",
      name: "단계 머신",
      role: "drive",
      roleLabel: "주도",
      x: 240,
      y: 26,
      h: 84,
      hero: true,
    },
    {
      id: "knowledge-use",
      name: "지식 소비",
      role: "knowledge",
      roleLabel: "지식",
      x: 240,
      y: 124,
    },
    {
      id: "record",
      name: "발견 기록",
      role: "record",
      roleLabel: "기록",
      x: 240,
      y: 198,
    },
    {
      id: "restore",
      name: "상태 복원",
      role: "restore",
      roleLabel: "복원",
      x: 468,
      y: 26,
    },
    {
      id: "signal",
      name: "신호 감지",
      role: "signal",
      roleLabel: "신호",
      x: 468,
      y: 94,
    },
    {
      id: "lens",
      name: "렌즈 주입",
      role: "lens",
      roleLabel: "렌즈",
      x: 468,
      y: 162,
    },
    {
      id: "guard",
      name: "쓰기 막기",
      role: "guard",
      roleLabel: "막기",
      x: 468,
      y: 230,
    },
  ],
  internal: [
    ["signal", "drive"],
    ["drive", "lens"],
    ["drive", "guard"],
    ["knowledge-use", "drive"],
    ["drive", "record"],
    ["restore", "drive"],
  ],
  outputs: [
    {
      layer: "X",
      title: T.extensionPoint,
      rows: [
        { id: "thread.start", label: "대화 시작", from: ["restore"], stage: "thread" },
        { id: "boundary.settle.after", label: "단계 끝난 뒤", from: ["signal"], stage: "boundary" },
        { id: "input.agent.before", label: "입력 넣기 전", from: ["lens"], stage: "input" },
        { id: "tool.call.before", label: "도구 부르기 전", from: ["guard"], stage: "tool" },
        { id: "tool.execution.after", label: "도구 실행 뒤", from: ["signal"], stage: "tool" },
        {
          id: "lifecycle.lease.rejected",
          label: "주도 거절",
          from: ["drive"],
          stage: "lifecycle",
        },
        { id: "주도 · 입력 넣기", label: "주도 · 입력 넣기", from: ["drive"] },
      ],
    },
    {
      layer: "L3",
      title: "내놓는 것",
      rows: [
        { id: "grp.helm.discovery.recorded", label: "발견 기록됨", from: ["record"] },
        { id: "화면 · Helm 탐구", label: "화면 · Helm 탐구", from: ["record"] },
      ],
    },
  ],
  phases: [
    { id: "idle", label: "쉼", comps: ["signal", "restore"] },
    { id: "diverge", label: "확산", comps: ["drive", "lens"] },
    {
      id: "explore",
      label: "탐색",
      comps: ["drive", "lens", "guard"],
      fan: ["실패 사례", "기본 원리", "다른 분야"],
    },
    { id: "gather", label: "모으기", comps: ["drive"] },
    { id: "converge", label: "수렴", comps: ["drive", "knowledge-use"] },
    { id: "apply", label: "적용", comps: ["drive", "record"] },
    { id: "end", label: "끝", comps: ["record"] },
  ],
  cyclic: true,
  activePhase: "explore",
  gateAfter: "converge",
};

export const ROUTER_DETAIL: DetailSpec = {
  id: "cost-router",
  inputs: [
    {
      layer: "L1",
      title: T.layerL1,
      rows: [
        { id: "models.registerProvider", label: "provider 등록", sub: "모델", to: ["provider"] },
        { id: "models.roles", label: "역할 표", sub: "모델", to: ["choose"] },
        { id: "models.usage", label: "사용량", sub: "모델", to: ["record"] },
      ],
    },
    {
      layer: "L0",
      title: T.layerL0,
      rows: [{ id: "ScopedStore", label: "범위 저장소", sub: "저장", to: ["record"] }],
    },
    {
      layer: "F",
      title: T.layerF,
      rows: [{ id: "ext.cost-router.rules", label: "규칙", sub: "설정 키", to: ["rules"] }],
    },
  ],
  comps: [
    {
      id: "provider",
      name: "provider 등록",
      role: "provider",
      roleLabel: "등록",
      x: 240,
      y: 14,
    },
    {
      id: "rules",
      name: "규칙 읽기",
      role: "rules",
      roleLabel: "설정",
      x: 240,
      y: 92,
    },
    {
      id: "choose",
      name: "모델 고르기",
      role: "choose",
      roleLabel: "고르기",
      x: 240,
      y: 170,
      h: 84,
      hero: true,
    },
    {
      id: "measure",
      name: "요청 재기",
      role: "measure",
      roleLabel: "재기",
      x: 468,
      y: 50,
    },
    {
      id: "patch",
      name: "요청 고치기",
      role: "patch",
      roleLabel: "고치기",
      x: 468,
      y: 140,
    },
    {
      id: "record",
      name: "비용 기록",
      role: "record",
      roleLabel: "기록",
      x: 468,
      y: 222,
    },
  ],
  internal: [
    ["rules", "choose"],
    ["measure", "choose"],
    ["choose", "patch"],
    ["patch", "record"],
  ],
  outputs: [
    {
      layer: "X",
      title: T.extensionPoint,
      rows: [
        {
          id: "request.provider.before",
          label: "provider 요청 전",
          from: ["measure", "patch"],
          stage: "request",
        },
        { id: "request.model.after", label: "모델 응답 뒤", from: ["record"], stage: "request" },
      ],
    },
    {
      layer: "L1",
      title: "내놓는 것",
      rows: [
        { id: "provider route/auto", label: "provider route/auto", from: ["provider"] },
        { id: "x.cost-router.route.chosen", label: "고른 모델", from: ["record"] },
      ],
    },
  ],
  phases: [
    { id: "arrive", label: "요청 도착", comps: ["measure"] },
    { id: "measure", label: "재기", comps: ["measure"] },
    { id: "match", label: "규칙 대조", comps: ["rules", "choose"] },
    {
      id: "choose",
      label: "모델 고르기",
      comps: ["choose"],
      fan: ["haiku-5-5", "sonnet-5-5", "opus-5-5"],
    },
    { id: "patch", label: "요청 고치기", comps: ["patch"] },
    { id: "after", label: "응답 뒤 기록", comps: ["record"] },
  ],
  cyclic: false,
  activePhase: "choose",
};

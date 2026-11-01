// B 묶음 고정 데이터(목업 전용). 화면 기여(ADR-0021 §3.2~§3.5)를 가진 확장 셋과 그 매니페스트 조각.
// taskflow: 사용자 설치 그룹. page·well은 자체 코드 화면(frame), card는 기본 부품 화면(declarative).
// acme-notes: 이 프로젝트 확장. page가 자체 코드 화면이라 프로젝트 확장 규칙(§3.5 등급표)에 걸린다.
// helm: 기본 부품 화면 기준 사례(§3.10).

export interface FrameDecl {
  root: string;
  entry: string;
  bridge: string;
  /** 기본 부품으로 그릴 수 없는 이유 한 줄(제작 에이전트가 적음). 머리 표지 툴팁과 신뢰 확인이 그대로 보인다. */
  reason: string;
}

export interface ViewDecl {
  id: string;
  slot: "page" | "well" | "card" | "status" | "command" | "settings";
  mode: "declarative" | "frame";
  title: string;
  frame?: FrameDecl;
  fallback?: string;
}

export interface MethodDecl {
  verb: string;
  /** 사람이 읽는 동작 이름(확인 줄 문장에 들어감) */
  label: string;
  readOnly: boolean;
  approval?: boolean;
}

export interface PluginExt {
  name: string;
  /** 매니페스트 표시 이름(결정 13) */
  display: string;
  layer: "L2" | "L3" | "plugin";
  kind: "group" | "plugin";
  trust: "builtin" | "user" | "project";
  version: string;
  views: ViewDecl[];
  methods: MethodDecl[];
}

export const taskflow: PluginExt = {
  name: "taskflow",
  display: "작업 흐름",
  layer: "L3",
  kind: "group",
  trust: "user",
  version: "0.3.0",
  views: [
    {
      id: "taskflow/board",
      slot: "page",
      mode: "frame",
      title: "작업 흐름판",
      frame: {
        root: "./views/board",
        entry: "index.html",
        bridge: "^1.0.0",
        reason: "작업 카드를 끌어 옮기고 의존선을 잇는 판이라 기본 부품으로 그릴 수 없어요",
      },
      fallback: "./views/board.fallback.view.json",
    },
    {
      id: "taskflow/panel",
      slot: "well",
      mode: "frame",
      title: "흐름판",
      frame: {
        root: "./views/panel",
        entry: "index.html",
        bridge: "^1.0.0",
        reason: "작은 흐름 그래프를 그려요",
      },
    },
    { id: "taskflow/moved", slot: "card", mode: "declarative", title: "작업 이동" },
    { id: "taskflow/open", slot: "command", mode: "declarative", title: "작업 흐름판 열기" },
  ],
  methods: [
    { verb: "board", label: "판 읽기", readOnly: true },
    { verb: "move", label: "작업 순서 바꾸기", readOnly: false },
    {
      verb: "dispatch",
      label: "작업을 보조 에이전트에 맡기기",
      readOnly: false,
      approval: true,
    },
  ],
};

export const acmeNotes: PluginExt = {
  name: "acme-notes",
  display: "Acme 노트",
  layer: "plugin",
  kind: "plugin",
  trust: "project",
  version: "0.0.9",
  views: [
    {
      id: "acme-notes/map",
      slot: "page",
      mode: "frame",
      title: "노트 지도",
      frame: {
        root: "./views/map",
        entry: "index.html",
        bridge: "^1.0.0",
        reason: "노트를 자유 배치 지도로 보여요",
      },
    },
  ],
  methods: [{ verb: "pin", label: "노트 고정", readOnly: false }],
};

export type TaskCol = "todo" | "doing" | "done";
export interface Task {
  id: string;
  title: string;
  col: TaskCol;
  /** 앞서야 하는 작업 */
  after?: string;
  who?: string;
}

export const boardTasks: Task[] = [
  { id: "t12", title: "TTL 경계 시각 재현 시험", col: "doing", who: "렌즈 실패 사례" },
  { id: "t13", title: "만료 비교 단위 통일", col: "todo", after: "t12" },
  { id: "t14", title: "무효화 이벤트 순서 확인", col: "todo", after: "t12" },
  { id: "t15", title: "캐시 키 해시 고정", col: "todo" },
  { id: "t10", title: "실패 시험 모으기", col: "done" },
  { id: "t11", title: "로그에서 같은 오류 찾기", col: "done" },
];

export const colLabel: Record<TaskCol, string> = { todo: "대기", doing: "진행", done: "끝남" };

/** 외부 링크(navigate external) 예: 프레임 안 이슈 링크. */
export const externalLink = "https://github.com/acme/xeon/issues/412";

export const helmExt: PluginExt = {
  name: "helm",
  display: "Helm",
  layer: "L3",
  kind: "group",
  trust: "user",
  version: "0.1.0",
  views: [
    { id: "helm/inquiry", slot: "page", mode: "declarative", title: "Helm 탐구" },
    { id: "helm/panel", slot: "well", mode: "declarative", title: "탐구" },
    { id: "helm/finished", slot: "card", mode: "declarative", title: "탐구 결과" },
    { id: "helm/suggested", slot: "card", mode: "declarative", title: "탐구 제안" },
    { id: "helm/phase", slot: "status", mode: "declarative", title: "탐구 단계" },
    { id: "helm/start", slot: "command", mode: "declarative", title: "탐구 시작…" },
    { id: "helm/stop", slot: "command", mode: "declarative", title: "탐구 멈춤" },
  ],
  methods: [
    { verb: "status", label: "상태 읽기", readOnly: true },
    { verb: "stop", label: "탐구 멈춤", readOnly: false },
  ],
};

export const webExa: PluginExt = {
  name: "web-exa",
  display: "Exa 웹 검색",
  layer: "L2",
  kind: "plugin",
  trust: "user",
  version: "1.0.3",
  views: [{ id: "web-exa/none", slot: "page", mode: "declarative", title: "Exa 웹 검색" }],
  methods: [],
};

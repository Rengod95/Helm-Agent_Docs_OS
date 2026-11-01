// B03 고정 데이터(목업 전용). 확장 목록(P-13 줄인 것), 가져올 후보, 업데이트 차이, 지우기 영향.
// 신뢰 수준은 X.loading-trust §4.6: 유효 = min(위치 상한, 요청). 위치 상한은 builtin→builtin, managed·user→user, project→project.
// 표시 이름 + 회색 mono id(결정 13). 도메인 용어는 _shell/terms.ts에서.
import { T } from "../_shell";

export type Trust = "builtin" | "user" | "project";
export type Op = "on" | "post" | "drive" | "storage" | "resources";

export interface Ext {
  name: string;
  display: string;
  layer: "L1" | "L2" | "L3" | "plugin";
  trust: Trust;
  version: string;
  state: "on" | "off" | "trust_undecided" | "removing" | "auto_off";
  /** 기다리는 업데이트 버전 */
  update?: string;
}

export const EXTS: Ext[] = [
  {
    name: "core-loop",
    display: "기본 에이전트",
    layer: "L1",
    trust: "builtin",
    version: "0.4.0",
    state: "on",
  },
  {
    name: "learning",
    display: "학습",
    layer: "L3",
    trust: "builtin",
    version: "0.4.0",
    state: "on",
  },
  { name: "helm", display: "Helm", layer: "L3", trust: "user", version: "0.1.0", state: "on" },
  {
    name: "taskflow",
    display: "작업 흐름",
    layer: "L3",
    trust: "user",
    version: "0.3.0",
    state: "on",
    update: "0.4.0",
  },
  {
    name: "web-exa",
    display: "Exa 웹 검색",
    layer: "L2",
    trust: "user",
    version: "1.0.4",
    state: "on",
  },
  {
    name: "acme-notes",
    display: "Acme 노트",
    layer: "plugin",
    trust: "project",
    version: "0.0.9",
    state: "on",
  },
];

export interface Manifest {
  name: string;
  display: string;
  version: string;
  layer: Ext["layer"];
  kind: "group" | "plugin";
  requested: Trust;
  ceiling: Trust;
  ops: Op[];
  points: string[];
  frames: { title: string; slot: string; reason: string }[];
  views: number;
  source: string;
  dest: string;
}

/** 가져오기 성공 후보: 폴더에서 */
export const graphLens: Manifest = {
  name: "graph-lens",
  display: "그래프 렌즈",
  version: "0.1.0",
  layer: "L3",
  kind: "group",
  requested: "user",
  ceiling: "user",
  ops: ["on", "post", "storage", "resources"],
  points: ["input.agent.before", "tool.execution.after", "boundary.settle.after"],
  frames: [
    {
      title: "의존 그래프",
      slot: T.slotPage,
      reason: "파일 의존을 끌어 옮기는 그래프 편집기라 기본 부품으로 그릴 수 없어요",
    },
  ],
  views: 3,
  source: "~/Downloads/graph-lens/",
  dest: "~/.xeon/extensions/graph-lens/",
};

/** 프로젝트 위치 확장(폴더 신뢰가 먼저) */
export const acmeManifest: Manifest = {
  name: "acme-notes",
  display: "Acme 노트",
  version: "0.0.9",
  layer: "plugin",
  kind: "plugin",
  requested: "project",
  ceiling: "project",
  ops: ["on", "resources"],
  points: ["tool.call.before"],
  frames: [],
  views: 1,
  source: "~/code/xeon/.xeon/extensions/acme-notes/",
  dest: "~/code/xeon/.xeon/extensions/acme-notes/",
};

export type CheckState = "wait" | "run" | "ok" | "warn" | "fail";
export interface Check {
  id: string;
  label: string;
  ok: string;
  fail?: string;
  code?: string;
}

/** 가져오기 검사(로더 파이프라인 앞 단계와 같은 검사, X.loading-trust §4.3) */
export const CHECKS: Check[] = [
  { id: "manifest", label: `${T.manifest} 읽기`, ok: ".xeon-plugin/plugin.json · 형식 맞음" },
  {
    id: "name",
    label: "이름 겹침",
    ok: "같은 이름 없음",
    fail: "helm이 이미 있어요 · 내장·사용자 확장이 먼저라 이 폴더는 실리지 않아요",
    code: "name_conflict",
  },
  {
    id: "trust",
    label: `${T.trust} 요청`,
    ok: `${T.trustUser} 요청 · ${T.trustCeiling} 안`,
    fail: `${T.trustBuiltin} 수준을 요청했어요 · ${T.installUserDir} 상한은 ${T.trustUser}예요`,
    code: "trust_exceeds_source",
  },
  { id: "points", label: T.extensionPoint, ok: "3개 · 모두 있는 지점" },
  {
    id: "views",
    label: "화면 기여",
    ok: `3개 · ${T.viewFrame} 1개(이유 있음)`,
    fail: `${T.viewFrame} 1개에 이유가 비어 있어요`,
    code: "frame_reason_missing",
  },
  { id: "files", label: "파일 경로", ok: "폴더 밖을 가리키는 링크 없음" },
];

/** 실패하는 후보에서 실패할 검사 */
export const FAILING = new Set(["name", "trust", "views"]);

/** taskflow 0.3.0 → 0.4.0 차이. grown = 늘어난 것만 묻는다. 줄어든 변경은 묻지 않는다. */
export const taskflowDiff = {
  name: "taskflow",
  display: "작업 흐름",
  from: "0.3.0",
  to: "0.4.0",
  requested: { from: "user", to: "user" } as const,
  grown: [
    { kind: "연산", text: T.opDrive, code: "drive" },
    { kind: T.extensionPoint, text: "tool.call.before", code: "" },
    {
      kind: T.viewFrame,
      text: `흐름판(${T.slotWell})`,
      code: "작은 흐름 그래프를 그려요",
    },
  ],
  same: [
    `${T.opOn} on`,
    `${T.opPost} post`,
    "저장",
    `${T.extensionPoint} 2`,
    `${T.viewFrame} 1(작업 흐름판)`,
  ],
};

/** 지우기 영향(X.loading-trust §4.4.5 previewRemoval + 화면 기여 + 프로필) */
export const removal = {
  profiles: ["조사용", "기본"],
  tables: [
    { name: "x_taskflow_tasks", rows: "312행" },
    { name: "x_taskflow_links", rows: "48행" },
  ],
  views: [
    { title: "작업 흐름판", slot: T.slotPage },
    { title: "흐름판", slot: T.slotWell },
    { title: "작업 이동", slot: T.slotCard },
    { title: "작업 흐름판 열기 외 1", slot: T.slotCommand },
  ],
};

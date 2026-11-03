// P-15 고정 데이터. 버전은 host.hello, 외부 도구는 binaryViewOf(darwin), 플러그인·그룹은 층별 적재 목록 [gap: wire에 적재 목록 메서드 없음],
// 설정 개요는 OverviewVM, 웹 요약은 toolsWebViewOf, 화면 진단은 ViewDiagnostic 모양을 따른다.

export const versions = {
  app: "0.4.0",
  engine: "0.4.0",
  runtime: "Bun 1.3.2",
  os: "macOS 15.1 · arm64",
  link: "앱 안 엔진 (stdio)",
};

export const overview = [
  { label: "사용자", value: 12 },
  { label: "프로젝트", value: 3 },
  { label: "잠김", value: 1 },
  { label: "재시작 대기", value: 1 },
  { label: "폐기 예정 사용", value: 0 },
];

export interface BinaryRow {
  name: string;
  need: "필수" | "선택";
  ok: boolean;
  note: string;
  impact: string;
}
export const binaries: BinaryRow[] = [
  {
    name: "rg",
    need: "필수",
    ok: true,
    note: "14.1.1",
    impact: "파일 검색과 샌드박스 시작이 멈춰요",
  },
  { name: "sops", need: "필수", ok: true, note: "3.10.2", impact: "시크릿을 읽고 쓸 수 없어요" },
  { name: "age", need: "필수", ok: true, note: "1.2.1", impact: "새 시크릿 키를 만들 수 없어요" },
  {
    name: "security",
    need: "필수",
    ok: true,
    note: "사용 가능",
    impact: "Keychain에 키를 둘 수 없어요",
  },
  {
    name: "git",
    need: "선택",
    ok: false,
    note: "xcode-select --install",
    impact: "git 상태와 작업 트리 기능만 빠져요",
  },
];

export type PluginState = "on" | "off" | "auto-off" | "needs-key" | "safe-off";
export interface PluginRow {
  layer: "F" | "X" | "L0" | "L1" | "L2" | "L3";
  id: string;
  version: string;
  source: string;
  trust: string;
  state: PluginState;
  /** 상태 옆 짧은 글 */
  note?: string;
  /** 사용자가 만든 것: 안전 모드에서 꺼진다 */
  user?: boolean;
}

export const plugins: PluginRow[] = [
  {
    layer: "F",
    id: "f.wire",
    version: "3",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "X",
    id: "x.transport-stdio",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "L0",
    id: "l0.platform-os",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "L0",
    id: "l0.sandbox-seatbelt",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "L1",
    id: "l1.provider-anthropic",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "L2",
    id: "l2.web-searxng",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
    note: "연결 안 됨",
  },
  {
    layer: "L2",
    id: "plugin:web-exa",
    version: "0.2.1",
    source: "사용자 설치",
    trust: "사용자",
    state: "needs-key",
    user: true,
  },
  {
    layer: "L3",
    id: "grp.helm",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
    note: "주도 없음",
  },
  {
    layer: "L3",
    id: "grp.learning",
    version: "0.4.0",
    source: "내장",
    trust: "기본",
    state: "on",
  },
  {
    layer: "L3",
    id: "grp.cache-debug",
    version: "0.1.0",
    source: "~/code/fresnel/.fresnel/groups",
    trust: "이 폴더",
    state: "auto-off",
    note: "post 실패 3회",
    user: true,
  },
];

export const handlerFailure = {
  group: "grp.cache-debug",
  count: 3,
  at: "12분 전",
};

export const web = [
  { term: "검색", value: "auto: searxng → exa → 내장", note: "지금 내장(anthropic)" },
  { term: "브라우저", value: "auto: playwright", note: "설치 안 됨" },
  { term: "가져오기", value: "기본", note: "robots 따르지 않음" },
];

export const viewDiagnostics = [
  {
    key: "l2.web.search.order",
    text: "모르는 provider kagi를 건너뛰었어요",
  },
];

export const LICENSE_SOLAR =
  "Icons: Solar Icons Set by 480 Design, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Some icons are used as-is in two styles (Linear, Bold); some are mirrored.";
export const LICENSE_LUCIDE =
  "Hand, LoaderCircle, CornerUpRight and CallArrow follow Lucide outlines. ISC License, Copyright (c) Lucide Contributors.";

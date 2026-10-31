// P-01 고정 데이터. 외부 도구는 platform-os binaryRequirements("darwin")의 행을 binaryViewOf 모양으로 옮겼다(문구는 해요체로).
// 그룹은 L3 의도 그룹(내장 Helm, 학습). 웹 권장은 WebRecommendation 모양.
import type { NavEntry, PaletteGroup } from "../_shell";

export interface ToolRow {
  name: string;
  need: "필수" | "선택";
  ok: boolean;
  /** 버전 또는 해야 할 일 */
  note: string;
  usedBy: string;
}

export const toolsReady: ToolRow[] = [
  { name: "rg", need: "필수", ok: true, note: "14.1.1", usedBy: "샌드박스, 파일 검색" },
  { name: "sops", need: "필수", ok: true, note: "3.10.2", usedBy: "비밀 저장" },
  { name: "age", need: "필수", ok: true, note: "1.2.1", usedBy: "비밀 키 생성" },
  { name: "security", need: "필수", ok: true, note: "사용 가능", usedBy: "Keychain 키 보관" },
  {
    name: "git",
    need: "선택",
    ok: false,
    note: "xcode-select --install",
    usedBy: "작업 공간 git 기능",
  },
];

export const toolsMissing: ToolRow[] = [
  {
    name: "rg",
    need: "필수",
    ok: false,
    note: "brew install ripgrep",
    usedBy: "샌드박스, 파일 검색",
  },
  { name: "sops", need: "필수", ok: false, note: "3.9.1 (3.10.0 이상 필요)", usedBy: "비밀 저장" },
  { name: "age", need: "필수", ok: true, note: "1.2.1", usedBy: "비밀 키 생성" },
  { name: "security", need: "필수", ok: true, note: "사용 가능", usedBy: "Keychain 키 보관" },
  { name: "git", need: "선택", ok: true, note: "2.47.1", usedBy: "작업 공간 git 기능" },
];

export const providers = ["anthropic", "openai", "google", "openrouter"] as const;

export const models = [
  {
    label: "anthropic · 키 등록됨",
    options: [
      { value: "anthropic/sonnet-5-5", label: "sonnet-5-5", description: "균형 · 1M 문맥" },
      { value: "anthropic/opus-5-5", label: "opus-5-5", description: "깊은 추론" },
      { value: "anthropic/haiku-5-5", label: "haiku-5-5", description: "빠름" },
    ],
  },
];

export interface Group {
  id: string;
  name: string;
  /** 한 줄 설명: 무엇을 하는지 */
  what: string;
  hooks: string;
}

export const groups: Group[] = [
  {
    id: "grp.helm",
    name: "Helm",
    what: "운전 임대를 받아 하위 에이전트와 렌즈를 나란히 돌리고 결과를 적용해요",
    hooks: "drive · scope · post",
  },
  {
    id: "grp.learning",
    name: "학습",
    what: "끝난 대화를 돌아보고 스킬과 지식 제안을 받은 요청에 올려요",
    hooks: "post",
  },
];

export interface Recommendation {
  label: "Exa" | "Brave";
  plugin: string;
  state: "needs-key" | "not-installed";
  hint: string;
}

export const recommendations: Recommendation[] = [
  { label: "Exa", plugin: "plugin:web-exa", state: "needs-key", hint: "exa-api-key" },
  {
    label: "Brave",
    plugin: "plugin:web-brave",
    state: "not-installed",
    hint: "xeon plugin add web-brave",
  },
];

/** 첫 실행에는 대화도 알림도 없다: 배지 없는 주 내비 */
export const firstRunNav: NavEntry[] = [
  { id: "chat", label: "대화" },
  { id: "inbox", label: "받은 요청" },
  { id: "proposals", label: "제안" },
  { id: "schedules", label: "예약" },
  { id: "connection", label: "연결" },
];

/** 첫 실행 맥락의 팔레트: 대화가 없어서 명령·그룹·화면 이동이 앞에 온다 */
export const firstRunPalette: PaletteGroup[] = [
  {
    group: "명령",
    items: [
      { label: "시작하기" },
      { label: "새 대화" },
      { label: "진단 복사" },
      { label: "테마 바꾸기" },
    ],
  },
  {
    group: "그룹",
    items: [
      { label: "Helm 끄기", hint: "grp.helm · 다음 단계 경계부터" },
      { label: "학습 끄기", hint: "grp.learning" },
      { label: "안전 모드로 다시 시작", hint: "플러그인과 그룹 없이" },
    ],
  },
  {
    group: "슬래시 명령",
    items: [
      { label: "/helm start", hint: "탐구 시작 (Helm)" },
      { label: "/learn review", hint: "학습 검토 (학습)" },
    ],
  },
  {
    group: "설정",
    items: [
      { label: "기본 모델", hint: "l1.models.default" },
      { label: "SearXNG 주소", hint: "l2.web.search.searxng.url" },
    ],
  },
  { group: "화면", items: [{ label: "진단과 정보" }, { label: "도구와 웹" }, { label: "비밀" }] },
];

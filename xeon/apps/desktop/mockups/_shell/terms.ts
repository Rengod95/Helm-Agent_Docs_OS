// UI 도메인 용어 한 곳(목업 전용). 용어가 아직 확정 전이라 화면에 보이는 도메인 말은 모두 여기서 가져온다.
// 이름을 바꿀 때는 이 파일만 고친다. 값은 _notes/terms-and-coverage.md §1.3 "제안 라벨"의 추천안(첫 칸)이다.
// 규칙: 페이지는 아래 단어를 문자열로 직접 쓰지 않는다. 문장 안에서는 템플릿 문자열로 끼운다(`${T.lead}을 넘겼어요`).
// 조사는 받침에 따라 바뀌므로, 문장에 끼우는 말은 josa()를 쓴다.
// 기계 id(지점 이름, 확장 id, 이벤트 kind)는 용어가 아니라 mono로 옆에 두는 값이라 여기 두지 않는다(DP-39).

export const T = {
  // 층(F/X/L0~L4). 층 코드는 mono로 따로 쓴다.
  layer: "층",
  layerF: "공통 규약",
  layerX: "확장 연결부",
  layerL0: "시스템 기반",
  layerL1: "에이전트 핵심",
  layerL2: "기능",
  layerL3: "그룹",
  layerL4: "앱",

  // 실행 흐름
  baseAgent: "기본 에이전트", // core-loop
  step: "단계", // step
  stepBoundary: "단계 사이", // step boundary(라벨). 문장: "이번 단계가 끝나면"
  turn: "턴",
  loopTrigger: "반복", // 예약 트리거 "루프"

  // 확장
  extension: "확장", // 플러그인 + 그룹
  plugin: "플러그인",
  group: "그룹", // L3 의도 그룹
  extensionPoint: "연결 지점", // point
  capability: "기능", // L2 capability
  block: "블록", // 그룹 안 조각(부품)
  blockSlot: "블록 자리", // group-kit 슬롯
  groupKit: "그룹 기본 틀",
  manifest: "확장 정보 파일",
  handler: "핸들러", // 작업대에서만. 대화 영역 문장은 extFailed
  extFailed: "확장이 실패했어요",
  autoDisabled: "자동 꺼짐",
  safeMode: "안전 모드",
  trust: "신뢰 수준",
  trustBuiltin: "내장",
  trustUser: "사용자 설치",
  trustProject: "이 프로젝트",
  trustUntrusted: "신뢰 안 함",
  promote: "기능으로 올리기", // 승격
  version: "버전",
  revert: "되돌리기",

  // 진행권(drive lease)
  drive: "진행", // drive 연산 라벨. 상태 표시줄 "진행 Helm"
  lead: "진행권", // drive lease
  leadQueue: "차례 기다림",
  leadLimit: "진행 한도",
  childAgent: "보조 에이전트", // spawn / 자식 에이전트
  lens: "렌즈", // Helm 제품 어휘
  inquiry: "탐구",
  finding: "발견",
  humanGate: "사람 확인", // drive 사람 확인 관문(loop.ask)

  // 연산 이름(작업대에서만, mono 원어 병기)
  opOn: "보기",
  opPost: "입력 넣기",
  opDrive: "진행 맡기",
  opScope: "켜짐·꺼짐 바꾸기",

  // ADR-0021 화면 기여 slot
  slotPage: "전체 화면",
  slotWell: "옆 패널",
  slotCard: "대화 카드",
  slotStatus: "상태 칸",
  slotCommand: "명령",
  slotSettings: "설정",
  pluginView: "플러그인 화면",
  viewDeclarative: "기본 부품 화면", // 선언형 모드
  viewFrame: "자체 코드 화면", // 프레임 모드
  viewFallback: "대체 화면", // 프레임 금지 때 그리는 fallback 트리
  framesSetting: "자체 코드 화면 허용", // x.views.frames
  projectFramesSetting: "프로젝트 확장의 자체 코드 화면", // x.views.allowProjectFrames
  frameConfirm: "동작 확인", // 프레임 call 확인 줄(셸이 띄움)
  projectTrust: "프로젝트 신뢰", // O-04 폴더 신뢰(확장 신뢰 수준과 다름)
  trustConfirm: "확장 신뢰 확인", // O-10
  installFolder: "폴더", // 설치 출처: 확장 폴더
  installBundle: "묶음 파일", // 설치 출처: 패키징한 확장 파일
  installUserDir: "사용자 확장 위치", // install source user(<userDir>/extensions)
  extStorage: "확장 저장 데이터", // 확장 접두 테이블(상태 문서)

  // 맥락·프로필·시험
  context: "보기 기준", // 작업대 맥락 칸
  contextAll: "전체",
  contextThread: "대화",
  contextProfile: "프로필",
  contextTrial: "시험",
  pin: "고정",
  modelContext: "컨텍스트", // 모델 컨텍스트(맥락·문맥과 다름)
  compaction: "대화 요약",
  profile: "프로필",
  trial: "시험", // trial conversation
  trialThread: "시험 대화",
  replay: "다시 돌려 검사", // replayDrive(개발 모드)
  turnReplay: "턴 다시 보기", // 계측 trace 재생
  instrumentation: "계측",
  bench: "성능 측정",
  coreDiff: "보호 코드 변경 검사",
  devMode: "개발 모드",
  codeTest: "테스트", // 코드 테스트(시험과 구분)

  // 제작(authoring)
  authoring: "제작",
  authoringSession: "제작 대화",

  // 셸·영역
  thread: "대화", // session/thread
  workbench: "작업대",
  inbox: "받은 요청",
  proposals: "제안",
  schedules: "예약",
  connection: "연결",
  engine: "엔진",
  compose: "구성",
  overview: "개요",
  trials: "시험 실행",
  metrics: "측정",
  localEngine: "이 컴퓨터(앱 안)", // 사이드카
  localService: "이 컴퓨터(백그라운드)",
  remoteEngine: "원격 컴퓨터",

  // 승인
  approval: "승인",
  approvalTool: "도구 실행",
  approvalPlan: "계획",
  approvalQuestion: "질문",
  approvalReview: "변경 검토",
} as const;

export type TermKey = keyof typeof T;

/** 받침 여부로 조사를 고른다: josa("진행권", "을", "를") → "진행권을". 영문·숫자로 끝나면 둘째를 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    return word + ((last - 0xac00) % 28 === 0 ? withoutFinal : withFinal);
  }
  return word + withoutFinal;
}

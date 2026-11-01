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

  // 묶음 A(대화 영역 런타임, m4/pg-a). 병합 때 이 구역을 통째로 옮긴다.
  runtime: "런타임", // 대화 영역 런타임 줄·런타임 탭
  contextFollow: "따라감", // 보기 기준이 대화 영역의 열린 대화를 따라감(결정 11)
  unpin: "고정 풀기",
  authoringExt: "제작 확장", // L3 그룹 authoring
  kind: "종류", // 카탈로그 종류(kind)
  catalog: "종류 목록", // 종류 카탈로그
  catalogBlocked: "준비 중", // 카탈로그 status blocked
  authoringCheck: "제작 검사", // AU-NNN
  writeScope: "쓰기 범위", // 대상 폴더 밖 쓰기 거부
  targetFolder: "대상 폴더",
  userExtDir: "사용자 확장 위치", // 설치 연결 대상
  stageIntent: "요구 정리", // 제작 단계 intent
  stageCompose: "구성 초안", // compose
  stageScaffold: "뼈대", // scaffold
  stageValidate: "검사", // validate
  stageFix: "고치기", // fix
  stagePackage: "묶기", // package
  stageDone: "끝",
  bundle: "묶음 파일", // authoring package 결과물
  installLink: "연결", // devkit.link: 사용자 확장 위치에 연결(설치). 문장: "사용자 확장 위치에 연결"
  viewMode: "화면 방식", // 선언형(viewDeclarative)·프레임(viewFrame) 중 에이전트가 고른 것(결정 1)
  leadReturn: "반납", // 사람 확인을 기다리며 진행권을 놓음(X-17). 문장: "진행권 반납"
  leadRetake: "다시 받음", // 답한 뒤 진행권을 다시 쥠
  modeSteer: "끼어들기", // 실행 중 입력 전달 방식 steer(지금 턴에 끼움)
  modeFollowUp: "다음에", // 실행 중 입력 전달 방식 followUp(이번 턴 뒤에 보냄)
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

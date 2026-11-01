// UI 도메인 용어 한 곳(목업 전용). 용어가 아직 확정 전이라 화면에 보이는 도메인 말은 모두 여기서 가져온다.
// 이름을 바꿀 때는 이 파일만 고친다. 값은 _notes/terms-and-coverage.md §1.3 "제안 라벨"의 추천안(첫 칸)이다.
// 규칙: 페이지는 아래 단어를 문자열로 직접 쓰지 않는다. 문장 안에서는 템플릿 문자열로 끼운다(`${T.lead}을 넘겼어요`).
// 조사는 받침에 따라 바뀌므로, 문장에 끼우는 말은 josa()를 쓴다.
// 기계 id(지점 이름, 확장 id, 이벤트 kind)는 용어가 아니라 mono로 옆에 두는 값이라 여기 두지 않는다(DP-39).
// 묶음 E: 영어 값은 terms.en.ts(T_EN). 키를 더하면 거기에도 더한다(빠지면 타입 오류).
import { LANG } from "./i18n";
import { T_EN } from "./terms.en";

const T_KO = {
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

  // 묶음 D(대화 영역 빈칸과 셸 수명, m4/pg-d). 병합 때 이 구역을 통째로 옮긴다.
  resume: "이어서 실행", // turn.resume 후보(비정상 종료 표식, L4.desktop §4.7). 띠 버튼·목록 배지
  fork: "분기", // thread.fork(대화 행 메뉴, 여기서 분기)
  xHook: "X 훅", // X 층 훅(hooks.list). 결정 12: 안전 모드에서 싣지 않음
  liveWork: "진행 중", // 상태 표시줄 host.status.liveTurns 칸(§6.3)
  backgroundWork: "백그라운드 작업", // 진행 중 Popover 제목(계획에 없음 10): 대화·시험·예약·제작 대화
  appUpdate: "앱 업데이트", // 앱 안 업데이트(L4.release §5, 계획에 없음 1)
  exportThread: "대화 내보내기", // Markdown·JSON(계획에 없음 6)
  wipeData: "데이터 지우기", // 모든 대화·설정·비밀 핸들을 지움(계획에 없음 6, O-06 변형)
  osNotice: "OS 알림", // 앱 밖 알림(tauri-plugin-notification). 설정 탭 이름
  trayIcon: "메뉴 막대 아이콘", // 트레이(macOS 메뉴 막대, Linux·Windows 알림 영역)

  // 묶음 E(가로 품질, m4/pg-e). 병합 때 이 구역을 통째로 옮긴다.
  uiLanguage: "화면 언어", // ui.locale(ko·en). 영어 스모크(N-49, Y15)
  keybinding: "바로 가기 키", // O-09 제목·설정 행
  rebind: "키 바꾸기", // l4.desktop.appearance.keybindings(계획에 없음 11)
  keyConflict: "겹치는 키", // 다른 동작이나 브라우저가 이미 쓰는 키
  focusOrder: "초점 순서", // 키보드만 경로(N-50): 영역 바꾸기 → 보기 기준 칸 → 가운데 → well → 상태 표시줄
  reducedMotion: "움직임 줄이기", // prefers-reduced-motion
  highContrast: "고대비", // forced-colors·prefers-contrast
  profileManage: "프로필 관리", // N-57 목록·만들기·이름 바꾸기·복제·지우기
  editedElsewhere: "다른 곳에서 바뀜", // baseRev 충돌(다른 창·웹·앱이 먼저 저장)
  webClient: "웹", // 브라우저로 붙는 클라이언트(계획에 없음 7)
  serviceAddress: "서비스 주소", // 웹 첫 화면
  accessToken: "접속 토큰", // 웹 첫 화면 인증
  readOnly: "읽기 전용", // 좁은 폭 작업대(계획에 없음 8)
  remoteTarget: "원격 대상", // 원격 엔진에 붙은 작업대(N-60)
  copyPath: "경로 복사", // 원격에서 "폴더 열기"·"파일 열기" 대신
  productName: "Xeon", // 제품 이름(아직 정하는 중). 화면에 보이는 제품 이름은 모두 이 키로, 바꿀 때 여기 하나만
} as const;

export type TermKey = keyof typeof T_KO;

/** 화면 언어(?lang=en, 목업 전용)에 따라 한국어나 영어 용어 묶음. 영어 묶음은 모든 키를 가져야 한다(terms.en.ts 타입이 강제). */
export const T: { readonly [K in TermKey]: string } = LANG === "en" ? T_EN : T_KO;

/** 받침 여부로 조사를 고른다: josa("진행권", "을", "를") → "진행권을". 영문·숫자로 끝나면 둘째를 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const jong = (last - 0xac00) % 28;
    // ㄹ 받침 뒤 "으로"는 "로"(묶음 D).
    if (jong === 8 && withFinal === "으로") return word + withoutFinal;
    return word + (jong === 0 ? withoutFinal : withFinal);
  }
  // 숫자로 끝나면 읽는 소리 기준(묶음 B에서 가져옴): 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침.
  const ch = word.charAt(word.length - 1);
  if (ch >= "0" && ch <= "9") {
    if (withFinal === "으로" && "178".includes(ch)) return word + withoutFinal;
    return word + ("013678".includes(ch) ? withFinal : withoutFinal);
  }
  return word + withoutFinal;
}
